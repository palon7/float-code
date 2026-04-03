import { create } from "zustand";
import type {
  WorkspaceInfo,
  SessionListItem,
  BrowseEntry,
} from "@float-code/shared/protocol";
import type { HttpClient } from "./http";

interface WorkspaceStoreState {
  workspaces: readonly WorkspaceInfo[];
  workspacesLoading: boolean;
  workspacesError: string | null;

  sessions: readonly SessionListItem[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  sessionsWorkspacePath: string | null;

  browsePath: string | null;
  browseEntries: readonly BrowseEntry[];
  browseLoading: boolean;
  browseError: string | null;

  loadWorkspaces: (httpClient: HttpClient) => void;
  loadSessions: (httpClient: HttpClient, workspacePath: string) => void;
  loadBrowse: (httpClient: HttpClient, path?: string) => void;
}

let workspacesController: AbortController | null = null;
let sessionsController: AbortController | null = null;
let browseController: AbortController | null = null;

const INITIAL_STATE = {
  workspaces: [] as readonly WorkspaceInfo[],
  workspacesLoading: false,
  workspacesError: null,
  sessions: [] as readonly SessionListItem[],
  sessionsLoading: false,
  sessionsError: null,
  sessionsWorkspacePath: null,
  browsePath: null,
  browseEntries: [] as readonly BrowseEntry[],
  browseLoading: false,
  browseError: null,
};

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  ...INITIAL_STATE,

  loadWorkspaces: (httpClient) => {
    workspacesController?.abort();
    const controller = new AbortController();
    workspacesController = controller;
    set({ workspacesLoading: true, workspacesError: null });

    httpClient
      .getRecentWorkspaces(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        set({ workspaces: result, workspacesLoading: false });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        set({
          workspacesError:
            e instanceof Error ? e.message : "Failed to load workspaces",
          workspacesLoading: false,
        });
      });
  },

  loadSessions: (httpClient, workspacePath) => {
    sessionsController?.abort();
    const controller = new AbortController();
    sessionsController = controller;
    set({
      sessionsLoading: true,
      sessionsError: null,
      sessionsWorkspacePath: workspacePath,
    });

    httpClient
      .getSessions(workspacePath, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        set({ sessions: result, sessionsLoading: false });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        set({
          sessionsError:
            e instanceof Error ? e.message : "Failed to load sessions",
          sessionsLoading: false,
        });
      });
  },

  loadBrowse: (httpClient, path) => {
    browseController?.abort();
    const controller = new AbortController();
    browseController = controller;
    set({ browseLoading: true, browseError: null });

    httpClient
      .browse(path, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        set({
          browsePath: result.path,
          browseEntries: result.entries,
          browseLoading: false,
        });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        set({
          browseError: e instanceof Error ? e.message : "Failed to browse",
          browseLoading: false,
        });
      });
  },
}));
