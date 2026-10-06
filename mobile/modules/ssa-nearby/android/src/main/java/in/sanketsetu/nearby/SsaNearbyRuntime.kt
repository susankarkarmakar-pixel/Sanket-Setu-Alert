package `in`.sanketsetu.nearby

import android.Manifest
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

internal object SsaNearbyRuntime {
  private const val PREFS = "ssa_nearby_runtime"
  private const val SERVICE_ID_KEY = "serviceId"
  private const val LOCAL_NAME_KEY = "localName"
  private const val PENDING_EVENTS_KEY = "pendingEvents"
  private const val MAX_BYTES_PAYLOAD = 32 * 1024
  private val STRATEGY = Strategy.P2P_CLUSTER

  private var connectionsClient: ConnectionsClient? = null
  private var running = false
  private var currentServiceId = ""
  private var currentLocalName = "SSA device"
  private var eventSink: ((Map<String, Any?>) -> Unit)? = null
  private var advertisingStarted = false
  private var discoveryStarted = false
  private val discoveredEndpoints = mutableSetOf<String>()
  private val connectedEndpoints = mutableSetOf<String>()
  private val pendingConnectionRequests = ConcurrentHashMap<String, Map<String, Any>>()

  fun attach(context: Context, sink: (Map<String, Any?>) -> Unit) {
    eventSink = sink
    drainPendingEvents(context, sink)
    pendingConnectionRequests.values.toList().forEach { request -> emit("connection-request", request) }
    if (running) emitStatus(context, "ready", "SSA Nearby foreground transport is active")
  }

  fun detach() {
    eventSink = null
  }

  fun getReadiness(context: Context): Map<String, Any> {
    val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    val bluetoothEnabled = bluetoothManager?.adapter?.isEnabled == true
    val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    val wifiEnabled = wifiManager?.isWifiEnabled == true
    return mapOf(
      "bluetoothEnabled" to bluetoothEnabled,
      "wifiEnabled" to wifiEnabled,
      "permissionsGranted" to hasRequiredPermissions(context),
    )
  }

  fun start(context: Context, serviceId: String, localName: String, requestForeground: Boolean) {
    require(serviceId.isNotBlank()) { "Nearby service ID is required" }
    require(localName.isNotBlank()) { "Nearby local name is required" }
    persistConfig(context, serviceId, localName)
    if (requestForeground) SsaNearbyForegroundService.start(context, serviceId, localName)
    startTransport(context, serviceId, localName)
  }

  fun restartFromService(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val serviceId = prefs.getString(SERVICE_ID_KEY, null) ?: return
    val localName = prefs.getString(LOCAL_NAME_KEY, "SSA device") ?: "SSA device"
    startTransport(context, serviceId, localName)
  }

  fun stop(context: Context, stopService: Boolean = true) {
    connectionsClient?.stopAdvertising()
    connectionsClient?.stopDiscovery()
    connectionsClient?.stopAllEndpoints()
    connectionsClient = null
    discoveredEndpoints.clear()
    connectedEndpoints.clear()
    pendingConnectionRequests.clear()
    advertisingStarted = false
    discoveryStarted = false
    running = false
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    emitStatus(context, "stopped", "SSA Nearby foreground transport stopped")
    if (stopService) SsaNearbyForegroundService.stop(context)
  }

  fun acceptConnection(context: Context, endpointId: String) {
    require(endpointId.isNotBlank()) { "Nearby endpoint ID is required" }
    val request = pendingConnectionRequests[endpointId]
      ?: throw IllegalStateException("No pending Nearby request for this endpoint")
    requireClient().acceptConnection(endpointId, payloadCallback)
      .addOnSuccessListener { pendingConnectionRequests.remove(endpointId) }
      .addOnFailureListener {
        emit("connection-request", request)
        emitStatus(context, "error", "Unable to accept nearby connection: ${it.message ?: "unknown error"}")
      }
  }

  fun rejectConnection(context: Context, endpointId: String) {
    require(endpointId.isNotBlank()) { "Nearby endpoint ID is required" }
    val request = pendingConnectionRequests[endpointId]
      ?: throw IllegalStateException("No pending Nearby request for this endpoint")
    requireClient().rejectConnection(endpointId)
      .addOnSuccessListener { pendingConnectionRequests.remove(endpointId) }
      .addOnFailureListener {
        emit("connection-request", request)
        emitStatus(context, "error", "Unable to reject nearby connection: ${it.message ?: "unknown error"}")
      }
  }

  fun sendPayload(context: Context, endpointId: String, bytes: List<Int>) {
    require(endpointId.isNotBlank()) { "Nearby endpoint ID is required" }
    require(bytes.isNotEmpty()) { "Nearby payload cannot be empty" }
    require(bytes.size <= MAX_BYTES_PAYLOAD) { "Nearby bytes payload exceeds 32 KB" }
    requireClient().sendPayload(endpointId, Payload.fromBytes(bytes.map { it.coerceIn(0, 255).toByte() }.toByteArray()))
      .addOnFailureListener { emitStatus(context, "error", "Nearby payload delivery failed: ${it.message ?: "unknown error"}") }
  }

  private fun requireClient(): ConnectionsClient = requireNotNull(connectionsClient) { "Nearby transport is not started" }

  private fun startTransport(context: Context, serviceId: String, localName: String) {
    if (running && currentServiceId == serviceId && currentLocalName == localName) return
    stopTransportOnly()
    currentServiceId = serviceId
    currentLocalName = localName

    val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val bluetoothAdapter = bluetoothManager.adapter
    if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) {
      emitStatus(context, "error", "Bluetooth is disabled. Turn on Bluetooth and retry SSA.")
      return
    }
    if (!hasRequiredPermissions(context)) {
      emitStatus(context, "error", "Nearby permissions are required for SSA emergency mode.")
      return
    }
    val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    if (wifiManager != null && !wifiManager.isWifiEnabled) {
      emitStatus(context, "error", "Wi-Fi is disabled. Turn on Wi-Fi and retry SSA.")
      return
    }

    emitStatus(context, "starting", "Starting persistent SSA Nearby service")
    connectionsClient = Nearby.getConnectionsClient(context.applicationContext)
    running = true
    advertisingStarted = false
    discoveryStarted = false
    discoveredEndpoints.clear()
    connectedEndpoints.clear()
    pendingConnectionRequests.clear()

    val advertisingOptions = AdvertisingOptions.Builder().setStrategy(STRATEGY).build()
    val discoveryOptions = DiscoveryOptions.Builder().setStrategy(STRATEGY).build()
    val client = connectionsClient ?: return
    client.startAdvertising(localName, serviceId, connectionLifecycleCallback, advertisingOptions)
      .addOnSuccessListener {
        advertisingStarted = true
        emitReadyIfTransportStarted(context)
      }
      .addOnFailureListener { emitStatus(context, "error", "SSA advertising failed: ${it.message ?: "unknown error"}") }
    client.startDiscovery(serviceId, endpointDiscoveryCallback, discoveryOptions)
      .addOnSuccessListener {
        discoveryStarted = true
        emitReadyIfTransportStarted(context)
      }
      .addOnFailureListener { emitStatus(context, "error", "SSA discovery failed: ${it.message ?: "unknown error"}") }
  }

  private fun emitReadyIfTransportStarted(context: Context) {
    if (advertisingStarted && discoveryStarted) emitStatus(context, "ready", "SSA Nearby advertising and discovery are active")
  }

  private fun stopTransportOnly() {
    connectionsClient?.stopAdvertising()
    connectionsClient?.stopDiscovery()
    connectionsClient?.stopAllEndpoints()
    connectionsClient = null
    discoveredEndpoints.clear()
    connectedEndpoints.clear()
    pendingConnectionRequests.clear()
    advertisingStarted = false
    discoveryStarted = false
    running = false
  }

  private fun hasRequiredPermissions(context: Context): Boolean {
    val required = mutableListOf<String>()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      required += Manifest.permission.BLUETOOTH_SCAN
      required += Manifest.permission.BLUETOOTH_CONNECT
      required += Manifest.permission.BLUETOOTH_ADVERTISE
    } else {
      required += if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) Manifest.permission.ACCESS_FINE_LOCATION else Manifest.permission.ACCESS_COARSE_LOCATION
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) required += Manifest.permission.NEARBY_WIFI_DEVICES
    return required.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED }
  }

  private val endpointDiscoveryCallback = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      if (!running || !discoveredEndpoints.add(endpointId)) return
      emitPeer(endpointId, info.endpointName, "discovered")
      connectionsClient?.requestConnection(currentLocalName, endpointId, connectionLifecycleCallback)
        ?.addOnSuccessListener { emitPeer(endpointId, info.endpointName, "connecting") }
        ?.addOnFailureListener { emitPeer(endpointId, info.endpointName, "rejected"); emitStatus(null, "error", "Nearby connection request failed: ${it.message ?: "unknown error"}") }
    }

    override fun onEndpointLost(endpointId: String) {
      discoveredEndpoints.remove(endpointId)
      connectedEndpoints.remove(endpointId)
      pendingConnectionRequests.remove(endpointId)
      emitPeer(endpointId, endpointId, "disconnected")
    }
  }

  private val connectionLifecycleCallback = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, connectionInfo: ConnectionInfo) {
      val request = mapOf(
        "endpointId" to endpointId,
        "name" to connectionInfo.endpointName,
        "authenticationToken" to connectionInfo.authenticationToken,
      )
      pendingConnectionRequests[endpointId] = request
      emit("connection-request", request)
    }

    override fun onConnectionResult(endpointId: String, resolution: ConnectionResolution) {
      pendingConnectionRequests.remove(endpointId)
      if (resolution.status.isSuccess) {
        connectedEndpoints.add(endpointId)
        emitPeer(endpointId, endpointId, "connected")
        emitStatus(null, "ready", "SSA Nearby connection established")
      } else {
        connectedEndpoints.remove(endpointId)
        emitPeer(endpointId, endpointId, "rejected")
        emitStatus(null, "error", "Nearby connection rejected: ${resolution.status.statusCode}")
      }
    }

    override fun onDisconnected(endpointId: String) {
      connectedEndpoints.remove(endpointId)
      pendingConnectionRequests.remove(endpointId)
      emitPeer(endpointId, endpointId, "disconnected")
    }
  }

  private val payloadCallback = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      val bytes = payload.asBytes() ?: return
      if (bytes.size <= MAX_BYTES_PAYLOAD) emit("payload", mapOf("endpointId" to endpointId, "bytes" to bytes.map { it.toInt() and 0xff }))
    }

    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) = Unit
  }

  private fun emitPeer(endpointId: String, name: String, state: String) {
    emit("peer", mapOf("peer" to mapOf("endpointId" to endpointId, "name" to name, "state" to state, "discoveredAt" to System.currentTimeMillis(), "lastSeenAt" to System.currentTimeMillis())))
  }

  private fun emitStatus(context: Context?, state: String, detail: String) {
    val notificationContext = context ?: SsaNearbyForegroundService.lastContext
    if (notificationContext != null && state != "stopped") SsaNearbyForegroundService.updateStatus(notificationContext, detail)
    emit("status", mapOf("state" to state, "detail" to detail))
  }

  private fun emit(type: String, payload: Map<String, Any?>) {
    val event = mapOf("type" to type) + payload
    val sink = eventSink
    if (sink != null) {
      try {
        sink.invoke(event)
        return
      } catch (_: Exception) {
        eventSink = null
      }
    }
    if (type != "connection-request") persistEvent(event)
  }

  private fun persistConfig(context: Context, serviceId: String, localName: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(SERVICE_ID_KEY, serviceId).putString(LOCAL_NAME_KEY, localName).apply()
  }

  private fun persistEvent(event: Map<String, Any?>) {
    val context = SsaNearbyForegroundService.lastContext ?: return
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val current = JSONArray(prefs.getString(PENDING_EVENTS_KEY, "[]"))
    if (current.length() >= 100) current.remove(0)
    current.put(JSONObject(event))
    prefs.edit().putString(PENDING_EVENTS_KEY, current.toString()).apply()
  }

  private fun drainPendingEvents(context: Context, sink: (Map<String, Any?>) -> Unit) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val current = JSONArray(prefs.getString(PENDING_EVENTS_KEY, "[]"))
    prefs.edit().remove(PENDING_EVENTS_KEY).apply()
    for (index in 0 until current.length()) {
      val event = current.optJSONObject(index) ?: continue
      if (event.optString("type") == "connection-request") continue
      sink(jsonObjectToMap(event))
    }
  }

  private fun jsonObjectToMap(value: JSONObject): Map<String, Any?> {
    val result = mutableMapOf<String, Any?>()
    val keys = value.keys()
    while (keys.hasNext()) {
      val key = keys.next()
      val item = value.get(key)
      result[key] = when (item) {
        is JSONObject -> jsonObjectToMap(item)
        is JSONArray -> (0 until item.length()).map { item.get(it) }
        JSONObject.NULL -> null
        else -> item
      }
    }
    return result
  }
}
