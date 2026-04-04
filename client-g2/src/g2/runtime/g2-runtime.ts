import { CreateStartUpPageContainer } from "@evenrealities/even_hub_sdk";
import type { EvenAppBridge } from "@evenrealities/even_hub_sdk";
import type { G2DisplayManager, G2PageDef } from "../display-manager";
import type {
  VoiceInputEvent,
  VoiceInputService,
  VoiceInputSession,
} from "../../voice-input/service-types";
import type { WsClient } from "../../client/ws";
import type { HttpClient } from "../../client/http";
import { useAppStore } from "../../app/app-store";
import { useSessionStore } from "../../client/session-store";
import type { LogLine } from "../../client/session-format";
import type { ConnectionStatus } from "../../client/ws";
import type { ServerMessage } from "@float-code/shared/protocol";
import { deriveUrls } from "../../constants";
import type { G2Context } from "./g2-context";
import type { G2State, RuntimeEvent } from "./g2-state";
import { createConnectingState } from "../states/connecting/state";
import { createErrorState } from "../states/error/state";
import { createMainState } from "../states/main/state";
import { createWorkspaceSelectState } from "../states/workspace-select/state";

const LIFECYCLE_KEYS = {
  wsError: "ws-error",
  wsPairing: "ws-pairing",
  wsDisconnected: "ws-disconnected",
  authOk: "auth-ok",
  authError: "auth-error",
} as const;

type LifecycleKey = (typeof LIFECYCLE_KEYS)[keyof typeof LIFECYCLE_KEYS];

function buildSttContext(messages: string[]): string {
  if (messages.length === 0) return "";
  const lines = messages.map((m) => {
    const text = m.replace(/\s+/g, " ").trim();
    return `User: ${text.length > 100 ? text.slice(0, 97) + "..." : text}`;
  });
  return `Users tell the AI agent what to do.\n\nRecent user prompts:\n${lines.join("\n")}`;
}

export interface G2RuntimeOptions {
  bridge: EvenAppBridge;
  displayManager: G2DisplayManager;
  startupPage: G2PageDef;
  voiceInput: VoiceInputService;
  wsClient: WsClient;
  httpClient: HttpClient;
  onDebugLog?: (message: string) => void;
}

export class G2Runtime {
  private bridge: EvenAppBridge;
  private display: G2DisplayManager;
  private currentState: G2State | null = null;
  private startupPage: G2PageDef;
  private voiceInput: VoiceInputService;
  private voiceSession: VoiceInputSession | null = null;
  private ctx: G2Context;
  private transitionChain = Promise.resolve();
  private connectTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingLifecycleKey: LifecycleKey | null = null;
  private unsubscribeEvent: (() => void) | null = null;
  private unsubscribeWs: (() => void) | null = null;
  private unsubscribeWsStatus: (() => void) | null = null;
  private debugLog: (message: string) => void;

  constructor(options: G2RuntimeOptions) {
    this.bridge = options.bridge;
    this.display = options.displayManager;
    this.startupPage = options.startupPage;
    this.voiceInput = options.voiceInput;
    this.debugLog = options.onDebugLog ?? (() => {});

    this.ctx = {
      bridge: this.bridge,
      display: this.display,
      wsClient: options.wsClient,
      httpClient: options.httpClient,
      transition: (next) => this.transition(next),
      startVoiceSession: (opts) => this.startVoiceSession(opts),
      stopVoiceSession: (reason) => this.stopVoiceSession(reason),
      getVoiceSession: () => this.voiceSession,
      requestConnect: () => void this.requestConnect(),
    };
  }

  async start(): Promise<void> {
    this.display.setBridge(this.bridge);
    this.display.onDebugLog = this.debugLog;

    const pageCreated = await this.initStartupPage();
    if (!pageCreated) {
      this.debugLog("startup page failed");
      return;
    }

    this.debugLog("runtime started");

    // G2 イベント購読 → active state に配送
    this.unsubscribeEvent = this.bridge.onEvenHubEvent((event) => {
      if (event.audioEvent) return;
      this.debugLog(JSON.stringify(event));
      this.dispatch({ kind: "g2", event });
    });

    // WsClient メッセージ購読 → session store 更新 + active state に配送
    this.unsubscribeWs = this.ctx.wsClient.onMessage((message) => {
      useSessionStore.getState().handleMessage(message);
      this.dispatch({ kind: "cc", message });
    });

    // WsClient ステータス変化 → active state に配送
    this.unsubscribeWsStatus = this.ctx.wsClient.onStatusChange((status) => {
      this.dispatch({ kind: "ws", status });
    });

    await this.requestConnect();
  }

  private async startVoiceSession(options?: {
    maxSessionMs?: number;
  }): Promise<VoiceInputSession> {
    const apiKey = useAppStore.getState().apiKey;
    const recentUserMessages = (useSessionStore.getState().lines as LogLine[])
      .filter((l: LogLine) => l.entry.kind === "user_message")
      .slice(-5)
      .map((l: LogLine) => ("text" in l.entry ? String(l.entry.text) : ""));
    const context = buildSttContext(recentUserMessages);
    const session = await this.voiceInput.start({
      apiKey,
      maxSessionMs: options?.maxSessionMs,
      context: context,
      onEvent: (event) => this.handleVoiceEvent(event),
    });
    this.voiceSession = session;
    return session;
  }

  private async stopVoiceSession(
    reason?: "manual_confirm" | "completed",
  ): Promise<void> {
    const session = this.voiceSession;
    if (!session) return;
    await session.stop(reason);
  }

  private handleVoiceEvent(event: VoiceInputEvent): void {
    // sessionId が一致しない遅延イベントを無視
    if (!this.voiceSession || event.sessionId !== this.voiceSession.sessionId) {
      return;
    }
    if (event.type === "stopped") {
      this.voiceSession = null;
    }
    this.dispatch({ kind: "voice", event });
  }

  private dispatch(event: RuntimeEvent): void {
    Promise.resolve()
      .then(() => {
        if (this.handleLifecycleEvent(event)) return;
        return this.currentState?.handle?.(this.ctx, event);
      })
      .catch((err) => {
        this.debugLog(
          `dispatch error (${event.kind}): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  private transition(next: G2State): Promise<void> {
    this.transitionChain = this.transitionChain
      .then(() => this.doTransition(next))
      .catch((e) => {
        console.error(`transition to ${next.id} failed:`, e);
      });
    return this.transitionChain;
  }

  private async enterState(state: G2State): Promise<void> {
    try {
      await state.enter(this.ctx);
    } catch (e) {
      this.debugLog(
        `enter ${state.id} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  private async exitState(state: G2State): Promise<void> {
    try {
      await state.exit?.(this.ctx);
    } catch (e) {
      this.debugLog(
        `exit ${state.id} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async doTransition(next: G2State): Promise<void> {
    const prev = this.currentState;
    this.debugLog(`transition: ${prev?.id ?? "none"} → ${next.id}`);
    if (prev) {
      await prev.exit?.(this.ctx);
    }
    this.currentState = next;
    try {
      await this.enterState(next);
    } catch {
      await this.exitState(next);
      if (next.id !== "error") {
        const errorState = createErrorState("Display error");
        this.currentState = errorState;
        await this.enterState(errorState).catch(() => {});
      }
    }
    this.debugLog(`entered: ${this.currentState.id}`);
  }

  private static readonly STARTUP_KEY = "g2_startup_created";

  /**
   * startup page を初期化する。
   * createStartUpPageContainer はネイティブ側で1回だけ有効。
   * リロード時は既に作成済みなので rebuildPageContainer を使う。
   */
  private async initStartupPage(): Promise<boolean> {
    const alreadyCreated = sessionStorage.getItem(G2Runtime.STARTUP_KEY);

    if (alreadyCreated) {
      // リロード: rebuildPageContainer で画面を再設定
      this.debugLog("startup: rebuild (reload)");
      await this.display.setPage(this.startupPage);
      return true;
    }

    // 初回: createStartUpPageContainer
    this.debugLog("startup: createStartUpPageContainer");
    const textObject = (this.startupPage.textContainers ?? []).map((c, i) => {
      c.containerID = i + 1;
      c.isEventCapture = 0;
      return c;
    });
    const total = textObject.length;
    if (total > 0) {
      textObject[total - 1].isEventCapture = 1;
    }

    const result = await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: total,
        textObject: textObject.length > 0 ? textObject : undefined,
      }),
    );

    this.debugLog(`createStartUp result: ${result}`);
    if (result !== 0) return false;

    sessionStorage.setItem(G2Runtime.STARTUP_KEY, "1");
    return true;
  }

  dispose(): void {
    this.clearConnectTimeout();
    this.unsubscribeEvent?.();
    this.unsubscribeEvent = null;
    this.unsubscribeWs?.();
    this.unsubscribeWs = null;
    this.unsubscribeWsStatus?.();
    this.unsubscribeWsStatus = null;
    this.ctx.wsClient.disconnect();
  }

  // --- Lifecycle management ---

  private static readonly CONNECT_TIMEOUT_MS = 15_000;

  private async requestConnect(): Promise<void> {
    await this.transition(createConnectingState());

    const { serverHost, serverToken } = useAppStore.getState();
    if (!serverHost || !serverToken) {
      await this.transition(
        createErrorState("Please configure server in app settings"),
      );
      return;
    }

    const urls = deriveUrls(serverHost);
    this.ctx.wsClient.updateConfig(urls.wsUrl, serverToken);
    this.ctx.httpClient.updateConfig(urls.httpUrl, serverToken);

    this.clearConnectTimeout();
    this.connectTimeoutTimer = setTimeout(() => {
      this.ctx.wsClient.disconnect();
      void this.transition(createErrorState("Connection timeout"));
    }, G2Runtime.CONNECT_TIMEOUT_MS);

    this.ctx.wsClient.connect();
  }

  private clearConnectTimeout(): void {
    if (this.connectTimeoutTimer) {
      clearTimeout(this.connectTimeoutTimer);
      this.connectTimeoutTimer = null;
    }
  }

  private handleLifecycleEvent(event: RuntimeEvent): boolean {
    if (event.kind === "ws") return this.handleLifecycleWs(event.status);
    if (event.kind === "cc") return this.handleLifecycleCc(event.message);
    return false;
  }

  private handleLifecycleWs(status: ConnectionStatus): boolean {
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
      this.currentState?.id !== "connecting"
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

  private handleLifecycleCc(message: ServerMessage): boolean {
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
    void this.transition(createNext()).finally(() => {
      if (this.pendingLifecycleKey === key) this.pendingLifecycleKey = null;
    });
  }
}
