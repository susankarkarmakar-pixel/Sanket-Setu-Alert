import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import type { TrustedPeerRecord } from "@sanketly/domain";
import type { MeshPeer } from "@sanketly/protocol";
import { ScreenContainer } from "@/components/screen-container";
import { PeerRow, ReadinessRow, SsaButton, SsaCard, StatusPill } from "@/components/ssa/ssa-ui";
import { useSsaTheme, type SsaColors } from "@/lib/ssa-theme";
import { useSanketly } from "@/lib/sanketly-provider";
import { isMeshActive, transportLabel, verifiedPeerCount } from "@/features/network/network-utils";
import { checkLocalReadiness, type LocalReadinessSnapshot } from "@/features/readiness/readiness-utils";

type Language = "bn" | "en" | "hi";

export default function NetworkScreen() {
  const {
    meshStatus,
    localFingerprint,
    peers,
    trustedPeers,
    pendingNearbyRequests,
    relayEvents,
    exportDiagnostics,
    startMesh,
    stopMesh,
    acceptNearbyRequest,
    rejectNearbyRequest,
    trustPeer,
    forgetPeer,
    openBatterySettings,
  } = useSanketly();
  const { colors, text, language, userMode } = useSsaTheme();
  const styles = makeStyles(colors);
  const active = isMeshActive(meshStatus);
  const verified = verifiedPeerCount(peers);
  const [readiness, setReadiness] = useState<LocalReadinessSnapshot | null>(null);

  useEffect(() => {
    let mounted = true;
    void checkLocalReadiness(verified, active)
      .then((snapshot) => { if (mounted) setReadiness(snapshot); })
      .catch(() => { if (mounted) setReadiness(null); });
    return () => { mounted = false; };
  }, [verified, active, meshStatus.state]);

  const readinessStatus = (id: "nearby" | "bluetooth" | "wifi" | "notifications" | "native-module" | "verified-peer") => readiness?.checks.find((check) => check.id === id)?.status === "ready";

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>SSA / NETWORK</Text>
            <Text style={styles.title}>{text.network}</Text>
            <Text style={styles.subtitle}>{language === "bn" ? "কাছের সংযোগ ও fingerprint-পিন করা পরিচয়" : language === "hi" ? "नज़दीकी कनेक्शन और fingerprint-pinned पहचान" : "Nearby connections and fingerprint-pinned identities"}</Text>
          </View>
          <Text onPress={() => router.back()} style={styles.back}>{text.back}</Text>
        </View>

        <SsaCard style={styles.statusCard}>
          <StatusPill state={meshStatus.state} detail={meshStatus.detail} />
          <Text style={styles.statusTitle}>{active ? (language === "bn" ? "কাছের সংযোগ চলছে" : language === "hi" ? "नज़दीकी कनेक्शन चल रहा है" : "Nearby connection is active") : (language === "bn" ? "কাছের সংযোগ বন্ধ" : language === "hi" ? "नज़दीकी कनेक्शन बंद है" : "Nearby connection is stopped")}</Text>
          <Text style={styles.statusBody}>{language === "bn" ? "Android-এ Google Nearby Connections P2P_CLUSTER প্রাথমিক পরিবহন। raw BLE fallback আলাদা পরীক্ষামূলক module হিসেবে রাখা আছে।" : language === "hi" ? "Android पर Google Nearby Connections P2P_CLUSTER मुख्य transport है। raw BLE fallback अलग प्रयोगात्मक module है।" : "Google Nearby Connections P2P_CLUSTER is the primary Android transport. The raw BLE fallback remains experimental."}</Text>
          <SsaButton label={active ? text.stop : text.start} onPress={() => void (active ? stopMesh() : startMesh())} />
        </SsaCard>

        <SsaCard>
          <Text style={styles.section}>{text.networkReady}</Text>
          <ReadinessRow label={language === "bn" ? "Nearby permission" : language === "hi" ? "Nearby अनुमति" : "Nearby permission"} detail={language === "bn" ? "Bluetooth ও Wi-Fi device access" : language === "hi" ? "Bluetooth और Wi-Fi device access" : "Bluetooth and Wi-Fi device access"} ready={readiness ? readinessStatus("nearby") : null} />
          <ReadinessRow label={language === "bn" ? "Bluetooth radio" : language === "hi" ? "Bluetooth radio" : "Bluetooth radio"} detail={language === "bn" ? "ফোনের Bluetooth চালু থাকতে হবে" : language === "hi" ? "फ़ोन का Bluetooth चालू होना चाहिए" : "The phone Bluetooth radio must be on"} ready={readiness ? readinessStatus("bluetooth") : null} />
          <ReadinessRow label={language === "bn" ? "Wi-Fi radio" : language === "hi" ? "Wi-Fi radio" : "Wi-Fi radio"} detail={language === "bn" ? "Nearby transport-এর জন্য Wi-Fi radio" : language === "hi" ? "Nearby transport के लिए Wi-Fi radio" : "Wi-Fi radio for Nearby transport"} ready={readiness ? readinessStatus("wifi") : null} />
          <ReadinessRow label={language === "bn" ? "কাছের পরিবহন" : language === "hi" ? "नज़दीकी transport" : "Nearby transport"} detail={language === "bn" ? "Google Nearby P2P_CLUSTER" : language === "hi" ? "Google Nearby P2P_CLUSTER" : "Google Nearby P2P_CLUSTER"} ready={readiness ? readinessStatus("native-module") && active : null} />
          <ReadinessRow label={language === "bn" ? "পরিচিত ফোন" : language === "hi" ? "विश्वसनीय फ़ोन" : "Trusted phones"} detail={language === "bn" ? "দুই ফোনের public-key fingerprint মিলেছে" : language === "hi" ? "दोनों फ़ोन के public-key fingerprint मेल खाते हैं" : "Both public-key fingerprints were compared"} ready={readiness ? readinessStatus("verified-peer") : null} />
        </SsaCard>

        <SsaCard>
          <Text style={styles.section}>{language === "bn" ? "এই ফোনের public-key fingerprint" : language === "hi" ? "इस फ़ोन का public-key fingerprint" : "This phone’s public-key fingerprint"}</Text>
          <Text selectable style={styles.fingerprintValue}>{localFingerprint ?? (language === "bn" ? "পরিচয় লোড হচ্ছে…" : language === "hi" ? "पहचान लोड हो रही है…" : "Loading identity…")}</Text>
          <Text style={styles.fingerprintHint}>{language === "bn" ? "সামনের ফোনে এই মানটি দেখানো peer fingerprint-এর সঙ্গে হুবহু মিলিয়ে নিন; তারপর দুই ফোনেই peer-কে trust করুন।" : language === "hi" ? "दूसरे फ़ोन पर दिख रहे peer fingerprint से इसे अक्षरशः मिलाएँ; फिर दोनों फ़ोन पर peer को trust करें।" : "Compare this exact value with the peer fingerprint shown on the other phone, then trust that peer on both devices."}</Text>
        </SsaCard>

        <SsaCard>
          <View style={styles.sectionHeader}>
            <Text style={styles.section}>{language === "bn" ? "কাছের ফোনের পরিচয়" : language === "hi" ? "नज़दीकी फ़ोन की पहचान" : "Nearby phone identities"}</Text>
            <Text style={styles.count}>{language === "bn" ? `${verified}টি trusted · ${peers.length}টি মোট` : language === "hi" ? `${verified} trusted · ${peers.length} कुल` : `${verified} trusted · ${peers.length} total`}</Text>
          </View>
          {peers.length === 0 ? <Text style={styles.empty}>{text.noKnownPhones}</Text> : peers.map((peer) => (
            <View key={peer.peerId} style={styles.peerBlock}>
              <PeerRow peer={peer} />
              <Text style={styles.transport}>{transportLabel(peer)}</Text>
              <PeerFingerprintCard
                peer={peer}
                trustedPeer={trustedPeers.find((record) => record.peerId === peer.peerId) ?? null}
                onTrust={trustPeer}
                onForget={forgetPeer}
              />
            </View>
          ))}
        </SsaCard>

        {pendingNearbyRequests.length > 0 ? (
          <SsaCard style={styles.requestCard}>
            <Text style={styles.section}>{language === "bn" ? "অনুমতির অপেক্ষায়" : language === "hi" ? "अनुमति लंबित" : "Waiting for approval"}</Text>
            {pendingNearbyRequests.map((request) => (
              <View key={request.endpointId} style={styles.requestRow}>
                <View style={styles.requestCopy}>
                  <Text style={styles.peerName}>{request.name || "SSA device"}</Text>
                  <Text style={styles.peerMeta}>{language === "bn" ? "সংযোগ নিরাপত্তা কোড" : language === "hi" ? "कनेक्शन सुरक्षा कोड" : "Connection security code"}: {request.authenticationToken}</Text>
                </View>
                <View style={styles.requestActions}>
                  <SsaButton label={text.no} variant="secondary" onPress={() => void rejectNearbyRequest(request.endpointId)} style={styles.smallButton} />
                  <SsaButton label={text.permission} onPress={() => void acceptNearbyRequest(request.endpointId)} style={styles.smallButton} />
                </View>
              </View>
            ))}
          </SsaCard>
        ) : null}

        <SsaCard>
          <Text style={styles.section}>{text.emergencyPersistence}</Text>
          <Text style={styles.body}>{language === "bn" ? "Foreground notification এবং battery settings সক্রিয় রাখলে Android process recovery-এর সুযোগ বাড়ে। এটি force-stop বা OEM battery policy অতিক্রম করার নিশ্চয়তা নয়।" : language === "hi" ? "Foreground notification और battery settings चालू रखने से Android process recovery की संभावना बढ़ती है। यह force-stop या OEM policy को पार करने की गारंटी नहीं है।" : "Keeping the foreground notification and battery settings active improves the chance of Android process recovery. It cannot defeat force-stop or OEM policy."}</Text>
          <SsaButton label={text.batterySettings} variant="secondary" onPress={() => void openBatterySettings()} />
        </SsaCard>

        {userMode === "volunteer" ? (
          <SsaCard>
            <View style={styles.sectionHeader}>
              <Text style={styles.section}>{language === "bn" ? "Relay timeline" : language === "hi" ? "Relay timeline" : "Relay timeline"}</Text>
              <Text style={styles.count}>{relayEvents.length} events</Text>
            </View>
            <Text style={styles.body}>{language === "bn" ? "শুধু volunteer mode-এ technical relay evidence দেখা যায়। Alert-এর plaintext এখানে দেখানো হয় না।" : language === "hi" ? "Technical relay evidence केवल volunteer mode में दिखता है। Alert का plaintext यहाँ नहीं दिखाया जाता।" : "Technical relay evidence is visible only in volunteer mode. Alert plaintext is not shown here."}</Text>
            {relayEvents.length === 0 ? <Text style={styles.empty}>{language === "bn" ? "এখনও কোনো relay event নেই" : language === "hi" ? "अभी कोई relay event नहीं है" : "No relay events yet"}</Text> : relayEvents.slice(-12).reverse().map((event) => (
              <View key={event.eventId} style={styles.eventRow}>
                <View style={[styles.eventDot, { backgroundColor: event.kind === "failed" ? colors.danger : event.kind === "delivered" ? colors.success : colors.primary }]} />
                <View style={styles.eventCopy}>
                  <Text style={styles.eventTitle}>{eventLabel(event.kind, language)}</Text>
                  <Text style={styles.eventMeta}>{new Date(event.createdAt).toLocaleTimeString()} · {event.detail ?? "SSA mesh event"}</Text>
                </View>
              </View>
            ))}
            <SsaButton label={language === "bn" ? "নিরাপদ diagnostics export" : language === "hi" ? "सुरक्षित diagnostics export" : "Export safe diagnostics"} variant="secondary" onPress={() => void exportDiagnostics().then((message) => Share.share({ title: "SSA diagnostics", message }))} />
          </SsaCard>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

function PeerFingerprintCard({
  peer,
  trustedPeer,
  onTrust,
  onForget,
}: {
  peer: MeshPeer;
  trustedPeer: TrustedPeerRecord | null;
  onTrust(peerId: string): Promise<void>;
  onForget(peerId: string): Promise<void>;
}) {
  const { colors, language } = useSsaTheme();
  const styles = makeStyles(colors);
  const [error, setError] = useState<string | null>(null);
  const fingerprint = peer.identityFingerprint;
  if (!fingerprint) return null;

  const matchesPinnedKey = Boolean(trustedPeer
    && trustedPeer.signingPublicKey === peer.signingPublicKey
    && trustedPeer.encryptionPublicKey === peer.encryptionPublicKey
    && trustedPeer.fingerprint === fingerprint);
  const changedKey = Boolean(trustedPeer && !matchesPinnedKey);
  const copy = trustCopy(language);

  function promptTrust(): void {
    const details = changedKey
      ? `${copy.keyChanged}\n\n${copy.oldFingerprint}: ${trustedPeer?.fingerprint}\n${copy.newFingerprint}: ${fingerprint}\n\n${copy.compare}`
      : `${copy.compare}\n\n${copy.fingerprint}: ${fingerprint}`;
    Alert.alert(copy.promptTitle, details, [
      { text: copy.cancel, style: "cancel" },
      { text: changedKey ? copy.replaceTrust : copy.trust, style: changedKey ? "destructive" : "default", onPress: () => { setError(null); void onTrust(peer.peerId).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : copy.failed)); } },
    ]);
  }

  function promptForget(): void {
    Alert.alert(copy.forgetTitle, copy.forgetBody, [
      { text: copy.cancel, style: "cancel" },
      { text: copy.forget, style: "destructive", onPress: () => { setError(null); void onForget(peer.peerId).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : copy.failed)); } },
    ]);
  }

  return (
    <View style={[styles.fingerprintCard, { borderColor: changedKey ? colors.danger : colors.border }]}>
      <Text style={styles.fingerprintLabel}>{copy.fingerprint}{matchesPinnedKey ? ` · ${copy.pinned}` : ""}</Text>
      <Text selectable style={styles.fingerprintValue}>{fingerprint}</Text>
      <Text style={[styles.fingerprintHint, changedKey && { color: colors.danger }]}>{changedKey ? copy.keyChanged : matchesPinnedKey ? copy.trusted : copy.compare}</Text>
      {peer.connectionState === "connected" ? <SsaButton label={matchesPinnedKey ? copy.forget : changedKey ? copy.replaceTrust : copy.trust} variant={matchesPinnedKey ? "secondary" : "primary"} onPress={matchesPinnedKey ? promptForget : promptTrust} style={styles.trustButton} /> : null}
      {error ? <Text style={styles.trustError}>{error}</Text> : null}
    </View>
  );
}

function trustCopy(language: Language) {
  if (language === "bn") return {
    fingerprint: "Public-key fingerprint",
    pinned: "PIN করা",
    trusted: "এই দুই public key আগে মিলিয়ে trust করা হয়েছে।",
    compare: "অন্য ফোনের Network screen-এ fingerprint-এর সঙ্গে অক্ষরে অক্ষরে মিলিয়ে নিন। না মিললে trust করবেন না।",
    keyChanged: "সতর্কতা: এই peer-এর key আগের trusted fingerprint থেকে বদলেছে। নতুন করে সরাসরি যাচাই না করা পর্যন্ত alert পাঠাবেন না।",
    oldFingerprint: "আগের",
    newFingerprint: "নতুন",
    promptTitle: "দুই ফোনের fingerprint মেলান",
    trust: "মিলেছে — Trust",
    replaceTrust: "মিলেছে — key বদলান",
    forgetTitle: "এই peer-এর trust সরাবেন?",
    forgetBody: "Trust সরালে এই peer-কে alert পাঠানো ও তার message গ্রহণ বন্ধ হবে। পরে আবার fingerprint মিলিয়ে trust করা যাবে।",
    forget: "Trust সরান",
    cancel: "বাতিল",
    failed: "Peer trust সংরক্ষণ করা যায়নি",
  };
  if (language === "hi") return {
    fingerprint: "Public-key fingerprint",
    pinned: "PIN किया गया",
    trusted: "इन public keys का मिलान करके पहले trust किया गया है।",
    compare: "दूसरे फ़ोन की Network screen के fingerprint से अक्षरशः मिलाएँ। मेल न हो तो trust न करें।",
    keyChanged: "चेतावनी: इस peer की key पहले trusted fingerprint से बदल गई है। सीधे जाँच किए बिना alert न भेजें।",
    oldFingerprint: "पुराना",
    newFingerprint: "नया",
    promptTitle: "दोनों फ़ोन के fingerprint मिलाएँ",
    trust: "मिला — Trust",
    replaceTrust: "मिला — key बदलें",
    forgetTitle: "इस peer का trust हटाएँ?",
    forgetBody: "Trust हटाने पर इस peer को alert भेजना और उसके message स्वीकारना बंद होगा। बाद में fingerprint मिलाकर फिर trust कर सकते हैं।",
    forget: "Trust हटाएँ",
    cancel: "रद्द करें",
    failed: "Peer trust सहेजा नहीं जा सका",
  };
  return {
    fingerprint: "Public-key fingerprint",
    pinned: "PINNED",
    trusted: "These public keys were compared and trusted on this device.",
    compare: "Compare this exactly with the fingerprint on the other phone’s Network screen. Do not trust it if any character differs.",
    keyChanged: "Warning: this peer’s key differs from the previously trusted fingerprint. Do not send alerts until you verify the new key in person.",
    oldFingerprint: "Previous",
    newFingerprint: "New",
    promptTitle: "Compare fingerprints on both phones",
    trust: "They match — trust peer",
    replaceTrust: "They match — replace key",
    forgetTitle: "Remove trust for this peer?",
    forgetBody: "Removing trust stops alert delivery to and message acceptance from this peer. You can compare fingerprints and trust it again later.",
    forget: "Remove trust",
    cancel: "Cancel",
    failed: "Could not save peer trust",
  };
}

function eventLabel(kind: "received" | "forwarded" | "queued" | "expired" | "failed" | "delivered", language: Language): string {
  const labels = {
    received: { bn: "বার্তা পাওয়া গেছে", hi: "संदेश मिला", en: "Message received" },
    forwarded: { bn: "পরের ফোনে পাঠানো হয়েছে", hi: "अगले फ़ोन को भेजा गया", en: "Forwarded to next phone" },
    queued: { bn: "কিউতে রাখা হয়েছে", hi: "कतार में रखा गया", en: "Queued for retry" },
    expired: { bn: "মেয়াদ শেষ", hi: "समाप्त", en: "Expired" },
    failed: { bn: "ব্যর্থ", hi: "विफल", en: "Failed" },
    delivered: { bn: "প্রাপকের প্রমাণ পাওয়া গেছে", hi: "प्राप्तकर्ता की पुष्टि मिली", en: "Recipient evidence received" },
  };
  return labels[kind][language];
}

function makeStyles(colors: SsaColors) {
  return StyleSheet.create({
    content: { padding: 18, gap: 13, paddingBottom: 30 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    eyebrow: { color: colors.faint, fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
    title: { color: colors.foreground, fontSize: 25, fontWeight: "900", marginTop: 5 },
    subtitle: { color: colors.muted, fontSize: 12, marginTop: 5, maxWidth: 260 },
    back: { color: colors.primary, fontSize: 13, fontWeight: "800" },
    statusCard: { gap: 12, backgroundColor: colors.surfaceRaised },
    statusTitle: { color: colors.foreground, fontSize: 18, fontWeight: "900" },
    statusBody: { color: colors.muted, fontSize: 12, lineHeight: 19 },
    sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
    section: { color: colors.foreground, fontSize: 14, fontWeight: "900" },
    count: { color: colors.primary, fontSize: 12, fontWeight: "800" },
    empty: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 10 },
    requestCard: { borderColor: colors.warning, backgroundColor: colors.surfaceRaised },
    requestRow: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 10, marginTop: 10, flexDirection: "row", alignItems: "center" },
    requestCopy: { flex: 1 },
    peerName: { color: colors.foreground, fontSize: 13, fontWeight: "800" },
    peerMeta: { color: colors.faint, fontSize: 10, marginTop: 3 },
    requestActions: { flexDirection: "row", gap: 7, marginLeft: 8 },
    smallButton: { minHeight: 36, paddingHorizontal: 10 },
    peerBlock: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4, marginTop: 4 },
    transport: { color: colors.primary, fontSize: 10, fontWeight: "800", marginLeft: 52, marginTop: -8, marginBottom: 4 },
    fingerprintCard: { borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 10, backgroundColor: colors.surfaceRaised },
    fingerprintLabel: { color: colors.muted, fontSize: 10, fontWeight: "800" },
    fingerprintValue: { color: colors.foreground, fontSize: 12, fontWeight: "900", letterSpacing: 0.5, marginTop: 5, lineHeight: 19 },
    fingerprintHint: { color: colors.faint, fontSize: 10, lineHeight: 15, marginTop: 5 },
    trustButton: { minHeight: 38, marginTop: 9 },
    trustError: { color: colors.danger, fontSize: 10, lineHeight: 14, marginTop: 6 },
    eventRow: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 9 },
    eventDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
    eventCopy: { flex: 1 },
    eventTitle: { color: colors.foreground, fontSize: 12, fontWeight: "800" },
    eventMeta: { color: colors.faint, fontSize: 10, lineHeight: 15, marginTop: 2 },
    body: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 8, marginBottom: 12 },
  });
}
