import WebSocket from "ws";
import type { ServerMessage, AuthChallenge } from "@float-code/shared/protocol";
import { WsCloseCode } from "@float-code/shared/protocol";
import { derivePairingCode } from "@float-code/shared/crypto/pairing-code";
import { signChallenge, type Keypair } from "../auth/keypair.js";

export type ConnectionStatus =
  | { state: "disconnected" }
  | { state: "connecting" }
  | { state: "authenticating" }
  | { state: "connected" }
  | { state: "pairing"; code: string }
  | { state: "reconnecting"; attempt: number; nextRetryMs: number }
  | { state: "error"; reason: string };

type StatusListener = (status: ConnectionStatus) => void;
type MessageListener = (message: ServerMessage) => void;

export const MAX_RETRIES = 5;
const NON_RETRYABLE_CODES = new Set<number>([
  WsCloseCode.AUTH_FAILED.code,
  WsCloseCode.AUTH_TIMEOUT.code,
  WsCloseCode.KEY_NOT_APPROVED.code,
]);

function getRetryDelay(attempt: number): number {
  return 1000 * 2 ** (attempt - 1);
}

export class WsClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = { state: "disconnected" };
  private statusListeners = new Set<StatusListener>();
  private messageListeners = new Set<MessageListener>();
  private socketEpoch = 0;
  private retryCount = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(
    private wsUrl: string,
    private authToken: string,
    private keypair: Keypair,
  ) {}

  connect(): void {
    this.intentionalClose = false;
    this.retryCount = 0;
    this.clearReconnectTimer();
    this.connectInternal("connecting");
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    this.socketEpoch++;
    ws.close();
    this.setStatus({ state: "disconnected" });
  }

  openSession(params: { workspacePath: string }): void;
  openSession(params: { sessionId: string; workspacePath: string }): void;
  openSession(
    params:
      | { workspacePath: string }
      | { sessionId: string; workspacePath: string },
  ): void {
    this.sendMessage({ type: "session.open", ...params });
  }

  sendText(text: string): void {
    this.sendMessage({ type: "session.send", text });
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  private connectInternal(initialStatus: "connecting" | "reconnecting"): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const epoch = ++this.socketEpoch;

    if (initialStatus === "connecting") {
      this.setStatus({ state: "connecting" });
    }

    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      if (epoch !== this.socketEpoch) return;
      this.setStatus({ state: "authenticating" });
      ws.send(
        JSON.stringify({
          type: "auth",
          publicKey: this.keypair.publicKey,
          authToken: this.authToken,
          timestamp: new Date().toISOString(),
        }),
      );
    });

    ws.on("message", (data) => {
      if (epoch !== this.socketEpoch) return;
      try {
        const msg = JSON.parse(String(data)) as ServerMessage;

        if (msg.type === "auth.challenge") {
          void this.handleChallenge(ws, epoch, msg.challenge);
          return;
        }

        if (msg.type === "auth.ok") {
          this.retryCount = 0;
          this.setStatus({ state: "connected" });
        } else if (msg.type === "auth.error") {
          if (msg.code === "KEY_NOT_APPROVED") {
            const code = derivePairingCode(this.keypair.publicKey);
            this.setStatus({ state: "pairing", code });
            return;
          }
          this.setStatus({
            state: "error",
            reason: msg.message ?? "auth failed",
          });
          ws.close();
          return;
        }

        for (const listener of this.messageListeners) {
          listener(msg);
        }
      } catch {
        // noop
      }
    });

    ws.on("close", (code) => {
      if (epoch !== this.socketEpoch) return;
      this.ws = null;

      if (this.intentionalClose) return;
      if (this.status.state === "pairing") return;

      // auth.error が届く前に close だけ観測されるケースのフォールバック
      if (code === WsCloseCode.KEY_NOT_APPROVED.code) {
        this.setStatus({
          state: "pairing",
          code: derivePairingCode(this.keypair.publicKey),
        });
        return;
      }

      if (NON_RETRYABLE_CODES.has(code)) {
        if (this.status.state !== "error") {
          this.setStatus({ state: "error", reason: "auth failed" });
        }
        return;
      }

      this.scheduleReconnect();
    });

    ws.on("error", () => {
      if (epoch !== this.socketEpoch) return;
    });
  }

  private async handleChallenge(
    ws: WebSocket,
    epoch: number,
    challenge: AuthChallenge,
  ): Promise<void> {
    try {
      const challengeJson = JSON.stringify(challenge);
      const signature = await signChallenge(
        this.keypair.privateKey,
        challengeJson,
      );
      if (epoch !== this.socketEpoch) return;
      ws.send(
        JSON.stringify({
          type: "auth.response",
          signature,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch {
      this.setStatus({ state: "error", reason: "failed to sign challenge" });
      ws.close();
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;

    this.retryCount++;
    if (this.retryCount > MAX_RETRIES) {
      this.setStatus({
        state: "error",
        reason: "could not connect to server",
      });
      return;
    }

    const delay = getRetryDelay(this.retryCount);
    this.setStatus({
      state: "reconnecting",
      attempt: this.retryCount,
      nextRetryMs: delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.intentionalClose) return;
      this.connectInternal("reconnecting");
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private sendMessage(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({ ...payload, timestamp: new Date().toISOString() }),
      );
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}
