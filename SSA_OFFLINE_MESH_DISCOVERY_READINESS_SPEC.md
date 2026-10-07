# SSA Offline Mesh Node Auto-Discovery and Readiness Recovery

**Product:** Sanket Setu Alert (SSA)  
**Primary Android transport:** Google Nearby Connections using `P2P_CLUSTER`  
**Fallback transport:** Experimental raw BLE module  
**Pilot context:** Gazole Development Block, Malda, West Bengal  
**Status:** Implementation detail and readiness design for the existing React Native/Expo pilot

## 1. Purpose

SSA should make a phone useful as an offline mesh node without requiring mobile data or a central server. A node has two responsibilities: it advertises itself so nearby SSA phones can find it, and it discovers nearby SSA phones so it can form authenticated links and forward encrypted packets.

The readiness check must not reduce this to a single “Bluetooth on/off” value. It should explain whether the phone can search, whether the transport is running, whether a nearby endpoint has been found, whether that endpoint has been authenticated as an SSA peer, and whether background recovery is merely configured or actually confirmed.

> **Readiness is capability reporting, not a delivery guarantee.** “Ready to search” means the phone can attempt discovery. It does not prove that another phone is nearby, that a route exists, that a packet will cross the route, or that an authority will respond.

## 2. Existing SSA discovery path

The current Android runtime uses Nearby Connections with `Strategy.P2P_CLUSTER`. On `start`, it persists the service ID and local display name, starts the foreground service when requested, checks Bluetooth, required Android permissions, and Wi-Fi state, and then starts both advertising and discovery.[1]

| Stage | Current behavior | Readiness meaning |
|---|---|---|
| Identity loaded | The provider loads or creates the local cryptographic identity. | The phone has an identity with which to announce itself. |
| Native module attached | Pending native events are drained when JavaScript attaches. | Events received while JS was unavailable can be processed. |
| Permission check | Android-version-specific Nearby/Bluetooth/Wi-Fi and legacy location permissions are checked/requested. | The OS allows the transport to operate. |
| Radio check | Bluetooth and Wi-Fi must be enabled by the current native runtime. | The required radios are available; SSA does not toggle them silently. |
| Foreground service | The service configuration is persisted and the service may be started. | Background persistence is being attempted, subject to Android/OEM policy. |
| Advertising | The phone advertises its SSA service ID and local name. | Other SSA phones can discover this node. |
| Discovery | The phone scans for the same SSA service ID. | This node can find nearby SSA endpoints. |
| Endpoint found | Nearby emits an endpoint ID and display name. | A candidate exists, but it is not trusted yet. |
| Connection request | The runtime requests a connection to the endpoint. | Link negotiation is in progress. |
| User approval | The provider displays the authentication token and allows accept/reject. | The person explicitly approves the nearby link. |
| Connection established | The runtime reports a connected endpoint. | A byte channel exists, but identity authentication is still completed by SSA announce. |
| Signed announce | The provider sends and validates the peer’s identity announcement. | The endpoint becomes a verified SSA mesh peer. |
| Payload routing | Incoming bytes enter the transport-independent `MeshEngine`. | The node can decrypt for itself or relay opaque packets. |

## 3. Candidate endpoint versus trusted mesh peer

An Android Nearby `endpointId` is a transport identifier. It is not the same thing as the SSA `peerId`, and it must not be displayed as proof of identity. The current provider initially creates a peer row with `verified: false` when an endpoint is discovered or connected. After the endpoint sends an announce packet, the provider checks all of the following:

1. The announce payload is valid JSON.
2. The announced `peerId` equals the packet sender ID.
3. The encryption public key and signing public key are present.
4. Deriving a peer ID from the announced signing public key produces the announced peer ID.

Only then does the provider replace the candidate row with `verified: true`, attach the public keys, and mark the connection as a trusted SSA peer.[2]

```text
Nearby endpoint found
        │
        ▼
Transport candidate — unverified
        │
        ├── connection rejected/lost → unavailable
        ├── user rejects request → unavailable
        ├── connected but no valid announce → connected, unverified
        └── valid identity announce → verified SSA peer
```

A verified peer is the minimum trust level for relaying encrypted messages. Relay nodes do not need the message plaintext or the recipient’s private key. They forward the signed encrypted packet, while the final recipient performs signature verification and decryption.

## 4. Auto-discovery sequence

### 4.1 Start sequence

When the user presses **Start nearby search**, the provider first requires a loaded identity. It moves the UI to `starting`, requests notification permission if the user enabled notifications, requests Android transport permissions, creates an authenticated announce packet, and calls the Android Nearby module with the stable SSA service ID.

The native runtime persists the service ID and local display name before starting the transport. It then checks Bluetooth, required permissions, and Wi-Fi. If any check fails, it emits an error state and does not begin advertising or discovery.

When both advertising and discovery have been requested, the runtime emits `ready` after discovery starts successfully. This should be interpreted by the UI as **ready to search**, not **connected to a peer**.

### 4.2 Discovery and connection sequence

The runtime maintains an in-memory set of discovered endpoint IDs to avoid issuing duplicate connection requests. On a new endpoint, it emits a `peer` event with `discovered` state and requests a connection. A successful request changes the state to `connecting`.

When Nearby calls `onConnectionInitiated`, SSA emits a `connection-request` event containing the endpoint ID, display name, and authentication token. The user can approve or reject this request. Transport approval alone does not establish an SSA identity trust relationship.

If the connection succeeds, the runtime emits `connected`, and the provider sends an announce frame containing the peer ID and public keys. The receiving phone verifies that the peer ID is derived from the announced signing key and displays a fingerprint bound to both public keys. The peer remains untrusted until the user compares that fingerprint with the other phone and explicitly pins the exact key pair. A self-announcement is not, by itself, proof of a trusted identity.

### 4.3 Payload sequence

Nearby payload bytes are passed to the provider as a `payload` event. The provider forwards them to `MeshEngine.receive`. The engine frames and validates the packet, suppresses duplicate packet IDs, and decrypts a direct message only when the sender's signing and encryption keys match a locally pinned trust record. Eligible opaque packets may be relayed through another fingerprint-pinned peer.[3]

For an alert addressed to the local phone, the provider decrypts and validates the structured alert, stores it, triggers the local emergency notification if enabled, and creates a signed recipient acknowledgement. The acknowledgement follows the same mesh route-selection and retry model back toward the original sender.

## 5. Readiness state model

The wizard and Network screen should use a structured readiness model rather than infer meaning from free-form status text. The following state is recommended:

```ts
type ReadinessState =
  | "checking"
  | "blocked-permission"
  | "blocked-radio"
  | "starting"
  | "ready-to-search"
  | "waiting-for-peer"
  | "candidate-awaiting-approval"
  | "peer-connected-unverified"
  | "peer-verified"
  | "degraded-background"
  | "stopped"
  | "error";
```

The model should expose component facts alongside the overall state:

```ts
interface MeshReadiness {
  overall: ReadinessState;
  platform: "android" | "other";
  permissions: {
    nearby: "granted" | "denied" | "blocked" | "not-required";
    notifications: "granted" | "denied" | "blocked" | "not-required";
    legacyLocation: "granted" | "denied" | "blocked" | "not-required";
  };
  radios: {
    bluetooth: "on" | "off" | "unavailable" | "unknown";
    wifi: "on" | "off" | "unavailable" | "unknown";
  };
  transport: "stopped" | "starting" | "advertising-and-discovering" | "error";
  candidates: number;
  pendingApprovals: number;
  verifiedPeers: number;
  foregroundService: "active" | "requested" | "not-requested" | "unknown";
  lastCheckedAt: number;
  detail?: string;
}
```

### 5.1 State interpretation

| Overall state | Meaning | Bengali-first user message | Allowed action |
|---|---|---|---|
| `checking` | The app is reading current permission, radio, and native transport state. | `ফোনের প্রস্তুতি পরীক্ষা হচ্ছে` | Wait or cancel. |
| `blocked-permission` | A critical Android permission is missing or blocked. | `কাছের ফোন খুঁজতে অনুমতি দরকার` | Request again or open Settings. |
| `blocked-radio` | Bluetooth or Wi-Fi is off/unavailable. | `Bluetooth/Wi‑Fi চালু নেই` | Ask the user to enable it, then re-check. |
| `starting` | Permissions and radios passed; advertising/discovery is being started. | `কাছের ফোন খোঁজা শুরু হচ্ছে` | Wait; allow stop. |
| `ready-to-search` | Advertising and discovery were started successfully. | `কাছের ফোন খোঁজার জন্য প্রস্তুত` | Continue searching or return dashboard. |
| `waiting-for-peer` | Search is active but no verified peer is nearby. | `কাছাকাছি কোনো যাচাই করা ফোন নেই` | Keep search active or show Network. |
| `candidate-awaiting-approval` | A Nearby endpoint requested connection approval. | `একটি কাছের ফোন সংযোগ চাইছে` | Show name/token; accept or reject. |
| `peer-connected-unverified` | Transport link exists, but the SSA announce is not yet trusted. | `সংযোগ হয়েছে; পরিচয় যাচাই হচ্ছে` | Wait; do not allow relay yet. |
| `peer-verified` | At least one connected peer's exact public-key pair has been compared and pinned locally. | `fingerprint-মিলানো trusted সেতু পাওয়া গেছে` | Send/receive directly, or relay opaque packets through trusted peers. |
| `degraded-background` | Foreground recovery is active or requested, but OEM/battery state may restrict it. | `ব্যাকগ্রাউন্ডে কাজের সীমাবদ্ধতা আছে` | Review battery settings; continue with warning. |
| `stopped` | The user or app stopped the transport. | `কাছের সংযোগ বন্ধ` | Start again. |
| `error` | A native or routing error occurred. | `কাছের সংযোগে সমস্যা হয়েছে` | Show cause, retry, or open Settings. |

## 6. State recovery handling

### 6.1 JavaScript/provider recovery

The native runtime has an event sink that can be attached and detached. If JavaScript is not attached when a native status, peer, connection-request, or payload event occurs, the runtime stores the event in a SharedPreferences JSON queue. The queue is capped at 100 events; when full, the oldest event is removed. On the next `attach`, pending events are drained to the JavaScript listener.[1]

The provider should treat drained events as historical events. It must update current state using timestamps and must not replay a stale connection request as though it were still valid without checking the current endpoint/link status. Payload events should still pass through packet expiry and deduplication checks.

### 6.2 Foreground-service recovery

The native start path persists `serviceId` and `localName` in the `ssa_nearby_runtime` preferences before starting the foreground service. The service can restart the transport using those values. The boot receiver can request recovery after device restart when the emergency configuration was previously enabled. Task-removal and sticky-service behavior are implemented as best-effort Android mechanisms, but OEM policy and force-stop can still prevent recovery.

The user interface should therefore show two separate facts:

| Fact | Honest label |
|---|---|
| The service was requested or configured | `Background recovery configured` |
| The native transport is currently advertising/discovering | `Nearby search active` |
| A verified peer is connected | `Verified bridge connected` |
| A message was recipient-acknowledged | `Recipient received` |

These must never collapse into one “online” or “delivered” label.

### 6.3 Link-loss recovery

When Nearby reports `onEndpointLost`, the runtime removes the endpoint from its discovered and connected sets and emits `disconnected`. The provider changes that peer to `unavailable`. Because the endpoint is removed from the discovered set, a later discovery callback can be treated as a new candidate and can trigger a fresh connection request.

When a verified peer disappears, the provider should preserve the last-known peer identity for diagnostics but mark the active link unavailable. Outgoing packets should remain in the durable relay/outbox queue rather than being discarded. The mesh engine should retry when a route becomes available again.

### 6.4 Permission and radio recovery

The wizard must re-check actual Android state after the user returns from Settings. It must not assume that the permission was granted or that the radio was enabled. A re-check should update the readiness model, show the remaining blocker, and allow the user to retry transport startup.

The recommended trigger set is:

1. User taps **Check again**.
2. App returns to the foreground after Settings.
3. A native status/error event is received.
4. The user taps **Start nearby search**.
5. The foreground service reattaches after process recreation.

A high-frequency polling loop is unnecessary for this local event-driven readiness check and would add battery work without improving correctness.

## 7. User-facing recovery matrix

| Condition | Do not say | Say instead | Recovery |
|---|---|---|---|
| Bluetooth disabled | “SSA is broken.” | “Bluetooth is off; SSA cannot search nearby phones.” | Open system Bluetooth settings or show the system action. |
| Wi-Fi disabled | “No internet.” | “Wi-Fi is off; this Android transport currently requires it enabled.” | Enable Wi-Fi; internet is still not required. |
| Nearby permission denied | “No network found.” | “Nearby permission is needed to search for bridge phones.” | Request again or open app settings. |
| Notification permission denied | “Alerts will not work.” | “Mesh may continue, but tray notifications are off.” | Open notification settings; keep in-app alert log available. |
| Battery restriction active | “Background delivery guaranteed.” | “Battery policy may stop background recovery on this phone.” | Review battery settings; continue with explicit limitation. |
| No endpoint found | “Setup failed.” | “Ready to search; no verified phone is nearby.” | Keep searching or return to dashboard. |
| Endpoint found but unverified | “Connected and trusted.” | “Connection found; identity verification is pending.” | Show approval/token flow; do not relay yet. |
| Peer lost | “Alert failed.” | “Bridge disconnected; queued packets will retry when a route returns.” | Keep queue durable and show retry status. |
| Process recreated | “Everything delivered.” | “SSA restored local state; nearby search is being re-established.” | Reattach, drain events, re-check native status. |
| Force-stop/OEM kill | “SSA always runs in background.” | “Android may prevent recovery after force-stop or OEM restriction.” | Show recovery steps; do not promise persistence. |

## 8. Recommended implementation changes

The highest-value implementation step is a typed `readiness-state` utility shared by the wizard, dashboard banner, Network tab, and `startMesh`. It should centralize permission lists, radio checks, notification state, foreground-service state, candidate counts, pending approvals, and verified-peer counts.

The native module should expose a read-only `getReadiness()` or equivalent event-backed status method. It should report whether advertising and discovery were requested successfully, whether the foreground service is active/requested, and the latest radio/permission result. The provider should subscribe to `AppState` foreground events and perform a real re-check after returning from Android Settings.

The provider should also normalize the native vocabulary. At present, native events use endpoint-oriented states such as `discovered`, `connecting`, `connected`, `disconnected`, and `rejected`, while the UI uses mesh-oriented states such as `starting`, `ready`, and `error`. A typed mapping should prevent a connected-but-unverified endpoint from being displayed as a trusted bridge.

Finally, the event queue should include event timestamps and a short event type version. On reattachment, stale connection-request events should be discarded or converted to an informational history event, while payloads should continue through expiry and deduplication checks.

## 9. Readiness acceptance tests

| Test | Expected result |
|---|---|
| Clean install with Bluetooth off | Wizard identifies Bluetooth as a critical blocker and offers recovery. |
| Nearby permission denied once | Wizard explains impact and offers retry; it does not claim mesh readiness. |
| Permission permanently denied | Wizard opens application settings and re-checks on return. |
| Wi-Fi off with mobile data off | SSA reports radio limitation; it does not confuse this with internet availability. |
| Both phones searching | Each phone advertises and discovers the other using the same service ID. |
| Endpoint discovered but request rejected | Candidate becomes unavailable; no trusted peer is created. |
| Connection approved, announce malformed | Endpoint remains unverified; encrypted relay is not allowed. |
| Valid announce received | Peer becomes verified and appears as a usable bridge. |
| Endpoint leaves range | Peer becomes unavailable; queued packets remain durable. |
| App process recreated | Native pending events are drained; stale events are not treated as current approval. |
| Device reboot after emergency mode | Recovery is attempted when Android permits it; UI remains honest if it is not active. |
| Battery saver enabled | UI shows degraded background reliability, not guaranteed persistence. |
| No peer nearby | UI says “ready to search” or “no verified phone nearby,” not setup failure. |
| A→B→C test | C receives and decrypts the message; signed recipient acknowledgement returns to A through B. |

## 10. Limitations to preserve in product copy

The current implementation provides a strong prototype path for Android Nearby discovery, authenticated peer promotion, encrypted payload handling, multi-hop forwarding, signed recipient acknowledgements, foreground-service persistence, and native event buffering. It does not prove physical range, OEM-specific background survival, guaranteed reboot recovery, or emergency-authority response.

Raw BLE remains an experimental fallback rather than the primary Android path. The user must not be told that SSA can operate in every radio configuration, that a nearby endpoint is automatically trusted, or that a native send acceptance equals recipient delivery. The readiness wizard should preserve these boundaries in every language.

### References

[1]: https://github.com/susankarkarmakar-pixel/sanketly/blob/feat/mobile-mesh-foundation/mobile/modules/ssa-nearby/android/src/main/java/in/sanketsetu/nearby/SsaNearbyRuntime.kt "SSA Android Nearby runtime and event recovery implementation"

[2]: https://github.com/susankarkarmakar-pixel/sanketly/blob/feat/mobile-mesh-foundation/mobile/lib/sanketly-provider.tsx "SSA provider peer authentication and native-event mapping"

[3]: https://github.com/susankarkarmakar-pixel/sanketly/blob/feat/mobile-mesh-foundation/mobile/lib/mesh/mesh-engine.ts "SSA transport-independent mesh routing and packet handling"
