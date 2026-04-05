import type { WsClient } from "./ws";

export function sendMessage(wsClient: WsClient, text: string): boolean {
  return wsClient.sendText(text);
}
