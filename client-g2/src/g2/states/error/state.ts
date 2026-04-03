import { OsEventTypeList } from "@evenrealities/even_hub_sdk";
import type { EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type { G2Context } from "../../runtime/g2-context";
import type { G2State } from "../../runtime/g2-state";
import { getEventType } from "../../runtime/event-utils";
import { buildErrorPage } from "./view";
import { createConnectingState } from "../connecting/state";

export function createErrorState(message: string): G2State {
  let transitioning = false;

  function handleG2(ctx: G2Context, event: EvenHubEvent): void {
    const eventType = getEventType(event);
    if (
      eventType === OsEventTypeList.CLICK_EVENT ||
      eventType === OsEventTypeList.DOUBLE_CLICK_EVENT
    ) {
      transitioning = true;
      ctx.transition(createConnectingState());
      return;
    }

    // sysEvent もタップとして扱う（テキストのみの画面では sysEvent が来ることがある）
    if (event.sysEvent) {
      transitioning = true;
      ctx.transition(createConnectingState());
    }
  }

  return {
    id: "error",

    async enter(ctx: G2Context) {
      await ctx.display.setPage(buildErrorPage(message));
    },

    handle(ctx, event) {
      if (transitioning) return;
      if (event.kind === "g2") handleG2(ctx, event.event);
    },
  };
}
