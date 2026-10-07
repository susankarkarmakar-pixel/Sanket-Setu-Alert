import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { SsaButton, SsaCard } from "@/components/ssa/ssa-ui";
import { useSsaTheme, type SsaColors } from "@/lib/ssa-theme";

export default function OnboardingScreen() {
  const { colors, text, language } = useSsaTheme();
  const styles = makeStyles(colors);
  const steps = language === "bn" ? [
    ["১", "কাছের ফোন খুঁজুন", "Nearby Connections ব্যবহার করে কাছাকাছি SSA ফোনের সঙ্গে সংযোগ তৈরি হয়। ইন্টারনেট থাকা বাধ্যতামূলক নয়।"],
    ["২", "পরিচয়ের fingerprint মিলান", "Network screen-এ দুই ফোনের public-key fingerprint মিলিয়ে তারপরই peer-কে trust করুন। একটি অক্ষরও না মিললে trust করবেন না।"],
    ["৩", "বার্তা এনক্রিপ্ট হয়", "Alert শুধু trust করা recipient-এর public key-এ encrypted হয়। মাঝের trust করা relay ফোন ciphertext পড়তে পারে না।"],
    ["৪", "সেতু ও delivery status", "Trust করা relay ফোন packet এগিয়ে দিতে পারে। Queue, relay এবং পৌঁছানোর প্রমাণ আলাদা; native send acceptance মানেই delivered নয়।"],
  ] : language === "hi" ? [
    ["१", "नज़दीकी फ़ोन खोजें", "Nearby Connections से नज़दीकी SSA फ़ोन से जुड़ने की कोशिश होती है। इंटरनेट ज़रूरी नहीं है।"],
    ["२", "Fingerprint मिलाकर पहचान trust करें", "Network screen पर दोनों फ़ोन के public-key fingerprint मिलाएँ। एक भी अक्षर अलग हो तो trust न करें।"],
    ["३", "संदेश एन्क्रिप्ट होता है", "Alert केवल trusted recipient की public key से encrypted होता है। बीच का trusted relay ciphertext नहीं पढ़ सकता।"],
    ["४", "सेतु और delivery स्थिति", "Trusted relay packet आगे भेज सकता है। Queue, relay और पहुँचने का प्रमाण अलग हैं; native send acceptance को delivered नहीं कहते।"],
  ] : [
    ["1", "Find nearby phones", "Nearby Connections tries to connect to SSA phones nearby. Internet access is not required."],
    ["2", "Compare identity fingerprints", "Compare the public-key fingerprints on both Network screens before trusting a peer. Do not trust a mismatch."],
    ["3", "Alerts are end-to-end encrypted", "An alert is encrypted only to a trusted recipient’s public key. A trusted relay phone cannot read the ciphertext."],
    ["4", "Trusted bridges; honest status", "A trusted relay can forward the packet. Queued, relaying, and delivery evidence are separate; native send acceptance is not delivery."],
  ];
  return <ScreenContainer edges={["top", "left", "right", "bottom"]}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}><Text style={styles.eyebrow}>SSA / HOW IT WORKS</Text><Text onPress={() => router.back()} style={styles.back}>{text.back}</Text></View>
    <Text style={styles.title}>{text.appName}</Text><Text style={styles.tagline}>{text.tagline}</Text><Text style={styles.intro}>{language === "bn" ? "কম সংযোগের এলাকায় জরুরি তথ্যের জন্য কাছের ফোনগুলোকে ছোট ছোট সেতু হিসেবে ব্যবহার করার চেষ্টা।" : language === "hi" ? "कम कनेक्शन वाले क्षेत्रों में आपातकालीन जानकारी के लिए नज़दीकी फ़ोन छोटे सेतु की तरह काम कर सकते हैं।" : "In low-connectivity areas, nearby phones can act as small bridges for emergency information."}</Text>
    {steps.map(([number, title, body]) => <SsaCard key={number} style={styles.step}><View style={styles.number}><Text style={styles.numberText}>{number}</Text></View><View style={styles.stepCopy}><Text style={styles.stepTitle}>{title}</Text><Text style={styles.stepBody}>{body}</Text></View></SsaCard>)}
    <SsaCard style={styles.boundary}><Text style={styles.boundaryTitle}>{language === "bn" ? "মনে রাখবেন" : language === "hi" ? "ध्यान रखें" : "Remember"}</Text><Text style={styles.stepBody}>{language === "bn" ? "এটি best-effort emergency communication। Nearby radio range, অনুমতি, battery policy, Android version, OEM behavior এবং অন্য ফোনের উপস্থিতির ওপর ফল নির্ভর করে। জীবন-রক্ষাকারী সিদ্ধান্তে স্থানীয় প্রশাসন, ফোন কল বা অন্য উপলব্ধ পথও ব্যবহার করুন।" : language === "hi" ? "यह best-effort emergency communication है। परिणाम radio range, permissions, battery policy, Android version, OEM behavior और दूसरे फ़ोन की उपलब्धता पर निर्भर करता है। जीवन बचाने वाले निर्णयों में स्थानीय प्रशासन, फ़ोन कॉल या अन्य उपलब्ध रास्तों का भी उपयोग करें।" : "This is best-effort emergency communication. Results depend on radio range, permissions, battery policy, Android version, OEM behavior, and other phones nearby. For life-saving decisions, also use local administration, phone calls, or any other available path."}</Text></SsaCard>
    <SsaButton label={text.dashboard} onPress={() => router.replace("/")} />
  </ScrollView></ScreenContainer>;
}

function makeStyles(colors: SsaColors) {
  return StyleSheet.create({
    content: { padding: 18, gap: 13, paddingBottom: 30 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    eyebrow: { color: colors.faint, fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
    back: { color: colors.primary, fontSize: 13, fontWeight: "800" },
    title: { color: colors.foreground, fontSize: 28, fontWeight: "900", marginTop: 7 },
    tagline: { color: colors.primary, fontSize: 13, fontWeight: "800" },
    intro: { color: colors.muted, fontSize: 13, lineHeight: 21, marginBottom: 2 },
    step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
    number: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
    numberText: { color: colors.primary, fontSize: 16, fontWeight: "900" },
    stepCopy: { flex: 1, gap: 5 },
    stepTitle: { color: colors.foreground, fontSize: 15, fontWeight: "900" },
    stepBody: { color: colors.muted, fontSize: 12, lineHeight: 19 },
    boundary: { borderColor: colors.warning, backgroundColor: colors.surfaceRaised },
    boundaryTitle: { color: colors.warning, fontSize: 14, fontWeight: "900", marginBottom: 7 },
  });
}
