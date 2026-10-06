# SSA Nearby Native Module

This local Expo module is the Android Phase 1 transport boundary for Sanket Setu Alert. It wraps Google Play Services Nearby Connections with `Strategy.P2P_CLUSTER`, allowing an SSA device to advertise and discover at the same time.

## Native API

The JavaScript bridge exposes `start(serviceId, localName)`, `stop()`, `acceptConnection(endpointId)`, `rejectConnection(endpointId)`, `sendPayload(endpointId, bytes)`, and an event subscription for `SsaNearbyEvent`. Every incoming connection request remains pending until the user explicitly accepts or rejects it; the native runtime never accepts a link automatically.

Events include `status`, `peer`, `connection-request`, and `payload`. A pending approval is replayed to JavaScript only while the native request remains active; approval requests are not persisted as stale events. Payloads are byte arrays and must stay at or below 32 KB. The SSA provider sends the authenticated announce packet immediately after a connection is accepted, then sends encrypted protocol packets only after the recipient identity is verified.

## Permissions and radio state

The app requests Bluetooth scan/connect/advertise permissions on Android 12+, nearby Wi-Fi permission on Android 13+, and the appropriate location permission on older releases. Bluetooth and Wi-Fi must be enabled by the user; the module does not toggle radios automatically. A denied permission or disabled radio produces an actionable status event rather than a false ready state.

## Phase 1 device test

Install the development build on two physical Android phones. Turn off mobile data and Wi-Fi internet access while leaving the Wi-Fi and Bluetooth radios enabled. Start discovery on both devices, accept the connection request on both sides, confirm the peer appears as connected, and exchange the test announce/payload. Repeat after stopping and restarting the app. Record device model, Android version, discovery time, connection result, payload result, and battery impact.

The Linux development environment can type-check the bridge and run protocol tests, but it cannot compile the Android native module or validate radio behavior. A physical Android build is required before claiming Phase 1 connectivity.

## Foreground service and recovery

On Android, `start(serviceId, localName)` starts the Nearby transport through the user-visible `SsaNearbyForegroundService`. The service stores its configuration in private app preferences, posts an ongoing low-importance notification, uses sticky restart behavior, re-issues itself after the launcher task is removed, and restores the last explicit configuration after device boot. Native events are buffered while the JavaScript listener is unavailable and drained when the app attaches again.

The bridge also exposes `attach()` and `openBatterySettings()`. The latter opens Android’s battery-optimization settings; SSA does not silently request an exemption or change device policy. Permissions, Bluetooth/Wi-Fi radio state, notification permission, battery saver, force-stop, process kill, reboot, and OEM background restrictions must be tested on every target device. The service is designed for emergency persistence, but Android and OEM policies mean uninterrupted operation cannot be guaranteed.
