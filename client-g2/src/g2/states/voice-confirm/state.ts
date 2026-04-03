import type { EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type { G2Context } from "../../runtime/g2-context";
import type { G2State } from "../../runtime/g2-state";
import { sendMessage } from "../../../client/send-message";
import { createMainState } from "../main/state";
import { createErrorState } from "../error/state";
import { createVoiceListeningState } from "../voice-listening/state";
import { buildConfirmPage } from "./view";

export function createVoiceConfirmState(transcript: string): G2State {
  let transitioning = false;

  function handleG2(ctx: G2Context, event: EvenHubEvent): void {
    if (!event.listEvent) return;

    // G2 SDK は最初のアイテム選択時に index を undefined にすることがある
    const index = event.listEvent.currentSelectItemIndex ?? 0;

    if (index === 0) {
      // OK — transcript を送信して main へ
      transitioning = true;
      if (!sendMessage(ctx.wsClient, transcript)) {
        ctx.transition(createErrorState("Not connected"));
        return;
      }
      ctx.transition(createMainState());
    } else if (index === 1) {
      // Retry — 再度 listening へ
      transitioning = true;
      ctx.transition(createVoiceListeningState());
    } else if (index === 2) {
      // Cancel — main へ
      transitioning = true;
      ctx.transition(createMainState());
    }
  }

  return {
    id: "voice-confirm",

    async enter(ctx: G2Context) {
      await ctx.display.setPage(buildConfirmPage(transcript));
    },

    handle(ctx, event) {
      if (transitioning) return;
      if (event.kind === "g2") handleG2(ctx, event.event);
    },
  };
}
