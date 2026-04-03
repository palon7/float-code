import type { WSContext } from "hono/ws";
import { ConnectionRegistry } from "./connection-registry.js";
import { WsAuthenticator } from "./ws-authenticator.js";
import type { ClientMessage } from "@float-code/shared/protocol";
import type { SessionManager } from "../session/session-manager.js";
import { logger } from "../utils/logger.js";

const log = logger.child({ name: "gateway" });

type MessageType = ClientMessage["type"];
type MessageHandlers = {
  [K in MessageType]: (
    ws: WSContext,
    data: Extract<ClientMessage, { type: K }>,
    connId?: string,
  ) => void;
};

export class WsGateway {
  private readonly authenticator = new WsAuthenticator();
  // 接続ごとの短い識別子（デバッグトレース用）
  private connIds = new Map<WSContext, string>();
  private readonly handlers: MessageHandlers;

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
    let data: ClientMessage;
    try {
      data = JSON.parse(raw) as ClientMessage;
    } catch {
      log.warn(
        { connId: this.connIds.get(ws), rawPreview: raw.slice(0, 200) },
        "WebSocket message ignored (invalid JSON)",
      );
      return;
    }

    if (this.authenticator.isPending(ws)) {
      if (data.type === "auth") {
        this.handleAuth(ws, data.token);
      } else {
        log.debug(
          { connId: this.connIds.get(ws), type: data.type },
          "WebSocket message ignored (pre-auth)",
        );
        this.registry.sendTo(ws, "auth.error", {
          message: "Authentication required",
        });
      }
      return;
    }

    if (!this.authenticator.isAuthenticated(ws)) {
      log.warn(
        { connId: this.connIds.get(ws) },
        "WebSocket message ignored (not authenticated)",
      );
      return;
    }

    this.handleAuthenticatedMessage(ws, data);
  }

  handleClose(ws: WSContext, code?: number, reason?: string): void {
    const id = this.connIds.get(ws);
    log.info({ connId: id, code, reason }, "WebSocket disconnected");
    this.authenticator.clearAuthTimeout(ws);
    this.authenticator.removeConnection(ws);
    this.connIds.delete(ws);
    this.registry.remove(ws);
  }

  private handleAuth(ws: WSContext, token: string): void {
    const id = this.connIds.get(ws);

    if (!this.authenticator.authenticate(ws, token, id)) {
      return;
    }

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
        log.debug({ connId }, "auth ignored in authenticated phase");
        break;
    }
  }

  /**
   * メッセージタイプ → ハンドラの対応を構築する。
   * 各ハンドラ引数は type に応じて型が絞られる。
   */
  private buildHandlers(): MessageHandlers {
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
      auth: () => {
        // 認証済みフェーズでは handleAuthenticatedMessage から呼ばれない
      },
    };
  }
}
