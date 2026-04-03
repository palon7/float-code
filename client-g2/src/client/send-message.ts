import type { WsClient } from "./ws";
import { useSessionStore } from "./session-store";

export function sendMessage(wsClient: WsClient, text: string): boolean {
  if (!wsClient.sendText(text)) return false;
  useSessionStore.getState().addUserMessage(text);
  return true;
}
