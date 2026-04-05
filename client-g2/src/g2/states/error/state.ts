import type { EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type { G2Context } from "../../runtime/g2-context";
import type { G2State } from "../../runtime/g2-state";
import { isTapGestureEvent } from "../../runtime/event-utils";
import { buildErrorPage } from "./view";

export function createErrorState(message: string): G2State {
  let transitioning = false;

  function handleG2(ctx: G2Context, event: EvenHubEvent): void {
    // テキストのみの画面では sysEvent が来ることがあるが、
    // 前後景イベントなどは拾わずタップ系だけを再接続トリガーにする。
    if (isTapGestureEvent(event)) {
      transitioning = true;
      ctx.requestConnect();
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
