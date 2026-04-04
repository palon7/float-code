import type { WSContext } from "hono/ws";
import { ConnectionRegistry } from "./connection-registry.js";
import { WsAuthenticator } from "./ws-authenticator.js";
import {
  isAuthMessage,
  isAuthResponseMessage,
  isPairingMessage,
  getMessageType,
} from "./message-guards.js";
import type { ClientMessage } from "@float-code/shared/protocol";
import type { SessionManager } from "../session/session-manager.js";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "gateway" });

type AuthenticatedMessageType = Exclude<
  ClientMessage["type"],
  "auth" | "auth.response" | "pairing"
>;
type AuthenticatedHandlers = {
  [K in AuthenticatedMessageType]: (
    ws: WSContext,
    data: Extract<ClientMessage, { type: K }>,
    connId?: string,
  ) => void;
};

export class WsGateway {
  private readonly authenticator = new WsAuthenticator();
  private connIds = new Map<WSContext, string>();
  private readonly handlers: AuthenticatedHandlers;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly registry: ConnectionRegistry,
  ) {
    this.handlers = this.buildHandlers();
  }

  stop(): void {
    this.authenticator.stopAll();
  }

  handleOpen(ws: WSContext): void {
    const id = Math.random().toString(36).slice(2, 8);
    this.connIds.set(ws, id);
    log.info({ connId: id }, "WebSocket connected");
    this.authenticator.startTimeout(ws, id);
  }

  handleMessage(ws: WSContext, raw: string): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      log.warn(
        { connId: this.connIds.get(ws), rawPreview: raw.slice(0, 200) },
        "WebSocket message ignored (invalid JSON)",
      );
      return;
    }

    if (this.authenticator.isPending(ws)) {
      const connId = this.connIds.get(ws);

      if (isAuthMessage(data)) {
        void this.handleAuth(ws, data).catch(() => this.safeClose(ws));
        return;
      }

      if (isAuthResponseMessage(data)) {
        void this.handleAuthResponse(ws, data).catch(() => this.safeClose(ws));
        return;
      }

      if (isPairingMessage(data)) {
        void this.authenticator
          .handlePairing(ws, data.publicKey, data.authToken, connId)
          .catch(() => this.safeClose(ws));
        return;
      }

      const type = getMessageType(data);
      log.debug(
        { connId, type },
        "WebSocket message ignored (pre-auth: invalid payload)",
      );
      this.registry.sendTo(ws, "auth.error", {
        code: "AUTH_TOKEN_INVALID",
        message: "Invalid auth payload",
      });
      return;
    }

    if (!this.authenticator.isAuthenticated(ws)) {
      log.warn(
        { connId: this.connIds.get(ws) },
        "WebSocket message ignored (not authenticated)",
      );
      return;
    }

    this.handleAuthenticatedMessage(ws, data as ClientMessage);
  }

  handleClose(ws: WSContext, code?: number, reason?: string): void {
    const id = this.connIds.get(ws);
    log.info({ connId: id, code, reason }, "WebSocket disconnected");
    this.authenticator.removeConnection(ws);
    this.connIds.delete(ws);
    this.registry.remove(ws);
  }

  private async handleAuth(
    ws: WSContext,
    data: Extract<ClientMessage, { type: "auth" }>,
  ): Promise<void> {
    const connId = this.connIds.get(ws);
    await this.authenticator.handleAuth(
      ws,
      data.publicKey,
      data.authToken,
      connId,
    );
  }

  private async handleAuthResponse(
    ws: WSContext,
    data: Extract<ClientMessage, { type: "auth.response" }>,
  ): Promise<void> {
    const connId = this.connIds.get(ws);
    const authenticated = await this.authenticator.handleResponse(
      ws,
      data.signature,
      connId,
    );

    if (!authenticated) return;

    this.registry.add(ws);
    const activeSession = this.sessionManager.getSnapshot();
    this.registry.sendTo(ws, "auth.ok", {
      ...(activeSession && { activeSession }),
    });
  }

  private handleAuthenticatedMessage(ws: WSContext, data: ClientMessage): void {
    const connId = this.connIds.get(ws);
    log.debug({ connId }, `Received message: ${data.type}`);

    switch (data.type) {
      case "session.open":
        this.handlers["session.open"](ws, data, connId);
        break;
      case "session.send":
        this.handlers["session.send"](ws, data, connId);
        break;
      case "session.interrupt":
        this.handlers["session.interrupt"](ws, data, connId);
        break;
      case "session.abort":
        this.handlers["session.abort"](ws, data, connId);
        break;
      case "permission.respond":
        this.handlers["permission.respond"](ws, data, connId);
        break;
      case "ping":
        this.handlers.ping(ws, data, connId);
        break;
      case "auth":
      case "auth.response":
      case "pairing":
        log.debug({ connId }, `${data.type} ignored in authenticated phase`);
        break;
    }
  }

  private safeClose(ws: WSContext): void {
    try {
      ws.close();
    } catch {
      // ignore
    }
  }

  private buildHandlers(): AuthenticatedHandlers {
    return {
      "session.open": (ws, msg, connId) => {
        const hasSessionId = typeof msg.sessionId === "string";

        if (hasSessionId) {
          log.info(
            {
              connId,
              workspacePath: msg.workspacePath,
              sessionId: msg.sessionId,
            },
            "session.open (resume)",
          );
          this.sessionManager
            .loadSession(msg.sessionId, msg.workspacePath)
            .catch(() => {
              this.registry.sendTo(ws, "session.error", {
                code: "INTERNAL_ERROR",
                message: "Failed to load session",
              });
            });
        } else {
          log.info(
            { connId, workspacePath: msg.workspacePath },
            "session.open (new)",
          );
          this.sessionManager.openNewSession(msg.workspacePath).catch(() => {
            this.registry.sendTo(ws, "session.error", {
              code: "INTERNAL_ERROR",
              message: "Failed to open session",
            });
          });
        }
      },
      "session.send": (_ws, msg, connId) => {
        log.info({ connId, textLength: msg.text.length }, "session.send");
        log.debug(
          {
            connId,
            textPreview:
              msg.text.slice(0, 80) + (msg.text.length > 80 ? "…" : ""),
          },
          "session.send preview",
        );
        this.sessionManager.send(msg.text);
      },
      "session.interrupt": (_ws, _msg, connId) => {
        log.info({ connId }, "session.interrupt");
        this.sessionManager.interrupt();
      },
      "session.abort": (_ws, _msg, connId) => {
        log.info({ connId }, "session.abort");
        this.sessionManager.abort();
      },
      ping: (ws, _msg, connId) => {
        log.debug({ connId }, "ping");
        this.registry.sendTo(ws, "pong", {});
      },
      "permission.respond": (ws) => {
        this.registry.sendTo(ws, "session.error", {
          code: "INTERNAL_ERROR",
          message: "Not implemented: permission.respond",
        });
      },
    };
  }
}
