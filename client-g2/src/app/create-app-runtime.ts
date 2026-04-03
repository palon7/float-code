import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import { G2DisplayManager } from "../g2/display-manager";
import { G2Runtime } from "../g2/runtime/g2-runtime";
import { createConnectingState } from "../g2/states/connecting/state";
import { createErrorState } from "../g2/states/error/state";
import { buildConnectingPage } from "../g2/states/connecting/view";
import { createVoiceInputService } from "../voice-input/voice-input-service";
import { WsClient } from "../client/ws";
import { HttpClient } from "../client/http";
import { useAppStore } from "./app-store";
import { deriveUrls } from "../constants";

export interface AppRuntimeHandle {
  runtime: G2Runtime;
  wsClient: WsClient;
  httpClient: HttpClient;
}

export function createAppRuntime(
  bridge: EvenAppBridge,
  displayManager: G2DisplayManager,
  onDebugLog?: (message: string) => void,
): AppRuntimeHandle {
  const { serverHost: host, serverToken: token } = useAppStore.getState();

  const hasConfig = Boolean(host && token);
  const urls = hasConfig ? deriveUrls(host) : { httpUrl: "", wsUrl: "" };

  const wsClient = new WsClient(urls.wsUrl, token);
  const httpClient = new HttpClient(urls.httpUrl, token);

  const initialState = hasConfig
    ? createConnectingState()
    : createErrorState("Please configure server in app settings");

  return {
    httpClient,
    runtime: new G2Runtime({
      bridge,
      displayManager,
      initialState,
      startupPage: buildConnectingPage(),
      voiceInput: createVoiceInputService(bridge, onDebugLog),
      wsClient,
      httpClient,
      onDebugLog,
    }),
    wsClient,
  };
}
