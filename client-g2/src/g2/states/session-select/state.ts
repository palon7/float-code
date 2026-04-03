import type { EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type {
  ServerMessage,
  SessionListItem,
} from "@float-code/shared/protocol";
import type { G2Context } from "../../runtime/g2-context";
import type { G2State } from "../../runtime/g2-state";
import {
  buildSessionSelectPage,
  buildSessionLoadingPage,
  MAX_SESSIONS,
} from "./view";
import { byteLength, truncateToBytesHead } from "../../text-utils";
import { formatRelativeTime } from "../../../client/format-utils";
import { createMainState } from "../main/state";
import { createWorkspaceSelectState } from "../workspace-select/state";
import { createErrorState } from "../error/state";
import { hasActiveSession } from "../sync-helpers";

export function createSessionSelectState(workspacePath: string): G2State {
  let sessions: SessionListItem[] = [];
  let loading = false;
  let transitioning = false;
  let opening = false;
  let loadController: AbortController | null = null;
  let loadVersion = 0;

  async function loadSessions(ctx: G2Context): Promise<void> {
    const controller = new AbortController();
    const currentVersion = ++loadVersion;
    loadController?.abort();
    loadController = controller;
    loading = true;

    try {
      await ctx.display.setPage(buildSessionLoadingPage());
      const nextSessions = await ctx.httpClient.getSessions(
        workspacePath,
        controller.signal,
      );
      if (controller.signal.aborted || currentVersion !== loadVersion) return;

      sessions = nextSessions;
      const names = nextSessions.map((s) => {
        const label = s.lastMessage ?? s.title ?? s.sessionId.slice(0, 12);
        const age = formatRelativeTime(s.lastModified);
        // itemName は 64 バイト上限の可能性があるため、バイト数で制限
        const suffix = ` (${age})`;
        const truncLabel = truncateToBytesHead(label, 50 - byteLength(suffix));
        return `${truncLabel}${suffix}`;
      });
      await ctx.display.setPage(buildSessionSelectPage(names));
    } catch (e) {
      if (controller.signal.aborted || currentVersion !== loadVersion) return;

      const msg = e instanceof Error ? e.message : "Failed to load sessions";
      await ctx.display.setPage(buildSessionSelectPage([], msg));
    } finally {
      if (loadController === controller) {
        loadController = null;
      }
      if (currentVersion === loadVersion) {
        loading = false;
      }
    }
  }

  function handleWs(ctx: G2Context, reason: string): void {
    transitioning = true;
    ctx.transition(createErrorState(reason));
  }

  function handleCc(ctx: G2Context, msg: ServerMessage): void {
    if (msg.type === "session.opened" || msg.type === "session.started") {
      if (hasActiveSession()) {
        transitioning = true;
        ctx.transition(createMainState());
      }
    } else if (msg.type === "session.error" && opening) {
      // error 遷移は自分発の opening 中のみ
      transitioning = true;
      ctx.transition(createErrorState(msg.message));
    }
  }

  function handleG2(ctx: G2Context, event: EvenHubEvent): void {
    if (loading || opening) return;
    if (!event.listEvent) return;

    const index = event.listEvent.currentSelectItemIndex ?? 0;

    if (index === 0) {
      // New session — send open and wait for response
      if (!ctx.wsClient.openSession({ workspacePath })) {
        transitioning = true;
        ctx.transition(createErrorState("Not connected"));
        return;
      }
      opening = true;
    } else if (index <= Math.min(sessions.length, MAX_SESSIONS)) {
      // Existing session — send open and wait for response
      const session = sessions[index - 1];
      if (
        !ctx.wsClient.openSession({
          sessionId: session.sessionId,
          workspacePath,
        })
      ) {
        transitioning = true;
        ctx.transition(createErrorState("Not connected"));
        return;
      }
      opening = true;
    } else {
      // Back
      transitioning = true;
      ctx.transition(createWorkspaceSelectState());
    }
  }

  return {
    id: "session-select",

    async enter(ctx: G2Context) {
      await loadSessions(ctx);
    },

    exit() {
      loadVersion++;
      loading = false;
      loadController?.abort();
      loadController = null;
    },

    handle(ctx, event) {
      if (transitioning) return;
      if (event.kind === "ws" && event.status.state === "error")
        handleWs(ctx, event.status.reason);
      else if (event.kind === "cc") handleCc(ctx, event.message);
      else if (event.kind === "g2") handleG2(ctx, event.event);
    },
  };
}
