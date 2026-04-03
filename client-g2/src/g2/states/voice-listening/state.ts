import { OsEventTypeList } from "@evenrealities/even_hub_sdk";
import type { EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type { G2Context } from "../../runtime/g2-context";
import type { G2State } from "../../runtime/g2-state";
import type { VoiceInputEvent } from "../../../voice-input/service-types";
import { getEventType } from "../../runtime/event-utils";
import { MAX_CONTENT_BYTES } from "../../../constants";
import { truncateToBytes } from "../../text-utils";
import { createMainState } from "../main/state";
import { createVoiceConfirmState } from "../voice-confirm/state";
import { buildListeningPage } from "./view";

const ERROR_DISPLAY_MS = 3000;
const MAX_SESSION_MS = 60_000;

export function createVoiceListeningState(): G2State {
  let finalText = "";
  let interimText = "";
  let transitioning = false;
  let errorDisplaying = false;
  let errorTimer: ReturnType<typeof setTimeout> | null = null;

  function updateDisplay(ctx: G2Context, text: string): void {
    ctx.display.updateText(
      "voiceText",
      truncateToBytes(text, MAX_CONTENT_BYTES),
    );
  }

  function showError(ctx: G2Context, message: string): void {
    errorDisplaying = true;
    updateDisplay(ctx, `Error: ${message}`);
    errorTimer = setTimeout(() => {
      if (!transitioning) {
        transitioning = true;
        ctx.transition(createMainState());
      }
    }, ERROR_DISPLAY_MS);
  }

  function handleVoice(ctx: G2Context, ve: VoiceInputEvent): void {
    if (ve.type === "transcript") {
      finalText = ve.finalText;
      interimText = ve.interimText;
      const display = finalText + interimText;
      if (display) {
        updateDisplay(ctx, display);
      }
      return;
    }

    if (ve.type === "endpoint") {
      transitioning = true;
      ctx.transition(createVoiceConfirmState(ve.finalText));
      return;
    }

    if (ve.type === "error") {
      showError(ctx, ve.message);
      return;
    }

    if (ve.type === "stopped" && ve.reason === "timeout") {
      transitioning = true;
      if (finalText) {
        ctx.transition(createVoiceConfirmState(finalText));
      } else {
        ctx.transition(createMainState());
      }
    }
  }

  function handleG2(ctx: G2Context, event: EvenHubEvent): void {
    if (getEventType(event) === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      transitioning = true;
      ctx
        .stopVoiceSession("manual_confirm")
        .then(() => {
          if (finalText) {
            ctx.transition(createVoiceConfirmState(finalText));
          } else {
            ctx.transition(createMainState());
          }
        })
        .catch(() => {
          ctx.transition(createMainState());
        });
    }
  }

  return {
    id: "voice-listening",

    async enter(ctx: G2Context) {
      await ctx.display.setPage(buildListeningPage());
      try {
        await ctx.startVoiceSession({ maxSessionMs: MAX_SESSION_MS });
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "音声入力の開始に失敗しました";
        showError(ctx, msg);
      }
    },

    handle(ctx, event) {
      if (transitioning || errorDisplaying) return;
      if (event.kind === "voice") handleVoice(ctx, event.event);
      else if (event.kind === "g2") handleG2(ctx, event.event);
    },

    async exit(ctx: G2Context) {
      if (errorTimer) {
        clearTimeout(errorTimer);
        errorTimer = null;
      }
      await ctx.stopVoiceSession("completed");
    },
  };
}
