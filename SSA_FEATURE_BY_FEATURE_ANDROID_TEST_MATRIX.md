# SSA Feature-by-Feature Android Test Matrix

**Build under test:** Sanket Setu Alert (SSA) Android APK  
**Purpose:** Verify every user-facing feature and core function in a controlled pilot before community use  
**Required hardware:** Three Android phones A, B, and C for mesh tests; a fourth phone is useful for notification comparison  
**Network condition:** Repeat mesh tests with mobile data and Wi-Fi internet unavailable; Nearby transport may require Wi-Fi radio enabled

> This checklist provides evidence for a development/pilot build. It does not prove guaranteed emergency delivery, authority response, range, or background survival on every Android OEM.

## 1. Test preparation

| Item | Record before testing |
|---|---|
| APK | File name, SHA-256, build date, Git commit |
| Phone A/B/C | Manufacturer, model, Android version, security patch |
| Battery | Percentage and battery-saver state on each phone |
| Permissions | Nearby/Bluetooth/Wi-Fi, notifications, and conditional legacy location |
| Radio | Bluetooth and Wi-Fi enabled/disabled state |
| Distances | A–B, B–C, and A–C distance plus walls/obstructions |
| App state | Fresh install or retained identity; do not clear data unless the test explicitly requires it |
| Logs | Screen recording, screenshots, timestamps, and sanitized logcat |

## 2. Feature inventory

| ID | Feature | Test type | Pass condition |
|---|---|---|---|
| F01 | Startup and crypto bootstrap | Local | App opens without returning to the home screen or showing a Hermes random-source crash. |
| F02 | Bengali default language | UI | Fresh setup opens in Bengali and all critical controls are understandable. |
| F03 | English language | UI | Settings changes all supported screens to English without a crash or clipped control. |
| F04 | Hindi language | UI | Settings changes all supported screens to Hindi without a crash or clipped control. |
| F05 | Light theme | UI | Text, borders, cards, warning states, and buttons retain readable contrast. |
| F06 | Dark theme | UI | Text, cards, warnings, and navigation remain readable with no bright background gaps. |
| F07 | System theme | UI | App follows Android appearance after restart or system-theme change. |
| F08 | Resident mode | UI/privacy | Technical peer/relay detail is minimized and resident actions remain understandable. |
| F09 | Volunteer mode | UI/operations | Peer approval, relay and diagnostic controls are available without exposing private keys. |
| F10 | First-run readiness wizard | Functional | Wizard explains each permission, requests it, re-checks it, and supports limited mode. |
| F11 | Nearby permission denial | Recovery | Critical readiness remains blocked and the app offers retry/settings recovery. |
| F12 | Notification denial | Recovery | Mesh and in-app alert storage continue; notification readiness shows a limitation. |
| F13 | Battery/OEM guidance | Recovery | App opens battery settings only after user action and does not claim a guarantee. |
| F14 | Local self-tests | Automated/local | Test Center passes crypto, framing, identity storage, and readiness checks. |
| F15 | Synthetic notification | Local | Test notification appears with the correct channel and is clearly marked as non-emergency. |
| F16 | Nearby advertising/discovery | Two-device | Each phone finds the other using SSA’s Nearby service. |
| F17 | Connection approval | Two-device | User sees the endpoint name/token and can accept or reject it. |
| F18 | Signed peer announcement | Two-device | Valid announcement becomes a verified peer; malformed identity remains unverified. |
| F19 | Encrypted direct message | Two-device | Recipient decrypts; relay/transport cannot read plaintext. |
| F20 | Structured alert | Two-device | Alert kind, priority, title, description, village, expiry, and status are stored/displayed. |
| F21 | SOS hold protection | UI | Accidental short press does not open/send; the required hold opens SOS flow. |
| F22 | SOS final confirmation | Functional | User can review destination and content before any final dispatch. |
| F23 | Multi-hop relay | Three-device | A→C alert crosses B when A and C are outside direct range. |
| F24 | Opaque relay | Three-device/security | B can forward but cannot decrypt C’s alert plaintext. |
| F25 | Recipient acknowledgement | Three-device | Signed acknowledgement returns from C to A, directly or through B. |
| F26 | Honest delivery state | Functional | Sender changes to delivered only after verified recipient acknowledgement. |
| F27 | Duplicate suppression | Three-device | Repeated packet IDs do not create duplicate alerts or repeated relay loops. |
| F28 | Queue and retry | Outage | Packet remains durable and retries after the route returns. |
| F29 | Expiry | Time/logic | Expired packets are not forwarded or notified as new emergency alerts. |
| F30 | Local notification | Background | Received non-expired alert generates high-priority local notification when allowed. |
| F31 | Notification tap routing | Background | Tapping notification opens the exact alert detail record. |
| F32 | Screen lock | Background | Notification obeys private lock-screen visibility and does not expose full description. |
| F33 | Background service | Device | Foreground notification remains according to Android policy and transport recovers where permitted. |
| F34 | Task removal | Device | Recovery behavior matches device policy; the UI remains honest if the service stops. |
| F35 | Process recreation | Device | Persisted identity/queue/alerts survive where Android permits and native events reattach safely. |
| F36 | Reboot | Device | Previously enabled recovery is attempted; failures are surfaced as limitations. |
| F37 | Permission revocation | Device | Readiness changes to attention/blocked and does not claim active mesh. |
| F38 | Alert history | UI | Created and received alerts appear in list/detail with localized delivery states. |
| F39 | Data boundary | Security | Relay devices do not store alert plaintext as part of forwarding. |
| F40 | APK installation/update | Release | APK installs through a trusted local path; version and package are correct. |

## 3. Local and UI tests

### 3.1 Startup, language, and theme

1. Install the APK using a trusted local source. Open it twice and confirm that startup is stable.
2. Open **Settings → Feature Test Center → Run local tests**. Record the result for crypto, packet framing, identity storage, and readiness.
3. From a clean app state, verify Bengali is the default. Change to English, restart the app, and confirm the preference persists.
4. Repeat with Hindi. Check the dashboard, Settings, Network, Alerts, composer, alert detail, onboarding, readiness wizard, and Test Center.
5. Select Light, Dark, and System appearance. Test each with large Android font size and display scaling.
6. Confirm all status information uses text as well as color. Capture any clipping or untranslated raw state values.

### 3.2 Readiness wizard

1. Revoke or deny Nearby permissions and open the readiness wizard.
2. Confirm the wizard explains the purpose before the system prompt.
3. Deny once, choose retry, grant permission, return from Settings, and use **Check again**.
4. Disable Bluetooth or Wi-Fi radio and confirm the wizard identifies the radio limitation rather than calling it an internet failure.
5. Deny notification permission and confirm the app can continue in limited mode.
6. Open battery settings only through the explicit CTA. Return and verify the result is not assumed.
7. With no other SSA phone nearby, confirm the state says “ready to search” or “no verified phone nearby,” not “setup failed.”

## 4. Two-device discovery and direct delivery

Place A and B within nearby range. Start SSA search on both. Each phone must show an explicit approval request; compare the same authentication token verbally or through the intended pilot procedure before approving on each phone. Confirm that no link is accepted automatically, each endpoint first appears as a candidate, and it becomes a verified SSA peer only after the signed announcement succeeds. Repeat with mismatched tokens and reject the request.

From A, send a non-sensitive test message to B. Confirm A initially shows queued/relaying or next-hop state, B receives the decrypted message, and A changes to recipient delivery evidence only after the signed acknowledgement returns. Confirm the message body is not visible in relay-only UI or logs.

Repeat with a structured test alert using a non-emergency title such as “Pilot test—ignore.” Verify all required fields, expiry, alert history, notification, and detail routing.

## 5. Three-device relay test

Place B between A and C. Keep A and C outside direct range while B remains within range of both. Start and approve links as required. Confirm A and C can become verified peers through their respective links.

Send a structured test alert from A to C. Record timestamps for creation, first route selection, B forwarding, C receipt, C acknowledgement creation, B forwarding of the acknowledgement, and A’s final state. A must not show delivered before the signed acknowledgement is verified.

Disconnect B during the test. Confirm the sender retains a durable queued or retrying state. Reconnect B and confirm the packet resumes. Inject the same packet ID again and confirm deduplication prevents a duplicate alert.

## 6. SOS test

Use a clearly labeled pilot test alert. Short-press the SOS control and confirm no action occurs. Hold for the required duration and confirm it opens the SOS flow or confirmation screen. Review the type, priority, destination, village, description, and warning before final dispatch.

If the implementation still requires a final composer action, record that behavior explicitly. Do not describe opening the SOS composer as delivery. Confirm that cancellation does not create an outbox message and that a final dispatch creates exactly one message ID.

## 7. Background and recovery tests

For each phone, record results separately because Android OEM behavior differs:

| Scenario | Procedure | Expected evidence |
|---|---|---|
| Background | Start mesh, press Home, wait, send test alert | Foreground notification and transport state remain according to policy. |
| Screen lock | Lock phone, send test alert | Local notification respects private lock-screen visibility. |
| Task removal | Remove app from recent tasks | Recovery follows device policy; no false ready/delivered claim. |
| Process recreation | Stop/recreate app process using controlled developer method | Identity, queues, alerts, and pending native events recover where allowed. |
| Reboot | Reboot after enabling emergency mode | Boot recovery is attempted and result is recorded. |
| Battery saver | Enable saver and repeat background test | UI reports degraded background reliability if transport is restricted. |
| Permission revocation | Revoke Nearby/notification permission in Settings | Readiness changes after re-check and gives a recovery action. |
| Radio loss | Disable Bluetooth or Wi-Fi during active mesh | State changes to attention/error; queues remain durable. |

## 8. Notification tests

Use **Feature Test Center → Send test notification** first. Confirm the synthetic message is visibly a test, uses the `ssa-emergency-v1` channel, and does not create a mesh alert. Then test a real structured pilot alert from another phone.

Verify foreground, background, screen lock, notification tap routing, notification denial, Settings toggle off/on, expired alert suppression, sound/vibration according to device settings, and Bengali/Hindi/English channel labels. Capture the Android notification-channel settings screen because Android and OEM settings can override application defaults.

## 9. Evidence package

For every failed test, capture the test ID, exact time, phone model/version, current permissions, distance, app state, screenshot, and sanitized logcat. Do not share private keys, full alert plaintext, authentication secrets, or unnecessary personal information.

The final pilot decision should be recorded as one of:

| Decision | Meaning |
|---|---|
| Pass | The expected behavior was observed on the tested device and conditions. |
| Conditional pass | The behavior worked with a documented Android/OEM limitation. |
| Fail | The expected behavior did not occur or the app made an unsafe claim. |
| Not tested | Hardware, permission, or environment was unavailable; no assumption is allowed. |

A feature is not considered field-ready merely because its screen opens. The end-to-end result, recovery behavior, evidence, and user-facing status must all be correct.
