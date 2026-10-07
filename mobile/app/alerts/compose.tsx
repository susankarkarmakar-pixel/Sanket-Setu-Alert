import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { createStructuredAlert, type AlertPriority, type StructuredAlertKind } from "@sanketly/domain";
import { ScreenContainer } from "@/components/screen-container";
import { AlertTypeTile, PriorityChip, SsaButton, SsaCard } from "@/components/ssa/ssa-ui";
import { ALERT_KIND_ORDER, ALERT_PRIORITY_LABELS } from "@/constants/ssa";
import { alertKindLabel, priorityLabel, useSsaTheme, type SsaColors } from "@/lib/ssa-theme";
import { createId } from "@/lib/storage";
import { useSanketly } from "@/lib/sanketly-provider";

export default function ComposeAlertScreen() {
  const params = useLocalSearchParams<{ kind?: string }>();
  const { peers, queueAlert } = useSanketly();
  const { colors, text, language } = useSsaTheme();
  const styles = makeStyles(colors);
  const [kind, setKind] = useState<StructuredAlertKind>(ALERT_KIND_ORDER.includes(params.kind as StructuredAlertKind) ? params.kind as StructuredAlertKind : "sos");
  const [priority, setPriority] = useState<AlertPriority>("critical");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [village, setVillage] = useState("");
  const [ward, setWard] = useState("");
  const [targetPeerId, setTargetPeerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const authenticatedPeers = useMemo(() => peers.filter((peer) => peer.verified && peer.encryptionPublicKey && peer.connectionState === "connected"), [peers]);
  useEffect(() => {
    if (!targetPeerId && authenticatedPeers[0]) setTargetPeerId(authenticatedPeers[0].peerId);
  }, [authenticatedPeers, targetPeerId]);

  async function submit(): Promise<void> {
    if (!targetPeerId) { setError(language === "bn" ? "কোনো fingerprint-যাচাই করা কাছের ফোন নেই। Network-এ দুই ফোনের fingerprint মিলিয়ে peer-কে trust করুন।" : language === "hi" ? "कोई fingerprint-सत्यापित फ़ोन नहीं है। Network में दोनों फ़ोन का fingerprint मिलाकर peer को trust करें।" : "No fingerprint-verified phone is available. Compare both fingerprints and trust the peer in Network first."); return; }
    setError(null);
    try {
      setSending(true);
      const now = Date.now();
      const alert = createStructuredAlert({ alertId: createId("alert"), kind, priority, title: title.trim() || alertKindLabel(kind, language), description: description.trim(), village: village.trim(), ward: ward.trim() || undefined, createdAt: now, expiresAt: now + 24 * 60 * 60 * 1000 });
      await queueAlert(targetPeerId, alert);
      router.replace("/alerts");
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : (language === "bn" ? "বার্তা তৈরি করা যায়নি" : language === "hi" ? "संदेश नहीं बनाया जा सका" : "Could not create the alert"));
    } finally {
      setSending(false);
    }
  }

  return (
    <ScreenContainer edges={["top", "left", "right", "bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.header}><View><Text style={styles.eyebrow}>SSA / NEW ALERT</Text><Text style={styles.title}>{text.compose}</Text><Text style={styles.subtitle}>{language === "bn" ? "বার্তা এনক্রিপ্ট হয়ে fingerprint-মিলানো trusted ফোনে যাবে" : language === "hi" ? "संदेश encrypted होकर fingerprint-मिलाए trusted फ़ोन तक जाएगा" : "The message will be encrypted to a peer whose fingerprint you verified"}</Text></View><Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={styles.close}>{text.cancel}</Text></Pressable></View>
        <SsaCard><Text style={styles.label}>১ · {text.chooseType}</Text><View style={styles.typeGrid}>{ALERT_KIND_ORDER.map((entry) => <AlertTypeTile key={entry} kind={entry} selected={kind === entry} onPress={() => setKind(entry)} />)}</View></SsaCard>
        <SsaCard>
          <Text style={styles.label}>২ · {text.priority}</Text>
          <View style={styles.priorityRow}>{(Object.keys(ALERT_PRIORITY_LABELS) as AlertPriority[]).map((entry) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: priority === entry }} key={entry} onPress={() => setPriority(entry)} style={[styles.priorityOption, priority === entry && styles.priorityOptionSelected]}><PriorityChip priority={entry} /><Text style={styles.priorityEn}>{priorityLabel(entry, language)}</Text></Pressable>)}</View>
        </SsaCard>
        <SsaCard>
          <Text style={styles.label}>৩ · {language === "bn" ? "বিস্তারিত লিখুন" : language === "hi" ? "विवरण लिखें" : "Add details"}</Text>
          <TextInput value={title} onChangeText={setTitle} placeholder={`${text.title} (${language === "bn" ? "যেমন: বাঁধ ভেঙেছে" : language === "hi" ? "जैसे: बाँध टूट गया" : "for example: Dam breached"})`} placeholderTextColor={colors.faint} style={styles.input} returnKeyType="next" />
          <TextInput value={description} onChangeText={setDescription} placeholder={language === "bn" ? "মানুষকে কী জানতে বা করতে হবে?" : language === "hi" ? "लोगों को क्या जानना या करना चाहिए?" : "What should people know or do?"} placeholderTextColor={colors.faint} style={[styles.input, styles.multiline]} multiline textAlignVertical="top" />
          <View style={styles.twoInputs}><TextInput value={village} onChangeText={setVillage} placeholder={`${text.village}*`} placeholderTextColor={colors.faint} style={[styles.input, styles.half]} /><TextInput value={ward} onChangeText={setWard} placeholder={text.ward} placeholderTextColor={colors.faint} style={[styles.input, styles.half]} /></View>
        </SsaCard>
        <SsaCard>
          <Text style={styles.label}>৪ · {text.recipient}</Text>
          {authenticatedPeers.length === 0 ? <Text style={styles.empty}>{language === "bn" ? "কোনো fingerprint-যাচাই করা ফোন নেই। Network খুলে দুই ফোনের key fingerprint মিলিয়ে peer-কে trust করুন।" : language === "hi" ? "कोई fingerprint-सत्यापित फ़ोन नहीं है। Network खोलकर दोनों फ़ोन का key fingerprint मिलाएँ और peer को trust करें।" : "No fingerprint-verified phone is available. Open Network, compare both key fingerprints, and trust the peer."}</Text> : authenticatedPeers.map((peer) => <Pressable accessibilityRole="radio" accessibilityState={{ selected: targetPeerId === peer.peerId }} key={peer.peerId} onPress={() => setTargetPeerId(peer.peerId)} style={[styles.targetRow, targetPeerId === peer.peerId && styles.targetSelected]}><View style={styles.radio}>{targetPeerId === peer.peerId ? <View style={styles.radioDot} /> : null}</View><View><Text style={styles.targetName}>{peer.displayName ?? text.nearbyPhones}</Text><Text style={styles.targetMeta}>Nearby · fingerprint verified</Text></View></Pressable>)}
        </SsaCard>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <SsaButton label={sending ? (language === "bn" ? "এনক্রিপ্ট করা হচ্ছে…" : language === "hi" ? "एन्क्रिप्ट हो रहा है…" : "Encrypting…") : text.submit} onPress={() => void submit()} disabled={sending || !village.trim() || !description.trim()} variant="danger" />
        <Text style={styles.footnote}>{text.queueHint}</Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function makeStyles(colors: SsaColors) {
  return StyleSheet.create({
    content: { padding: 18, gap: 13, paddingBottom: 30 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 2 },
    eyebrow: { color: colors.faint, fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
    title: { color: colors.foreground, fontSize: 24, fontWeight: "900", marginTop: 5 },
    subtitle: { color: colors.muted, fontSize: 12, marginTop: 4, maxWidth: 250 },
    close: { color: colors.primary, fontSize: 13, fontWeight: "800", paddingTop: 3 },
    label: { color: colors.foreground, fontSize: 14, fontWeight: "900", marginBottom: 12 },
    typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between" },
    priorityRow: { flexDirection: "row", gap: 8 },
    priorityOption: { flex: 1, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    priorityOptionSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceRaised },
    priorityEn: { color: colors.faint, fontSize: 10 },
    input: { minHeight: 46, borderRadius: 11, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.input, color: colors.foreground, paddingHorizontal: 12, fontSize: 13, marginBottom: 9 },
    multiline: { minHeight: 92, paddingTop: 12 },
    twoInputs: { flexDirection: "row", gap: 9 },
    half: { flex: 1 },
    empty: { color: colors.muted, fontSize: 12, lineHeight: 18 },
    targetRow: { flexDirection: "row", alignItems: "center", gap: 11, padding: 11, borderRadius: 12, borderColor: colors.border, borderWidth: 1, marginTop: 8 },
    targetSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceRaised },
    radio: { width: 20, height: 20, borderRadius: 10, borderColor: colors.faint, borderWidth: 1, alignItems: "center", justifyContent: "center" },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
    targetName: { color: colors.foreground, fontSize: 13, fontWeight: "800" },
    targetMeta: { color: colors.faint, fontSize: 10, marginTop: 2 },
    error: { color: colors.danger, backgroundColor: colors.criticalSurface, borderColor: colors.danger, borderWidth: 1, borderRadius: 11, padding: 11, fontSize: 12, lineHeight: 18 },
    footnote: { color: colors.faint, textAlign: "center", fontSize: 10, lineHeight: 15 },
  });
}
