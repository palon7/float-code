import { create } from "zustand";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import type { HttpClient } from "../client/http";
import type { ConnectionStatus, WsClient } from "../client/ws";
import {
  API_KEY_STORAGE_KEY,
  SERVER_HOST_STORAGE_KEY,
  SERVER_TOKEN_STORAGE_KEY,
  SHOW_THINKING_STORAGE_KEY,
  SHOW_TOOL_USE_STORAGE_KEY,
  SIMPLE_MODE_STORAGE_KEY,
} from "../constants";

const MAX_LOGS = 30;
const PERSIST_DEBOUNCE_MS = 500;

export type BridgeStatus = "connecting" | "connected" | "error";
type StringSettingField = "serverHost" | "serverToken" | "apiKey";
type BoolSettingField = "simpleModeEnabled" | "showThinking" | "showToolUse";
export type SettingField = StringSettingField | BoolSettingField;

interface AppStoreState {
  bridge: EvenAppBridge | null;
  serverHost: string;
  serverToken: string;
  apiKey: string;
  simpleModeEnabled: boolean;
  showThinking: boolean;
  showToolUse: boolean;
  bridgeStatus: BridgeStatus;
  wsStatus: ConnectionStatus;
  wsClient: WsClient | null;
  httpClient: HttpClient | null;
  debugLogs: string[];
  setBridge: (bridge: EvenAppBridge) => void;
  hydrateSettings: () => Promise<void>;
  setSetting(field: StringSettingField, value: string): void;
  setSetting(field: BoolSettingField, value: boolean): void;
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
  simpleModeEnabled: false,
  showThinking: true,
  showToolUse: true,
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
    const [
      apiKey,
      serverHost,
      serverToken,
      simpleMode,
      showThinking,
      showToolUse,
    ] = await Promise.all([
      bridge.getLocalStorage(API_KEY_STORAGE_KEY),
      bridge.getLocalStorage(SERVER_HOST_STORAGE_KEY),
      bridge.getLocalStorage(SERVER_TOKEN_STORAGE_KEY),
      bridge.getLocalStorage(SIMPLE_MODE_STORAGE_KEY),
      bridge.getLocalStorage(SHOW_THINKING_STORAGE_KEY),
      bridge.getLocalStorage(SHOW_TOOL_USE_STORAGE_KEY),
    ]);
    set({
      apiKey: apiKey ?? "",
      serverHost: serverHost ?? "",
      serverToken: serverToken ?? "",
      simpleModeEnabled: simpleMode === "true",
      showThinking: showThinking !== "false",
      showToolUse: showToolUse !== "false",
    });
  },

  setSetting: (field: SettingField, value: string | boolean) => {
    set({ [field]: value } as Partial<AppStoreState>);
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
    const {
      bridge,
      apiKey,
      serverHost,
      serverToken,
      simpleModeEnabled,
      showThinking,
      showToolUse,
    } = useAppStore.getState();
    if (!bridge) return;
    dirty = false;
    Promise.all([
      bridge.setLocalStorage(API_KEY_STORAGE_KEY, apiKey),
      bridge.setLocalStorage(SERVER_HOST_STORAGE_KEY, serverHost),
      bridge.setLocalStorage(SERVER_TOKEN_STORAGE_KEY, serverToken),
      bridge.setLocalStorage(
        SIMPLE_MODE_STORAGE_KEY,
        String(simpleModeEnabled),
      ),
      bridge.setLocalStorage(SHOW_THINKING_STORAGE_KEY, String(showThinking)),
      bridge.setLocalStorage(SHOW_TOOL_USE_STORAGE_KEY, String(showToolUse)),
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
      state.serverToken === prev.serverToken &&
      state.simpleModeEnabled === prev.simpleModeEnabled &&
      state.showThinking === prev.showThinking &&
      state.showToolUse === prev.showToolUse
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
