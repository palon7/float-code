import type { ServerMessage } from "@float-code/shared/protocol";
import type { G2Context } from "../../runtime/g2-context";
import type { G2State } from "../../runtime/g2-state";
import type { ConnectionStatus } from "../../../client/ws";
import { useAppStore } from "../../../app/app-store";
import { deriveUrls } from "../../../constants";
import { buildConnectingPage } from "./view";
import { createErrorState } from "../error/state";
import { createMainState } from "../main/state";
import { createWorkspaceSelectState } from "../workspace-select/state";
import { loadOrCreateKeypair } from "../../../auth/keypair";

const CONNECT_TIMEOUT_MS = 15_000;

export function createConnectingState(): G2State {
  let transitioning = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  function handleWs(ctx: G2Context, reason: string): void {
    transitioning = true;
    ctx.transition(createErrorState(reason));
  }

  function handleCc(ctx: G2Context, msg: ServerMessage): void {
    if (msg.type === "auth.ok") {
      transitioning = true;
      if (msg.activeSession) {
        ctx.transition(createMainState());
      } else {
        ctx.transition(createWorkspaceSelectState());
      }
    } else if (msg.type === "auth.error") {
      transitioning = true;
      ctx.transition(createErrorState(msg.message));
    } else if (msg.type === "pairing.pending") {
      transitioning = true;
      ctx.transition(
        createErrorState(`Pairing: ${msg.code}\nApprove on server to connect`),
      );
    }
  }

  function handleWsStatus(ctx: G2Context, status: ConnectionStatus): void {
    if (status.state === "error") {
      handleWs(ctx, status.reason);
    } else if (status.state === "pairing") {
      transitioning = true;
      ctx.transition(
        createErrorState(
          `Pairing: ${status.code}\nApprove on server to connect`,
        ),
      );
    }
  }

  return {
    id: "connecting",

    async enter(ctx: G2Context) {
      await ctx.display.setPage(buildConnectingPage());

      const { serverHost, serverToken } = useAppStore.getState();
      if (!serverHost || !serverToken) {
        ctx.transition(
          createErrorState("Please configure server in app settings"),
        );
        return;
      }

      const urls = deriveUrls(serverHost);
      const keypair = await loadOrCreateKeypair();
      ctx.wsClient.updateConfig(urls.wsUrl, serverToken, keypair);
      ctx.httpClient.updateConfig(urls.httpUrl, serverToken);

      timeoutTimer = setTimeout(() => {
        if (transitioning) return;
        transitioning = true;
        ctx.wsClient.disconnect();
        ctx.transition(createErrorState("Connection timeout"));
      }, CONNECT_TIMEOUT_MS);

      ctx.wsClient.connect();
    },

    handle(ctx, event) {
      if (transitioning) return;
      if (event.kind === "ws") handleWsStatus(ctx, event.status);
      else if (event.kind === "cc") handleCc(ctx, event.message);
    },

    exit() {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    },
  };
}
