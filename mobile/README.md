# Sanket Setu Alert (SSA) React Native client

This package contains the active **React Native/Expo** client for Sanket Setu Alert. React Native is the chosen implementation because the repository already has an Expo Router shell, shared TypeScript protocol and cryptography packages, and a local Android Nearby Connections module. A separate Flutter client is intentionally not maintained in parallel; a Flutter port can reuse the shared packet contract later.

## Run the JavaScript client

From the repository root:

```bash
pnpm install
pnpm --filter @sanketly/mobile start
pnpm --filter @sanketly/mobile run typecheck
pnpm --filter @sanketly/mobile test
```

A native development build requires Android Studio/SDK or Xcode and a physical device or emulator:

```bash
pnpm --filter @sanketly/mobile android
pnpm --filter @sanketly/mobile ios
```

The repository sandbox can validate TypeScript and protocol behavior, but it does not contain Android SDK, Gradle, adb, or a radio-capable device. Therefore Nearby discovery, foreground-service recovery, OEM battery behavior, and multi-hop radio range remain physical-device acceptance tests.

## Source structure

| Area | Responsibility |
|---|---|
| `app/` | Thin Expo Router screens: dashboard, alert compose/list/detail, network, settings, onboarding, and peer chat |
| `components/ssa/` | Reusable status pills, buttons, cards, alert tiles, priority chips, and peer rows |
| `features/alerts/` | Structured-alert display and sorting helpers |
| `features/network/` | Transport-state and verified-peer helpers |
| `features/settings/` | Settings sections and persistence-boundary copy |
| `constants/ssa.ts` | Bengali-first labels, alert taxonomy, palette, and priorities |
| `lib/sanketly-provider.tsx` | Identity loading, native transport event handling, UI state, alert/message creation |
| `lib/mesh/mesh-engine.ts` | Transport-independent ingress, destination decryption, route selection, relay forwarding, queueing, and retry draining |
| `lib/storage.ts` | SecureStore identity and AsyncStorage outbox, relay queue, alert records, and relay events |
| `modules/ssa-nearby/` | Primary Android Google Nearby Connections `P2P_CLUSTER` bridge and foreground service |
| `modules/sanketly-mesh/` | Experimental raw BLE fallback; not the primary SSA pilot transport |

The fuller repository map and execution diagram are in [`../SSA_REACT_NATIVE_CODEBASE.md`](../SSA_REACT_NATIVE_CODEBASE.md). The dashboard wireframe specification is [`../SSA_DASHBOARD_WIREFRAME_SPEC.md`](../SSA_DASHBOARD_WIREFRAME_SPEC.md). The first-run readiness design is [`../SSA_FIRST_RUN_WIZARD_WIREFRAME_SPEC.md`](../SSA_FIRST_RUN_WIZARD_WIREFRAME_SPEC.md).

The readiness model now distinguishes Nearby permissions, Bluetooth radio, Wi-Fi radio, native transport availability, notification permission, and verified-peer availability. Android radio and permission values come from the native Nearby runtime when the module is installed; no verified peer is treated as a startup failure because a phone can be ready to search before another phone is nearby.

Volunteer mode now exposes a relay timeline containing received, forwarded, queued, failed, and recipient-evidence events. It also offers a diagnostics export containing app/device/transport counts and recent event categories without alert plaintext, private keys, or authentication secrets. This export is for pilot troubleshooting and is not proof of emergency delivery.

## Feature-by-feature Test Center

Settings now exposes the functional first-run readiness wizard and **Feature Test Center**. The Test Center runs local self-tests for libsodium initialization, SSA packet framing, SecureStore identity loading, and readiness checks. It also provides a clearly labeled synthetic notification test and direct links to the readiness wizard, Nearby network screen, SOS composer, structured alert composer, and informational onboarding. Synthetic tests never create or transmit a real emergency alert.

## Alert and message flow

A structured alert contains a schema version, type, priority, title, description, village, optional ward/location, creation time, expiry time, and alert ID. The provider serializes the complete structure into the encrypted message body. Libsodium seals that body to the recipient’s public encryption key and signs the ciphertext together with the authenticated metadata. A relay therefore forwards opaque bytes and cannot modify an alert without causing recipient signature verification to fail.

The local UI uses honest delivery vocabulary. `queued` means the encrypted packet is durably stored for another attempt; `relaying` means a next hop was selected; `delivered` requires recipient-side processing evidence; `expired` means the packet’s deadline passed; and `failed` means retry policy ended. A native API accepting a byte payload is not itself treated as delivery confirmation.

When a recipient decrypts a message, it creates a signed `received` acknowledgement bound to the original `messageId` and `packetId`. The acknowledgement is routed back through verified peers, checked for expiry and signature validity, and only then changes the sender’s durable outbox and alert record to `delivered`. This is delivery evidence, not proof that a human read or acted on the alert; authenticated `read` acknowledgements remain a future extension.

## Native transport and emergency persistence

On Android, SSA uses Google Nearby Connections with `P2P_CLUSTER` as the primary transport. Bluetooth, nearby Wi-Fi, notification, and legacy location permissions are requested according to Android version. In the pilot build, Nearby transport connections are accepted automatically so both phones do not remain stuck waiting for a manual accept action; a connection is not treated as a trusted SSA peer until its signed identity announcement passes peer-ID and signing-key verification. The foreground service uses a persistent notification, sticky restart, task-removal recovery, boot-time recovery configuration, and a JavaScript event buffer.

SSA also creates a dedicated `ssa-emergency-v1` local notification channel. Newly received, decrypted, non-expired structured alerts generate a high-importance notification with sound, vibration, and private lock-screen visibility. The notification body includes the alert title, localized priority, alert type, and village/area, but does not include the full description. Tapping the notification opens the matching alert detail record. Notification permission denial is handled as a degraded state: mesh operation is not blocked, and the setting can be enabled again later.

This is **best effort**, not an uninterrupted-service guarantee. Android force-stop, revoked permissions, battery exhaustion, radio failure, and OEM power-management policies can still stop or restrict the app. Operators should review the battery settings CTA and keep radios enabled during a pilot. Android users should also verify that the SSA emergency channel remains enabled and that notification permission is granted; channel importance and lock-screen display are ultimately controlled by Android system settings and device/OEM policy.

## Local notification acceptance test

| Test | Expected result |
|---|---|
| First start with notifications enabled | Android notification permission is requested without preventing Nearby startup if denied. |
| Receive a non-expired critical/high alert while app is foregrounded | A high-importance SSA emergency notification appears with sound/vibration according to device settings. |
| Receive an alert while app is backgrounded | The alert is persisted locally and a notification appears if Android permits background delivery. |
| Tap the notification | SSA opens the corresponding alert detail record using the notification `messageId`. |
| Disable notifications in Settings | Future received alerts are still persisted but do not schedule local notifications. |
| Re-enable notifications | Permission is requested again when needed and future alerts can notify. |
| Receive an expired alert | The alert is persisted for local history but no new notification is scheduled. |
| Android notification permission denied | Mesh and alert persistence continue; the UI does not claim notification readiness. |

## Three-device acceptance test

Use Android devices A, B, and C. Keep A and C outside direct radio range while B remains within range of both. Start discovery on all three devices. The pilot build automatically accepts the Nearby transport link; verify that each link still becomes a trusted SSA peer only after signed announcement validation. Then send an encrypted alert from A to C. B should report a forwarding event without showing the alert plaintext, and C should display the structured alert after signature verification and decryption. Disconnect B and confirm that queued packets remain durable, retry with backoff, and expire rather than being reported as delivered.

The same test should be repeated after backgrounding, screen lock, task removal, process recreation, reboot, permission revocation, and battery-saver changes on each target Android OEM.

## Encrypted local storage

Alert records, the message outbox, relay queue, and relay events use SQLCipher-enabled `expo-sqlite`. A cryptographically random database key is held in `expo-secure-store`; a non-secret marker helps detect a missing key after restore, and the app refuses to mint a replacement key that could lock an existing database. SQLCipher is required and the app deliberately fails closed if the native build does not provide it. Schema version 1 uses indexed tables and transactional upserts, bounded queue/event retention, and an idempotent import from the old AsyncStorage keys (including keys recreated by an older app version). Legacy plaintext records are removed only after the encrypted import commits. If a legacy record is corrupt or cleanup fails, initialization stops while preserving the original values for recovery. Non-message preferences such as theme and language remain in AsyncStorage.

This requires a native Android/iOS development or release build with the `expo-sqlite` config plugin; SQLCipher is not available in Expo Go, and encrypted message storage intentionally does not fall back to plaintext on web. Expo references: [SQLite / SQLCipher](https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/) and [SecureStore](https://docs.expo.dev/versions/v54.0.0/sdk/securestore/). The sandbox validates TypeScript and unit behavior, but encryption, upgrade migration, backup/restore, and power-loss recovery still require testing on real Android/iOS devices before field use.

## Android test APK build

The current Android release configuration targets **minSdk 26** because the included experimental raw-BLE fallback module declares Android 26 as its minimum. The primary Nearby module remains the SSA pilot transport. After installing Android SDK Platform-Tools, Android SDK Platform 35 or newer as required by the generated project, and a full JDK, regenerate and build the APK with:

```bash
cd mobile
pnpm exec expo prebuild --clean
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$JAVA_HOME/bin:$PATH"
bash ./android/gradlew -p android assembleRelease --no-daemon
```

The installable artifact is written to `mobile/android/app/build/outputs/apk/release/app-release.apk`. The repository also includes `scripts/install-ssa-apk-3-devices.sh` for concurrent installation on explicitly selected ADB serials. Local testing should use a non-production test keystore; a production upload/release keystore must be created and protected before distribution outside the test team. Sideloaded test APKs may still trigger an Android/Play Protect warning because they are not distributed through Google Play.

## Crypto startup requirement

The mobile entrypoint is `index.js`, not a direct `expo-router/entry` import. It loads `react-native-get-random-values` before Expo Router evaluates the provider and `libsodium-wrappers-sumo`. This ordering is required because Hermes does not provide `globalThis.crypto.getRandomValues` by default, while the ESM libsodium bundle requires a secure random source during module initialization. Do not change the package `main` field back to `expo-router/entry` unless an equivalent secure-random bootstrap remains in front of it.

## Theme and language settings

The app includes a persistent SSA theme and localization provider at `lib/ssa-theme.tsx`. Users can select **Light mode**, **Dark mode**, or **Follow phone setting**, and can select **Bengali**, **English**, or **Hindi** from Settings. Preferences are stored in AsyncStorage and are restored on the next launch. The dashboard, tabs, alerts, composer, network diagnostics, settings, onboarding, alert detail, and peer chat screens consume the active palette and translated copy.


## Build and download an APK from GitHub Actions

The repository now includes a manual workflow at `.github/workflows/build-ssa-apk.yml`. Open the GitHub repository, select **Actions → Build SSA APK → Run workflow**, keep the default pilot package `in.sanketsetu.alert.pilot` and version, then start the workflow. When it finishes successfully, open the workflow run and download the artifact named `ssa-<version>-pilot-apk` from the **Artifacts** section. The artifact contains the APK, `SHA256SUMS.txt`, Android package metadata, signature verification output, and build information.

This workflow produces a development/test-signed pilot APK for supervised testing. It is not a Play Store production release and is not signed with a protected production keystore. GitHub artifact downloads require access to the repository, and artifacts expire according to the retention value selected when the workflow is run. For repeatable updates on an already-installed pilot package, configure a protected signing keystore as a repository secret before relying on in-place upgrades; otherwise Android may require uninstalling the older differently signed pilot APK first, which removes its local app data.
