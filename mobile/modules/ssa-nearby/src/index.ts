import { requireNativeModule } from "expo";
import { Platform } from "react-native";

export type NearbyPeerState = "discovered" | "connecting" | "connected" | "rejected" | "disconnected";

export interface NearbyPeer {
  endpointId: string;
  name: string;
  state: NearbyPeerState;
  discoveredAt: number;
  lastSeenAt: number;
  authenticationToken?: string;
}

export type NearbyEvent =
  | { type: "status"; state: "starting" | "ready" | "stopped" | "error"; detail?: string }
  | { type: "peer"; peer: NearbyPeer }
  | { type: "payload"; endpointId: string; bytes: number[] }
  | { type: "connection-request"; endpointId: string; name: string; authenticationToken: string };

interface NativeNearbyModule {
  addListener(eventName: "SsaNearbyEvent", listener: (event: NearbyEvent) => void): { remove(): void };
  removeListeners(count: number): void;
  attach(): Promise<void>;
  start(serviceId: string, localName: string): Promise<void>;
  stop(): Promise<void>;
  openBatterySettings(): Promise<void>;
  getReadiness(): Promise<{ bluetoothEnabled: boolean; wifiEnabled: boolean; permissionsGranted: boolean }>;
  acceptConnection(endpointId: string): Promise<void>;
  rejectConnection(endpointId: string): Promise<void>;
  sendPayload(endpointId: string, bytes: number[]): Promise<void>;
}

let nativeModule: NativeNearbyModule | undefined;
if (Platform.OS === "android") {
  try {
    nativeModule = requireNativeModule<NativeNearbyModule>("SsaNearby");
  } catch {
    nativeModule = undefined;
  }
}

export const NearbyNative = {
  isAvailable: Platform.OS === "android" && Boolean(nativeModule),

  async attach(): Promise<void> {
    await nativeModule?.attach();
  },

  async start(serviceId: string, localName: string): Promise<void> {
    if (!nativeModule) throw new Error("SSA Nearby native module is not installed");
    await nativeModule.start(serviceId, localName);
  },

  async stop(): Promise<void> {
    await nativeModule?.stop();
  },

  async openBatterySettings(): Promise<void> {
    if (!nativeModule) throw new Error("SSA Nearby native module is not installed");
    await nativeModule.openBatterySettings();
  },

  async getReadiness(): Promise<{ bluetoothEnabled: boolean; wifiEnabled: boolean; permissionsGranted: boolean }> {
    if (!nativeModule) return { bluetoothEnabled: false, wifiEnabled: false, permissionsGranted: false };
    return nativeModule.getReadiness();
  },

  async acceptConnection(endpointId: string): Promise<void> {
    if (!nativeModule) throw new Error("SSA Nearby native module is not installed");
    await nativeModule.acceptConnection(endpointId);
  },

  async rejectConnection(endpointId: string): Promise<void> {
    if (!nativeModule) throw new Error("SSA Nearby native module is not installed");
    await nativeModule.rejectConnection(endpointId);
  },

  async sendPayload(endpointId: string, bytes: number[]): Promise<void> {
    if (!nativeModule) throw new Error("SSA Nearby native module is not installed");
    if (!endpointId || bytes.length === 0) throw new Error("Nearby endpoint and payload are required");
    if (bytes.length > 32 * 1024) throw new Error("Nearby bytes payload exceeds the 32 KB limit");
    await nativeModule.sendPayload(endpointId, bytes);
  },

  subscribe(listener: (event: NearbyEvent) => void): () => void {
    if (!nativeModule) return () => undefined;
    const subscription = nativeModule.addListener("SsaNearbyEvent", listener);
    return () => subscription.remove();
  },
};
