import { create } from "zustand";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import type { HttpClient } from "../client/http";
import type { ConnectionStatus, WsClient } from "../client/ws";
import {
  API_KEY_STORAGE_KEY,
  SERVER_HOST_STORAGE_KEY,
  SERVER_TOKEN_STORAGE_KEY,
} from "../constants";

const MAX_LOGS = 30;
const PERSIST_DEBOUNCE_MS = 500;

export type BridgeStatus = "connecting" | "connected" | "error";
type SettingField = "serverHost" | "serverToken" | "apiKey";

interface AppStoreState {
  bridge: EvenAppBridge | null;
  serverHost: string;
  serverToken: string;
  apiKey: string;
  bridgeStatus: BridgeStatus;
  wsStatus: ConnectionStatus;
  wsClient: WsClient | null;
  httpClient: HttpClient | null;
  debugLogs: string[];
  setBridge: (bridge: EvenAppBridge) => void;
  hydrateSettings: () => Promise<void>;
  setSetting: (field: SettingField, value: string) => void;
  appendDebugLog: (message: string) => void;
  setBridgeStatus: (status: BridgeStatus) => void;
  setWsStatus: (status: ConnectionStatus) => void;
  setWsClient: (client: WsClient | null) => void;
  setHttpClient: (client: HttpClient | null) => void;
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  bridge: null,
  serverHost: "",
  serverToken: "",
  apiKey: "",
  bridgeStatus: "connecting",
  wsStatus: { state: "disconnected" },
  wsClient: null,
  httpClient: null,
  debugLogs: [],

  setBridge: (bridge) => {
    set({ bridge });
  },

  hydrateSettings: async () => {
    const { bridge } = get();
    if (!bridge) return;
    const [apiKey, serverHost, serverToken] = await Promise.all([
      bridge.getLocalStorage(API_KEY_STORAGE_KEY),
      bridge.getLocalStorage(SERVER_HOST_STORAGE_KEY),
      bridge.getLocalStorage(SERVER_TOKEN_STORAGE_KEY),
    ]);
    set({
      apiKey: apiKey ?? "",
      serverHost: serverHost ?? "",
      serverToken: serverToken ?? "",
    });
  },

  setSetting: (field, value) => {
    set({ [field]: value } as Pick<AppStoreState, SettingField>);
  },

  appendDebugLog: (message) => {
    set((state) => ({
      debugLogs: [...state.debugLogs.slice(-(MAX_LOGS - 1)), message],
    }));
  },

  setBridgeStatus: (status) => {
    set({ bridgeStatus: status });
  },

  setWsStatus: (status) => {
    set({ wsStatus: status });
  },

  setWsClient: (client) => {
    set({ wsClient: client });
  },

  setHttpClient: (client) => {
    set({ httpClient: client });
  },
}));

export function setupSettingsPersistence(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;

  function flush(): void {
    const { bridge, apiKey, serverHost, serverToken } = useAppStore.getState();
    if (!bridge) return;
    dirty = false;
    Promise.all([
      bridge.setLocalStorage(API_KEY_STORAGE_KEY, apiKey),
      bridge.setLocalStorage(SERVER_HOST_STORAGE_KEY, serverHost),
      bridge.setLocalStorage(SERVER_TOKEN_STORAGE_KEY, serverToken),
    ]).catch((error) => {
      useAppStore
        .getState()
        .appendDebugLog(
          `settings persist error: ${error instanceof Error ? error.message : String(error)}`,
        );
    });
  }

  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (
      state.apiKey === prev.apiKey &&
      state.serverHost === prev.serverHost &&
      state.serverToken === prev.serverToken
    ) {
      return;
    }

    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, PERSIST_DEBOUNCE_MS);
  });

  return () => {
    clearTimeout(timer);
    if (dirty) flush();
    unsubscribe();
  };
}
