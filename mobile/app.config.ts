import type { ExpoConfig } from "expo/config";

const androidPackage = process.env.SSA_ANDROID_PACKAGE ?? "in.sanketsetu.alert";

const config: ExpoConfig = {
  name: "Sanket Setu Alert (SSA)",
  slug: "sanket-setu-alert",
  version: process.env.SSA_VERSION ?? "0.1.1",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  // Use the legacy architecture for the first hardware pilot while custom native modules are validated.
  newArchEnabled: false,
  scheme: "ssa",
  icon: "./assets/ssa-icon.png",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "in.sanketsetu.alert",
    infoPlist: {
      NSBluetoothAlwaysUsageDescription:
        "Sanket Setu Alert uses nearby connections to discover devices and relay emergency alerts without internet.",
      UIBackgroundModes: ["bluetooth-central", "bluetooth-peripheral"],
    },
  },
  android: {
    package: androidPackage,
    versionCode: 2,
    permissions: [
      "BLUETOOTH_SCAN",
      "BLUETOOTH_ADVERTISE",
      "BLUETOOTH_CONNECT",
      "NEARBY_WIFI_DEVICES",
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_WIFI_STATE",
      "CHANGE_WIFI_STATE",
      "POST_NOTIFICATIONS",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_CONNECTED_DEVICE",
      "RECEIVE_BOOT_COMPLETED",
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-sqlite", { useSQLCipher: true }],
    ["expo-notifications", { defaultChannel: "ssa-emergency-v1", color: "#B42332" }],
    ["expo-build-properties", { android: { minSdkVersion: 26 } }],
  ],
  experiments: {
    typedRoutes: true,
  },
};

export default config;
