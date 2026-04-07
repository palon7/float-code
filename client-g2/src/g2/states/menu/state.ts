import type { EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type { ServerMessage } from "@float-code/shared/protocol";
import type { G2Context } from "../../runtime/g2-context";
import type { G2State } from "../../runtime/g2-state";
import { isDoubleClickEvent } from "../../runtime/event-utils";
import { buildMenuPage } from "./view";
import { createMainState } from "../main/state";
import { createErrorState } from "../error/state";
import { createWorkspaceSelectState } from "../workspace-select/state";
import {
  isSessionSyncMessage,
  hasActiveSession,
  getActiveSessionId,
} from "../sync-helpers";

export function createMenuState(): G2State {
  let entered = false;
  let transitioning = false;
  let enteredSessionId: string | null = null;

  function handleCc(ctx: G2Context, msg: ServerMessage): void {
    if (!isSessionSyncMessage(msg)) return;

    if (!hasActiveSession()) {
      transitioning = true;
      if (msg.type === "session.error") {
        ctx.transition(
          createErrorState("message" in msg ? msg.message : "Error"),
        );
      } else {
        ctx.transition(createWorkspaceSelectState());
      }
      return;
    }

    // sessionId が変わった（別 session に切り替わった）場合は main に戻す
    if (getActiveSessionId() !== enteredSessionId) {
      transitioning = true;
      ctx.transition(createMainState());
    }
  }

  function handleG2(ctx: G2Context, event: EvenHubEvent): void {
    // ダブルクリック → main に戻る
    if (isDoubleClickEvent(event)) {
      transitioning = true;
      ctx.transition(createMainState());
      return;
    }

    if (!event.listEvent) return;

    const index = event.listEvent.currentSelectItemIndex ?? 0;

    if (index === 0) {
      // Abort
      transitioning = true;
      ctx.wsClient.abort();
      ctx.transition(createMainState());
    } else if (index === 1) {
      // Open...
      transitioning = true;
      ctx.transition(createWorkspaceSelectState());
    } else if (index === 2) {
      // Cancel
      transitioning = true;
      ctx.transition(createMainState());
    }
  }

  return {
    id: "menu",

    async enter(ctx: G2Context) {
      enteredSessionId = getActiveSessionId();
      await ctx.display.setPage(buildMenuPage());
      entered = true;
    },

    handle(ctx, event) {
      if (transitioning) return;
      if (event.kind === "cc") handleCc(ctx, event.message);
      else if (event.kind === "g2" && entered) handleG2(ctx, event.event);
    },
  };
}
