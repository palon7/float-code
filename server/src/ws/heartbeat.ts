import type { WebSocket, WebSocketServer } from "ws";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "heartbeat" });

const HEARTBEAT_INTERVAL_MS = 30_000;
const ALIVE_KEY = Symbol("alive");

type WsWithAlive = WebSocket & { [ALIVE_KEY]?: boolean };

export function startHeartbeat(wss: WebSocketServer): NodeJS.Timeout {
  wss.on("connection", (ws: WsWithAlive) => {
    ws[ALIVE_KEY] = true;
    ws.on("pong", () => {
      ws[ALIVE_KEY] = true;
    });
  });

  return setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as WsWithAlive;
      if (ws[ALIVE_KEY] === false) {
        log.debug("Heartbeat: terminated inactive client");
        ws.terminate();
        continue;
      }
      ws[ALIVE_KEY] = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
}
