import type { WSContext } from "hono/ws";
import type { ServerMessageMap } from "@float-code/shared/protocol";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "registry" });

export class ConnectionRegistry {
  private clients = new Set<WSContext>();

  add(ws: WSContext): void {
    this.clients.add(ws);
  }

  remove(ws: WSContext): void {
    this.clients.delete(ws);
  }

  getAll(): ReadonlySet<WSContext> {
    return this.clients;
  }

  broadcast<T extends keyof ServerMessageMap>(
    type: T,
    payload: ServerMessageMap[T],
  ): void {
    log.debug({ type, clientCount: this.clients.size }, "broadcast");
    const msg = this.serialize(type, payload);
    for (const ws of this.clients) {
      try {
        ws.send(msg);
      } catch {
        // closing
      }
    }
  }

  sendTo<T extends keyof ServerMessageMap>(
    ws: WSContext,
    type: T,
    payload: ServerMessageMap[T],
  ): void {
    try {
      ws.send(this.serialize(type, payload));
    } catch {
      // closing
    }
  }

  private serialize<T extends keyof ServerMessageMap>(
    type: T,
    payload: ServerMessageMap[T],
  ): string {
    return JSON.stringify({
      type,
      ...payload,
      timestamp: new Date().toISOString(),
    });
  }
}
