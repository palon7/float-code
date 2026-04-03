import type { EvenHubEvent } from "@evenrealities/even_hub_sdk";
import type { ServerMessage } from "@float-code/shared/protocol";
import type { WorkspaceInfo } from "@float-code/shared/protocol";
import type { G2Context } from "../../runtime/g2-context";
import type { G2State } from "../../runtime/g2-state";
import {
  buildWorkspaceSelectPage,
  buildWorkspaceLoadingPage,
  MAX_WORKSPACES,
} from "./view";
import { createSessionSelectState } from "../session-select/state";
import { createMainState } from "../main/state";
import { createErrorState } from "../error/state";
import { isSessionSyncMessage, hasActiveSession } from "../sync-helpers";

export function createWorkspaceSelectState(): G2State {
  let workspaces: WorkspaceInfo[] = [];
  let loading = false;
  let transitioning = false;
  let loadController: AbortController | null = null;
  let loadVersion = 0;

  async function loadWorkspaces(ctx: G2Context): Promise<void> {
    const controller = new AbortController();
    const currentVersion = ++loadVersion;
    loadController?.abort();
    loadController = controller;
    loading = true;

    try {
      await ctx.display.setPage(buildWorkspaceLoadingPage());
      const nextWorkspaces = await ctx.httpClient.getRecentWorkspaces(
        controller.signal,
      );
      if (controller.signal.aborted || currentVersion !== loadVersion) return;

      workspaces = nextWorkspaces;
      const names = nextWorkspaces.map((w) => w.name || w.path);
      await ctx.display.setPage(buildWorkspaceSelectPage(names));
    } catch (e) {
      if (controller.signal.aborted || currentVersion !== loadVersion) return;

      const msg = e instanceof Error ? e.message : "Failed to load";
      await ctx.display.setPage(buildWorkspaceSelectPage([], msg));
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
    if (isSessionSyncMessage(msg) && hasActiveSession()) {
      transitioning = true;
      ctx.transition(createMainState());
    }
  }

  async function handleG2(ctx: G2Context, event: EvenHubEvent): Promise<void> {
    if (loading) return;
    if (!event.listEvent) return;

    const index = event.listEvent.currentSelectItemIndex ?? 0;

    if (index < Math.min(workspaces.length, MAX_WORKSPACES)) {
      transitioning = true;
      ctx.transition(createSessionSelectState(workspaces[index].path));
    } else {
      await loadWorkspaces(ctx);
    }
  }

  return {
    id: "workspace-select",

    async enter(ctx: G2Context) {
      await loadWorkspaces(ctx);
    },

    exit() {
      loadVersion++;
      loading = false;
      loadController?.abort();
      loadController = null;
    },

    async handle(ctx, event) {
      if (transitioning) return;
      if (event.kind === "ws" && event.status.state === "error")
        handleWs(ctx, event.status.reason);
      else if (event.kind === "cc") handleCc(ctx, event.message);
      else if (event.kind === "g2") await handleG2(ctx, event.event);
    },
  };
}
