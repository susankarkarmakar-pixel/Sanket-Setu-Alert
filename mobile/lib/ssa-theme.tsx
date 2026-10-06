import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StructuredAlertKind } from "@sanketly/domain";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useColorScheme } from "react-native";

export type SsaLanguage = "bn" | "en" | "hi";
export type SsaThemeMode = "light" | "dark" | "system";
export type SsaUserMode = "resident" | "volunteer";

export type SsaColors = {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  foreground: string;
  muted: string;
  faint: string;
  primary: string;
  primaryInk: string;
  success: string;
  warning: string;
  danger: string;
  criticalSurface: string;
  input: string;
};

const THEME_KEY = "ssa.theme-mode.v1";
const LANGUAGE_KEY = "ssa.language.v1";
const USER_MODE_KEY = "ssa.user-mode.v1";

export const SSA_PALETTES: Record<"light" | "dark", SsaColors> = {
  dark: {
    background: "#0B1020",
    surface: "#151D34",
    surfaceRaised: "#1B2744",
    border: "#2B3859",
    foreground: "#F6F7FB",
    muted: "#AAB5CF",
    faint: "#74809D",
    primary: "#8EA9FF",
    primaryInk: "#10162A",
    success: "#5EE1A3",
    warning: "#FFC56E",
    danger: "#FF7F86",
    criticalSurface: "#321F32",
    input: "#10182C",
  },
  light: {
    background: "#F6F8FC",
    surface: "#FFFFFF",
    surfaceRaised: "#EEF3FF",
    border: "#D7DEEC",
    foreground: "#172033",
    muted: "#56627A",
    faint: "#74809D",
    primary: "#315CCF",
    primaryInk: "#FFFFFF",
    success: "#087A4B",
    warning: "#A45D00",
    danger: "#B42332",
    criticalSurface: "#FFF0F2",
    input: "#FFFFFF",
  },
};

const TEXT = {
  bn: {
    appName: "Sanket Setu Alert",
    tagline: "যখন সব বন্ধ, সেতু খোলা থাকে",
    dashboard: "জরুরি ড্যাশবোর্ড",
    alerts: "আমার সতর্কবার্তা",
    network: "নেটওয়ার্ক",
    settings: "সেটিংস",
    onboarding: "SSA কীভাবে কাজ করে",
    start: "কাছের ফোন খুঁজুন",
    stop: "নেটওয়ার্ক থামান",
    sendAlert: "জরুরি বার্তা পাঠান",
    offline: "অফলাইন",
    connected: "সংযোগ সক্রিয়",
    needsAttention: "মনোযোগ দরকার",
    emergencyWork: "জরুরি কাজ",
    pilot: "SSA পাইলট",
    recentAlerts: "এক নজরে সতর্কবার্তা",
    seeAll: "সব দেখুন",
    savedRecords: (count: number) => `${count}টি সংরক্ষিত রেকর্ড`,
    noRecords: "এখনও কোনো রেকর্ড নেই",
    nearbyPhones: "কাছের SSA ফোন",
    viewNetwork: "নেটওয়ার্ক দেখুন",
    noKnownPhones: "এখনও কোনো পরিচিত ফোন নেই। কাছের ফোন খুঁজতে উপরের বোতাম চাপুন এবং দুই ফোনেই Nearby অনুমতি দিন।",
    learnMore: "SSA কীভাবে কাজ করে জানুন ›",
    sendToNearby: "আপনার বার্তা কাছের ফোনে পৌঁছাবে",
    offlineRelay: "ইন্টারনেট না থাকলেও, SSA আশেপাশের যাচাই করা ফোনের মাধ্যমে জরুরি বার্তা এগিয়ে দেয়।",
    queueHint: "বার্তা আগে কিউতে থাকবে। সফলভাবে পৌঁছানোর প্রমাণ না আসা পর্যন্ত ‘পৌঁছেছে’ বলা হবে না।",
    nearbyRequest: "কাছের ফোন সংযোগ চাইছে",
    verifyRequest: "দুই ফোনে একই নিরাপত্তা কোড মিলিয়ে নিন। ফোনটি কাছে এবং আপনার SSA পাইলট দলের হলে তবেই অনুমতি দিন।",
    permission: "অনুমতি",
    no: "না",
    networkReady: "নেটওয়ার্ক প্রস্তুতি",
    language: "ভাষা",
    theme: "রঙের ধরন",
    light: "লাইট মোড",
    dark: "ডার্ক মোড",
    system: "ফোনের সেটিং অনুসরণ করুন",
    active: "সক্রিয়",
    languageMeta: "অ্যাপের লেখা ও বার্তার লেবেল",
    privacy: "গোপনীয়তা",
    emergencyPersistence: "জরুরি মোড চালু রাখা",
    device: "এই ডিভাইস",
    batterySettings: "ব্যাটারি সেটিংস খুলুন",
    close: "বন্ধ",
    newAlert: "নতুন জরুরি বার্তা",
    noAlerts: "এখনও কোনো সতর্কবার্তা নেই",
    alertEmptyBody: "জরুরি অবস্থায় গঠনমূলক বার্তা পাঠান। বার্তাটি আগে এনক্রিপ্ট হয়ে কিউতে যাবে, তারপর কাছের যাচাই করা ফোনে পৌঁছানোর চেষ্টা হবে।",
    compose: "জরুরি বার্তা তৈরি করুন",
    cancel: "বাতিল",
    chooseType: "কী হয়েছে?",
    priority: "অগ্রাধিকার",
    title: "শিরোনাম",
    description: "বিবরণ",
    village: "গ্রাম / এলাকা",
    ward: "ওয়ার্ড",
    recipient: "কাছের যাচাই করা ফোন",
    selectPeer: "একটি যাচাই করা ফোন বেছে নিন",
    submit: "এনক্রিপ্ট করে পাঠান",
    required: "প্রয়োজনীয়",
    queued: "কিউতে সংরক্ষিত",
    delivery: "পাঠানোর অবস্থা",
    back: "ফিরুন",
    english: "ইংরেজি",
    hindi: "হিন্দি",
    bengali: "বাংলা",
  },
  en: {
    appName: "Sanket Setu Alert",
    tagline: "When everything is closed, the bridge stays open",
    dashboard: "Emergency Dashboard",
    alerts: "My Alerts",
    network: "Network",
    settings: "Settings",
    onboarding: "How SSA Works",
    start: "Find nearby phones",
    stop: "Stop network",
    sendAlert: "Send emergency alert",
    offline: "Offline",
    connected: "Connected",
    needsAttention: "Needs attention",
    emergencyWork: "Emergency actions",
    pilot: "SSA pilot",
    recentAlerts: "Alert overview",
    seeAll: "See all",
    savedRecords: (count: number) => `${count} saved record${count === 1 ? "" : "s"}`,
    noRecords: "No records yet",
    nearbyPhones: "Nearby SSA phones",
    viewNetwork: "View network",
    noKnownPhones: "No known phones yet. Find nearby phones above and grant Nearby permission on both devices.",
    learnMore: "Learn how SSA works ›",
    sendToNearby: "Your message reaches nearby phones",
    offlineRelay: "Even without internet, SSA forwards emergency messages through verified phones nearby.",
    queueHint: "The message is queued first. It is not called delivered until delivery evidence is received.",
    nearbyRequest: "A nearby phone wants to connect",
    verifyRequest: "Compare the security code on both phones. Approve only if it matches and the phone is nearby and part of your SSA pilot group.",
    permission: "Allow",
    no: "No",
    networkReady: "Network readiness",
    language: "Language",
    theme: "Appearance",
    light: "Light mode",
    dark: "Dark mode",
    system: "Follow phone setting",
    active: "Active",
    languageMeta: "App text and alert labels",
    privacy: "Privacy",
    emergencyPersistence: "Emergency mode persistence",
    device: "This device",
    batterySettings: "Open battery settings",
    close: "Close",
    newAlert: "New emergency alert",
    noAlerts: "No alerts yet",
    alertEmptyBody: "Create a structured alert in an emergency. It is encrypted and queued before SSA tries nearby verified phones.",
    compose: "Create emergency alert",
    cancel: "Cancel",
    chooseType: "What happened?",
    priority: "Priority",
    title: "Title",
    description: "Description",
    village: "Village / area",
    ward: "Ward",
    recipient: "Nearby verified phone",
    selectPeer: "Select a verified phone",
    submit: "Encrypt and send",
    required: "Required",
    queued: "Queued",
    delivery: "Delivery status",
    back: "Back",
    english: "English",
    hindi: "Hindi",
    bengali: "Bengali",
  },
  hi: {
    appName: "Sanket Setu Alert",
    tagline: "जब सब बंद हो, सेतु खुला रहता है",
    dashboard: "आपातकालीन डैशबोर्ड",
    alerts: "मेरे अलर्ट",
    network: "नेटवर्क",
    settings: "सेटिंग्स",
    onboarding: "SSA कैसे काम करता है",
    start: "नज़दीकी फ़ोन खोजें",
    stop: "नेटवर्क रोकें",
    sendAlert: "आपातकालीन अलर्ट भेजें",
    offline: "ऑफ़लाइन",
    connected: "कनेक्टेड",
    needsAttention: "ध्यान आवश्यक",
    emergencyWork: "आपातकालीन काम",
    pilot: "SSA पायलट",
    recentAlerts: "अलर्ट का अवलोकन",
    seeAll: "सभी देखें",
    savedRecords: (count: number) => `${count} सुरक्षित रिकॉर्ड`,
    noRecords: "अभी कोई रिकॉर्ड नहीं",
    nearbyPhones: "नज़दीकी SSA फ़ोन",
    viewNetwork: "नेटवर्क देखें",
    noKnownPhones: "अभी कोई परिचित फ़ोन नहीं है। ऊपर से फ़ोन खोजें और दोनों फ़ोन में Nearby अनुमति दें।",
    learnMore: "SSA कैसे काम करता है ›",
    sendToNearby: "आपका संदेश नज़दीकी फ़ोन तक पहुँचेगा",
    offlineRelay: "इंटरनेट न होने पर भी SSA नज़दीकी सत्यापित फ़ोन से आपातकालीन संदेश आगे भेजता है।",
    queueHint: "संदेश पहले कतार में सुरक्षित होगा। पहुँचने का प्रमाण मिलने तक इसे पहुँचा हुआ नहीं कहा जाएगा।",
    nearbyRequest: "एक नज़दीकी फ़ोन कनेक्ट होना चाहता है",
    verifyRequest: "दोनों फ़ोन पर सुरक्षा कोड मिलाएँ। कोड समान हो और फ़ोन पास में तथा आपके SSA पायलट समूह का हो, तभी अनुमति दें।",
    permission: "अनुमति",
    no: "नहीं",
    networkReady: "नेटवर्क तैयारी",
    language: "भाषा",
    theme: "रंग रूप",
    light: "लाइट मोड",
    dark: "डार्क मोड",
    system: "फ़ोन की सेटिंग अपनाएँ",
    active: "सक्रिय",
    languageMeta: "ऐप का पाठ और अलर्ट लेबल",
    privacy: "गोपनीयता",
    emergencyPersistence: "आपातकालीन मोड जारी रखना",
    device: "यह डिवाइस",
    batterySettings: "बैटरी सेटिंग खोलें",
    close: "बंद",
    newAlert: "नया आपातकालीन अलर्ट",
    noAlerts: "अभी कोई अलर्ट नहीं",
    alertEmptyBody: "आपातकाल में संरचित अलर्ट भेजें। यह एन्क्रिप्ट होकर कतार में जाएगा और फिर नज़दीकी सत्यापित फ़ोन तक पहुँचने की कोशिश होगी।",
    compose: "आपातकालीन अलर्ट बनाएँ",
    cancel: "रद्द करें",
    chooseType: "क्या हुआ?",
    priority: "प्राथमिकता",
    title: "शीर्षक",
    description: "विवरण",
    village: "गाँव / क्षेत्र",
    ward: "वार्ड",
    recipient: "नज़दीकी सत्यापित फ़ोन",
    selectPeer: "एक सत्यापित फ़ोन चुनें",
    submit: "एन्क्रिप्ट करके भेजें",
    required: "ज़रूरी",
    queued: "कतार में सुरक्षित",
    delivery: "भेजने की स्थिति",
    back: "वापस",
    english: "अंग्रेज़ी",
    hindi: "हिन्दी",
    bengali: "बंगाली",
  },
} as const;

export type SsaText = {
  [Key in keyof typeof TEXT.bn]: typeof TEXT.bn[Key] extends (...args: infer Args) => infer Result ? (...args: Args) => Result : string;
};

interface SsaThemeContextValue {
  colors: SsaColors;
  language: SsaLanguage;
  themeMode: SsaThemeMode;
  userMode: SsaUserMode;
  resolvedTheme: "light" | "dark";
  text: SsaText;
  setLanguage(language: SsaLanguage): Promise<void>;
  setThemeMode(mode: SsaThemeMode): Promise<void>;
  setUserMode(mode: SsaUserMode): Promise<void>;
}

const SsaThemeContext = createContext<SsaThemeContextValue | null>(null);

export function SsaThemeProvider({ children }: PropsWithChildren) {
  const systemTheme = useColorScheme() === "dark" ? "dark" : "light";
  const [language, setLanguageState] = useState<SsaLanguage>("bn");
  const [themeMode, setThemeModeState] = useState<SsaThemeMode>("system");
  const [userMode, setUserModeState] = useState<SsaUserMode>("resident");

  useEffect(() => {
    void Promise.all([AsyncStorage.getItem(LANGUAGE_KEY), AsyncStorage.getItem(THEME_KEY), AsyncStorage.getItem(USER_MODE_KEY)]).then(([savedLanguage, savedTheme, savedUserMode]) => {
      if (savedLanguage === "bn" || savedLanguage === "en" || savedLanguage === "hi") setLanguageState(savedLanguage);
      if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "system") setThemeModeState(savedTheme);
      if (savedUserMode === "resident" || savedUserMode === "volunteer") setUserModeState(savedUserMode);
    }).catch(() => undefined);
  }, []);

  const setLanguage = useCallback(async (next: SsaLanguage) => {
    setLanguageState(next);
    await AsyncStorage.setItem(LANGUAGE_KEY, next);
  }, []);

  const setThemeMode = useCallback(async (next: SsaThemeMode) => {
    setThemeModeState(next);
    await AsyncStorage.setItem(THEME_KEY, next);
  }, []);

  const setUserMode = useCallback(async (next: SsaUserMode) => {
    setUserModeState(next);
    await AsyncStorage.setItem(USER_MODE_KEY, next);
  }, []);

  const resolvedTheme = themeMode === "system" ? systemTheme : themeMode;
  const value = useMemo<SsaThemeContextValue>(() => ({
    colors: SSA_PALETTES[resolvedTheme],
    language,
    themeMode,
    userMode,
    resolvedTheme,
    text: TEXT[language],
    setLanguage,
    setThemeMode,
    setUserMode,
  }), [language, resolvedTheme, setLanguage, setThemeMode, setUserMode, themeMode, userMode]);

  return <SsaThemeContext.Provider value={value}>{children}</SsaThemeContext.Provider>;
}

export function useSsaTheme(): SsaThemeContextValue {
  const value = useContext(SsaThemeContext);
  if (!value) throw new Error("useSsaTheme must be used inside SsaThemeProvider");
  return value;
}

export function alertKindLabel(kind: StructuredAlertKind, language: SsaLanguage): string {
  const labels: Record<string, Record<SsaLanguage, string>> = {
    flood: { bn: "বন্যা", en: "Flood", hi: "बाढ़" },
    fire: { bn: "আগুন", en: "Fire", hi: "आग" },
    medical: { bn: "চিকিৎসা", en: "Medical", hi: "चिकित्सा" },
    missing_person: { bn: "নিখোঁজ ব্যক্তি", en: "Missing person", hi: "लापता व्यक्ति" },
    infrastructure: { bn: "রাস্তা / বিদ্যুৎ", en: "Infrastructure", hi: "सड़क / बिजली" },
    sos: { bn: "জরুরি সাহায্য", en: "SOS", hi: "आपात सहायता" },
  };
  return labels[String(kind)]?.[language] ?? String(kind);
}

export function priorityLabel(priority: string, language: SsaLanguage): string {
  const labels: Record<string, Record<SsaLanguage, string>> = {
    critical: { bn: "অতি জরুরি", en: "Critical", hi: "अति आवश्यक" },
    high: { bn: "জরুরি", en: "High", hi: "ज़रूरी" },
    normal: { bn: "সাধারণ", en: "Normal", hi: "सामान्य" },
  };
  return labels[priority]?.[language] ?? priority;
}
