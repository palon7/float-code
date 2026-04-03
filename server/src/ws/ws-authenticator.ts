import type { WSContext } from "hono/ws";
import { verifyToken } from "../auth/shared-token.js";
import { WsCloseCode } from "@float-code/shared/protocol";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "ws-auth" });

const AUTH_TIMEOUT_MS = 10_000;

/**
 * WebSocket 認証フローを管理する。
 *
 * WsGateway からトークン検証・認証タイムアウト管理を分離して、
 * Gateway がメッセージルーティングに集中できるようにする。
 */
export class WsAuthenticator {
  private pendingAuth = new Map<WSContext, NodeJS.Timeout>();
  private authenticated = new Set<WSContext>();

  authenticate(ws: WSContext, token: string, connId?: string): boolean {
    this.clearAuthTimeout(ws);

    if (!verifyToken(token)) {
      log.warn({ connId }, "WebSocket auth failed");
      this.sendErrorAndClose(
        ws,
        "Authentication failed",
        WsCloseCode.AUTH_FAILED,
      );
      return false;
    }

    this.authenticated.add(ws);
    log.info({ connId }, "WebSocket authenticated");
    return true;
  }

  isAuthenticated(ws: WSContext): boolean {
    return this.authenticated.has(ws);
  }

  removeConnection(ws: WSContext): void {
    this.authenticated.delete(ws);
  }

  startTimeout(ws: WSContext, connId?: string): void {
    const timer = setTimeout(() => {
      this.pendingAuth.delete(ws);
      log.warn({ connId }, "WebSocket auth timeout");
      this.sendErrorAndClose(
        ws,
        "Authentication timeout",
        WsCloseCode.AUTH_TIMEOUT,
      );
    }, AUTH_TIMEOUT_MS);
    this.pendingAuth.set(ws, timer);
  }

  isPending(ws: WSContext): boolean {
    return this.pendingAuth.has(ws);
  }

  clearAuthTimeout(ws: WSContext): void {
    const timer = this.pendingAuth.get(ws);
    if (timer) {
      globalThis.clearTimeout(timer);
      this.pendingAuth.delete(ws);
    }
  }

  stopAll(): void {
    for (const timer of this.pendingAuth.values()) {
      globalThis.clearTimeout(timer);
    }
    this.pendingAuth.clear();
  }

  private sendErrorAndClose(
    ws: WSContext,
    message: string,
    closeCode: { code: number; reason: string },
  ): void {
    try {
      ws.send(
        JSON.stringify({
          type: "auth.error",
          message,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch {
      // ソケットが既に閉じている場合は無視
    } finally {
      try {
        ws.close(closeCode.code, closeCode.reason);
      } catch {
        // ignore
      }
    }
  }
}
