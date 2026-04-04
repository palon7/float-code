import type { ServerMessage } from "@float-code/shared/protocol";
import type { ConnectionStatus } from "../../client/ws";
import { useAppStore } from "../../app/app-store";
import { useSessionStore } from "../../client/session-store";
import { deriveUrls } from "../../constants";
import type { G2State, RuntimeEvent } from "./g2-state";
import { createConnectingState } from "../states/connecting/state";
import { createErrorState } from "../states/error/state";
import { createMainState } from "../states/main/state";
import { createWorkspaceSelectState } from "../states/workspace-select/state";

const CONNECT_TIMEOUT_MS = 15_000;

const LIFECYCLE_KEYS = {
  wsError: "ws-error",
  wsPairing: "ws-pairing",
  wsDisconnected: "ws-disconnected",
  authOk: "auth-ok",
  authError: "auth-error",
} as const;

type LifecycleKey = (typeof LIFECYCLE_KEYS)[keyof typeof LIFECYCLE_KEYS];

export interface LifecycleHost {
  transition: (next: G2State) => Promise<void>;
  getCurrentStateId: () => string | undefined;
  wsClient: {
    updateConfig: (wsUrl: string, authToken: string) => void;
    connect: () => void;
    disconnect: () => void;
  };
  httpClient: {
    updateConfig: (httpUrl: string, authToken: string) => void;
  };
}

export class ConnectionLifecycle {
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingLifecycleKey: LifecycleKey | null = null;

  constructor(private host: LifecycleHost) {}

  async requestConnect(): Promise<void> {
    await this.host.transition(createConnectingState());

    const { serverHost, serverToken } = useAppStore.getState();
    if (!serverHost || !serverToken) {
      await this.host.transition(
        createErrorState("Please configure server in app settings"),
      );
      return;
    }

    const urls = deriveUrls(serverHost);
    this.host.wsClient.updateConfig(urls.wsUrl, serverToken);
    this.host.httpClient.updateConfig(urls.httpUrl, serverToken);

    this.clearConnectTimeout();
    this.connectTimeoutTimer = setTimeout(() => {
      this.host.wsClient.disconnect();
      void this.host.transition(createErrorState("Connection timeout"));
    }, CONNECT_TIMEOUT_MS);

    this.host.wsClient.connect();
  }

  intercept(event: RuntimeEvent): boolean {
    if (event.kind === "ws") return this.handleWs(event.status);
    if (event.kind === "cc") return this.handleCc(event.message);
    return false;
  }

  dispose(): void {
    this.clearConnectTimeout();
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
  }

  private handleWs(status: ConnectionStatus): boolean {
    if (status.state === "error") {
      this.clearConnectTimeout();
      this.lifecycleTransition(LIFECYCLE_KEYS.wsError, () =>
        createErrorState(status.reason),
      );
      return true;
    }
    if (status.state === "pairing") {
      this.clearConnectTimeout();
      this.lifecycleTransition(LIFECYCLE_KEYS.wsPairing, () =>
        createErrorState(
          `Pairing: ${status.code}\nApprove on server to connect`,
        ),
      );
      return true;
    }
    if (
      status.state === "disconnected" &&
      this.host.getCurrentStateId() !== "connecting"
    ) {
      this.lifecycleTransition(LIFECYCLE_KEYS.wsDisconnected, () =>
        createErrorState("Disconnected"),
      );
      return true;
    }
    if (status.state === "connected") {
      this.clearConnectTimeout();
    }
    return false;
  }

  private handleCc(message: ServerMessage): boolean {
    if (message.type === "auth.ok") {
      this.lifecycleTransition(LIFECYCLE_KEYS.authOk, () =>
        useSessionStore.getState().hasActive
          ? createMainState()
          : createWorkspaceSelectState(),
      );
      return true;
    }
    if (message.type === "auth.error") {
      this.lifecycleTransition(LIFECYCLE_KEYS.authError, () =>
        createErrorState(message.message),
      );
      return true;
    }
    return false;
  }

  private lifecycleTransition(
    key: LifecycleKey,
    createNext: () => G2State,
  ): void {
    if (this.pendingLifecycleKey === key) return;
    this.pendingLifecycleKey = key;
    void this.host.transition(createNext()).finally(() => {
      if (this.pendingLifecycleKey === key) this.pendingLifecycleKey = null;
    });
  }
}
