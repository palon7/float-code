import { OsEventTypeList } from "@evenrealities/even_hub_sdk";
import type { EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type { ServerMessage } from "@float-code/shared/protocol";
import type { G2Context } from "../../runtime/g2-context";
import type { G2State } from "../../runtime/g2-state";
import { useAppStore } from "../../../app/app-store";
import { useSessionStore } from "../../../client/session-store";
import {
  getSimpleModeLogText,
  type EntryFilter,
} from "../../../client/session-format";
import { getEventType } from "../../runtime/event-utils";
import { MAX_CONTENT_BYTES, MAX_LOG_ROWS } from "../../../constants";
import {
  stripAnsiEscapes,
  truncateForDisplay,
  byteLength,
} from "../../text-utils";
import { buildMainPage } from "./view";
import { formatStatusText } from "./status-icon";
import { createMenuState } from "../menu/state";
import { createWorkspaceSelectState } from "../workspace-select/state";
import { createErrorState } from "../error/state";
import { createVoiceListeningState } from "../voice-listening/state";
import { isSessionSyncMessage, hasActiveSession } from "../sync-helpers";

const BLINK_INTERVAL_MS = 1000;
const MAX_HISTORY_BYTES = 1500;

export function createMainState(): G2State {
  let transitioning = false;
  let historyMode = false;
  let simpleMode = useAppStore.getState().simpleModeEnabled;
  let entryFilter: EntryFilter = {
    showThinking: useAppStore.getState().showThinking,
    showToolUse: useAppStore.getState().showToolUse,
  };
  let unsubSession: (() => void) | null = null;
  let unsubAppStore: (() => void) | null = null;
  let blinkTimer: ReturnType<typeof setInterval> | null = null;
  let blinkPhase = false;
  let lastStatus = "";
  let lastRawLog = "";
  let lastLog = "";

  function updateStatus(ctx: G2Context): void {
    if (historyMode) return;
    const status = formatStatusText(
      useSessionStore.getState().getStatusInfo(entryFilter),
      blinkPhase,
    );
    if (status !== lastStatus) {
      lastStatus = status;
      ctx.display.updateText("status", status);
    }
  }

  function getLogContent(): string {
    const session = useSessionStore.getState();
    if (simpleMode) return getSimpleModeLogText(session.lines);
    return session.getLogText(entryFilter);
  }

  function updateLog(ctx: G2Context): void {
    const rawLog = getLogContent();
    if (rawLog === lastRawLog) return;
    lastRawLog = rawLog;
    const log = truncateForDisplay(
      stripAnsiEscapes(rawLog),
      MAX_CONTENT_BYTES,
      MAX_LOG_ROWS,
    );
    if (log !== lastLog) {
      lastLog = log;
      ctx.display.updateText("log", log);
    }
  }

  function updateDisplay(ctx: G2Context): void {
    updateStatus(ctx);
    if (historyMode) return;
    // シンプルモードは内容が短いので常に最新を反映する。
    // 通常モードは BLE 負荷を抑えるため送信中はスキップし、onDrainIdle で再計算。
    if (!simpleMode && ctx.display.hasPendingUpdate("log")) return;
    updateLog(ctx);
  }

  async function rebuildPage(ctx: G2Context): Promise<void> {
    lastStatus = "";
    lastRawLog = "";
    lastLog = "";
    await ctx.display.setPage(
      buildMainPage(
        formatStatusText(
          useSessionStore.getState().getStatusInfo(entryFilter),
          false,
        ),
        truncateForDisplay(
          stripAnsiEscapes(getLogContent()),
          MAX_CONTENT_BYTES,
          MAX_LOG_ROWS,
        ),
        simpleMode,
      ),
    );
  }

  function enterHistory(ctx: G2Context): void {
    if (historyMode) return;
    historyMode = true;
    const rawLog = stripAnsiEscapes(
      useSessionStore.getState().getLogText(entryFilter),
    );
    const text = truncateForDisplay(rawLog, MAX_HISTORY_BYTES, Infinity);
    ctx.display.onDebugLog?.(
      `enterHistory: ${byteLength(rawLog)}B -> ${byteLength(text)}B (${text.length} chars)`,
    );
    // log を先に送ることで、既存の drain 待ちに割り込んで遅延を抑える
    ctx.display.updateText("log", text);
    ctx.display.updateText("status", " History | Double Tap to Exit");
  }

  function exitHistory(ctx: G2Context): void {
    historyMode = false;
    // lastStatus をリセットして次の updateStatus で確実に送信させる
    lastStatus = "";
    lastRawLog = "";
    lastLog = "";
    updateStatus(ctx);
    updateLog(ctx);
  }

  function handleCc(ctx: G2Context, msg: ServerMessage): void {
    if (!isSessionSyncMessage(msg)) return;
    if (hasActiveSession()) return;

    transitioning = true;
    if (msg.type === "session.error") {
      ctx.transition(
        createErrorState("message" in msg ? msg.message : "Error"),
      );
    } else {
      ctx.transition(createWorkspaceSelectState());
    }
  }

  function handleG2(ctx: G2Context, event: EvenHubEvent): void {
    const eventType = getEventType(event);

    if (eventType === OsEventTypeList.SCROLL_TOP_EVENT) {
      if (!historyMode) enterHistory(ctx);
      return;
    }

    if (eventType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      if (historyMode) exitHistory(ctx);
      return;
    }

    if (eventType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      if (historyMode) {
        exitHistory(ctx);
        return;
      }
      if (!useAppStore.getState().apiKey) return;
      transitioning = true;
      ctx.transition(createVoiceListeningState());
      return;
    }

    if (eventType === OsEventTypeList.CLICK_EVENT) {
      transitioning = true;
      ctx.transition(createMenuState());
      return;
    }

    // テキストのみの画面では sysEvent がタップとして来る
    if (event.sysEvent) {
      transitioning = true;
      ctx.transition(createMenuState());
    }
  }

  return {
    id: "main",

    async enter(ctx: G2Context) {
      const appState = useAppStore.getState();
      simpleMode = appState.simpleModeEnabled;
      entryFilter = {
        showThinking: appState.showThinking,
        showToolUse: appState.showToolUse,
      };
      await rebuildPage(ctx);

      unsubSession = useSessionStore.subscribe(() => updateDisplay(ctx));
      unsubAppStore = useAppStore.subscribe((state, prev) => {
        const modeChanged = state.simpleModeEnabled !== prev.simpleModeEnabled;
        const filterChanged =
          state.showThinking !== prev.showThinking ||
          state.showToolUse !== prev.showToolUse;
        if (!modeChanged && !filterChanged) return;
        simpleMode = state.simpleModeEnabled;
        entryFilter = {
          showThinking: state.showThinking,
          showToolUse: state.showToolUse,
        };
        if (historyMode) {
          // history mode中はページ再構築せずhistory表示を再計算
          const rawLog = stripAnsiEscapes(
            useSessionStore.getState().getLogText(entryFilter),
          );
          const text = truncateForDisplay(rawLog, MAX_HISTORY_BYTES, Infinity);
          ctx.display.updateText("log", text);
        } else {
          rebuildPage(ctx);
        }
      });
      ctx.display.onDrainIdle = () => {
        if (!historyMode) updateLog(ctx);
      };

      blinkPhase = false;
      if (blinkTimer) clearInterval(blinkTimer);
      blinkTimer = setInterval(() => {
        blinkPhase = !blinkPhase;
        updateStatus(ctx);
      }, BLINK_INTERVAL_MS);
    },

    handle(ctx, event) {
      if (transitioning) return;
      if (event.kind === "cc") handleCc(ctx, event.message);
      else if (event.kind === "g2") handleG2(ctx, event.event);
    },

    exit(ctx: G2Context) {
      if (blinkTimer) {
        clearInterval(blinkTimer);
        blinkTimer = null;
      }
      unsubSession?.();
      unsubSession = null;
      unsubAppStore?.();
      unsubAppStore = null;
      ctx.display.onDrainIdle = null;
    },
  };
}
