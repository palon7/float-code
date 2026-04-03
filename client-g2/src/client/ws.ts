import type { ServerMessage } from "@float-code/shared/protocol";

export type ConnectionStatus =
  | { state: "disconnected" }
  | { state: "connecting" }
  | { state: "authenticating" }
  | { state: "connected" }
  | { state: "error"; reason: string };

type StatusListener = (status: ConnectionStatus) => void;
type MessageListener = (message: ServerMessage) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = { state: "disconnected" };
  private statusListeners = new Set<StatusListener>();
  private messageListeners = new Set<MessageListener>();
  private socketEpoch = 0;
  private intentionalClose = false;

  constructor(
    private wsUrl: string,
    private token: string,
  ) {}

  updateConfig(wsUrl: string, token: string): void {
    this.wsUrl = wsUrl;
    this.token = token;
  }

  connect(): void {
    this.intentionalClose = false;
    this.connectInternal();
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    this.socketEpoch++;
    ws.close();
    this.setStatus({ state: "disconnected" });
  }

  openSession(params: { workspacePath: string }): boolean;
  openSession(params: { sessionId: string; workspacePath: string }): boolean;
  openSession(
    params:
      | { workspacePath: string }
      | { sessionId: string; workspacePath: string },
  ): boolean {
    return this.sendMessage({ type: "session.open", ...params });
  }

  sendText(text: string): boolean {
    return this.sendMessage({ type: "session.send", text });
  }

  abort(): boolean {
    return this.sendMessage({ type: "session.abort" });
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

  private connectInternal(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const epoch = ++this.socketEpoch;
    this.setStatus({ state: "connecting" });

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch {
      this.setStatus({ state: "error", reason: "invalid server URL" });
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (epoch !== this.socketEpoch) return;
      this.setStatus({ state: "authenticating" });
      ws.send(
        JSON.stringify({
          type: "auth",
          token: this.token,
          timestamp: new Date().toISOString(),
        }),
      );
    };

    ws.onmessage = (event) => {
      if (epoch !== this.socketEpoch) return;
      try {
        const msg = JSON.parse(String(event.data)) as ServerMessage;

        if (msg.type === "auth.ok") {
          this.setStatus({ state: "connected" });
        } else if (msg.type === "auth.error") {
          this.setStatus({
            state: "error",
            reason: msg.message ?? "auth failed",
          });
          ws.close();
        }

        for (const listener of this.messageListeners) {
          listener(msg);
        }
      } catch {
        // noop
      }
    };

    ws.onclose = (event) => {
      if (epoch !== this.socketEpoch) return;
      this.ws = null;

      if (this.intentionalClose) return;

      if (this.status.state !== "error") {
        const reason = event.reason || `disconnected (code: ${event.code})`;
        this.setStatus({ state: "error", reason });
      }
    };

    ws.onerror = () => {
      if (epoch !== this.socketEpoch) return;
      if (this.status.state !== "error") {
        this.setStatus({ state: "error", reason: "connection failed" });
      }
    };
  }

  private sendMessage(payload: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(
      JSON.stringify({ ...payload, timestamp: new Date().toISOString() }),
    );
    return true;
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}
