import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import type { G2DisplayManager } from "../display-manager";
import type { VoiceInputSession } from "../../voice-input/service-types";
import type { WsClient } from "../../client/ws";
import type { HttpClient } from "../../client/http";
import type { G2State } from "./g2-state";

export interface G2Context {
  bridge: EvenAppBridge;
  display: G2DisplayManager;
  wsClient: WsClient;
  httpClient: HttpClient;
  transition: (next: G2State) => Promise<void>;
  startVoiceSession: (options?: {
    maxSessionMs?: number;
  }) => Promise<VoiceInputSession>;
  stopVoiceSession: (reason?: "manual_confirm" | "completed") => Promise<void>;
  getVoiceSession: () => VoiceInputSession | null;
}
