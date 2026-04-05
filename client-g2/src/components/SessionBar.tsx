import { useCallback, useState } from "react";
import {
  BottomSheet,
  Button,
  Divider,
  ListItem,
  Loading,
} from "even-toolkit/web";
import type {
  WorkspaceInfo,
  SessionListItem,
  BrowseEntry,
} from "@float-code/shared/protocol";
import { useAppStore } from "../app/app-store";
import { useSessionStore } from "../client/session-store";
import { useWorkspaceStore } from "../client/workspace-store";
import { formatRelativeTime } from "../client/format-utils";
type SheetMode = "none" | "workspace" | "session" | "browse";

function CenteredLoading() {
  return (
    <div className="flex justify-center py-8">
      <Loading />
    </div>
  );
}

function WorkspaceList({
  workspaces,
  loading,
  error,
  onSelect,
  onBrowse,
  onRetry,
}: {
  workspaces: readonly WorkspaceInfo[];
  loading: boolean;
  error: string | null;
  onSelect: (workspace: WorkspaceInfo) => void;
  onBrowse: () => void;
  onRetry: () => void;
}) {
  if (loading) return <CenteredLoading />;

  if (error) {
    return (
      <div className="space-y-3 px-4 py-4">
        <p className="text-[13px] text-negative">{error}</p>
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="max-h-[50dvh] overflow-y-auto">
      {workspaces.length > 0 ? (
        workspaces.map((w) => (
          <ListItem
            key={w.path}
            title={w.name || w.path}
            subtitle={w.name ? w.path : undefined}
            onPress={() => onSelect(w)}
          />
        ))
      ) : (
        <p className="px-4 py-4 text-center text-[13px] text-text-dim">
          No recent workspaces
        </p>
      )}
      <Divider />
      <ListItem title="Browse..." onPress={onBrowse} />
    </div>
  );
}

function BrowseList({
  browsePath,
  entries,
  loading,
  error,
  onNavigate,
  onSelect,
  onRetry,
}: {
  browsePath: string | null;
  entries: readonly BrowseEntry[];
  loading: boolean;
  error: string | null;
  onNavigate: (path: string) => void;
  onSelect: (path: string) => void;
  onRetry: () => void;
}) {
  if (loading) return <CenteredLoading />;

  if (error) {
    return (
      <div className="space-y-3 px-4 py-4">
        <p className="text-[13px] text-negative">{error}</p>
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  const parentPath =
    browsePath && browsePath !== "/"
      ? browsePath.split("/").slice(0, -1).join("/") || "/"
      : null;

  return (
    <div className="max-h-[50dvh] overflow-y-auto">
      {parentPath && (
        <ListItem title=".." onPress={() => onNavigate(parentPath)} />
      )}
      {browsePath && (
        <ListItem
          title="Select this directory"
          onPress={() => onSelect(browsePath)}
        />
      )}
      {entries.length > 0 && <Divider />}
      {entries.map((entry) => (
        <ListItem
          key={entry.path}
          title={entry.name}
          onPress={() => onNavigate(entry.path)}
        />
      ))}
      {entries.length === 0 && (
        <p className="px-4 py-4 text-center text-[13px] text-text-dim">
          No subdirectories
        </p>
      )}
    </div>
  );
}

function SessionList({
  sessions,
  loading,
  error,
  onSelectNew,
  onSelectExisting,
  onRetry,
}: {
  sessions: readonly SessionListItem[];
  loading: boolean;
  error: string | null;
  onSelectNew: () => void;
  onSelectExisting: (session: SessionListItem) => void;
  onRetry: () => void;
}) {
  if (loading) return <CenteredLoading />;

  if (error) {
    return (
      <div className="space-y-3 px-4 py-4">
        <p className="text-[13px] text-negative">{error}</p>
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="max-h-[50dvh] overflow-y-auto">
      <ListItem title="New session" onPress={onSelectNew} />
      {sessions.map((s) => (
        <ListItem
          key={s.sessionId}
          title={s.lastMessage ?? s.title ?? s.sessionId.slice(0, 12)}
          subtitle={formatRelativeTime(s.lastModified)}
          onPress={() => onSelectExisting(s)}
        />
      ))}
    </div>
  );
}

export function SessionBar() {
  const wsClient = useAppStore((s) => s.wsClient);
  const httpClient = useAppStore((s) => s.httpClient);
  const wsStatus = useAppStore((s) => s.wsStatus);
  const workspacePath = useSessionStore((s) => s.workspacePath);
  const currentSessionId = useSessionStore((s) => s.sessionId);
  const hasActive = useSessionStore((s) => s.hasActive);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspacesLoading = useWorkspaceStore((s) => s.workspacesLoading);
  const workspacesError = useWorkspaceStore((s) => s.workspacesError);
  const sessions = useWorkspaceStore((s) => s.sessions);
  const sessionsLoading = useWorkspaceStore((s) => s.sessionsLoading);
  const sessionsError = useWorkspaceStore((s) => s.sessionsError);
  const browsePath = useWorkspaceStore((s) => s.browsePath);
  const browseEntries = useWorkspaceStore((s) => s.browseEntries);
  const browseLoading = useWorkspaceStore((s) => s.browseLoading);
  const browseError = useWorkspaceStore((s) => s.browseError);
  const loadWorkspaces = useWorkspaceStore((s) => s.loadWorkspaces);
  const loadSessions = useWorkspaceStore((s) => s.loadSessions);
  const loadBrowse = useWorkspaceStore((s) => s.loadBrowse);

  const [sheet, setSheet] = useState<SheetMode>("none");
  const [pendingWorkspace, setPendingWorkspace] = useState<string | null>(null);

  const isConnected = wsStatus.state === "connected";
  const effectiveWorkspacePath = pendingWorkspace ?? workspacePath ?? null;

  const openWorkspaceSheet = useCallback(() => {
    if (!httpClient) return;
    loadWorkspaces(httpClient);
    setSheet("workspace");
  }, [httpClient, loadWorkspaces]);

  const openSessionSheet = useCallback(
    (forWorkspacePath: string) => {
      if (!httpClient) return;
      loadSessions(httpClient, forWorkspacePath);
      setSheet("session");
    },
    [httpClient, loadSessions],
  );

  const closeSheet = useCallback(() => {
    setPendingWorkspace(null);
    setSheet("none");
  }, []);

  const handleWorkspaceSelect = useCallback(
    (workspace: WorkspaceInfo) => {
      setPendingWorkspace(workspace.path);
      openSessionSheet(workspace.path);
    },
    [openSessionSheet],
  );

  const handleBrowseOpen = useCallback(() => {
    if (!httpClient) return;
    loadBrowse(httpClient);
    setSheet("browse");
  }, [httpClient, loadBrowse]);

  const handleBrowseNavigate = useCallback(
    (path: string) => {
      if (!httpClient) return;
      loadBrowse(httpClient, path);
    },
    [httpClient, loadBrowse],
  );

  const handleBrowseSelect = useCallback(
    (path: string) => {
      setPendingWorkspace(path);
      openSessionSheet(path);
    },
    [openSessionSheet],
  );

  const handleNewSession = useCallback(() => {
    if (!wsClient || !effectiveWorkspacePath) return;
    wsClient.openSession({ workspacePath: effectiveWorkspacePath });
    closeSheet();
  }, [wsClient, effectiveWorkspacePath, closeSheet]);

  const handleExistingSession = useCallback(
    (session: SessionListItem) => {
      if (!wsClient || !effectiveWorkspacePath) return;
      if (session.sessionId === currentSessionId) {
        closeSheet();
        return;
      }
      wsClient.openSession({
        sessionId: session.sessionId,
        workspacePath: effectiveWorkspacePath,
      });
      closeSheet();
    },
    [wsClient, effectiveWorkspacePath, currentSessionId, closeSheet],
  );

  const workspaceName = workspacePath?.split("/").pop() ?? null;

  const retryBrowse = useCallback(
    () => httpClient && loadBrowse(httpClient, browsePath ?? undefined),
    [httpClient, loadBrowse, browsePath],
  );

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-1 pt-2">
        <button
          type="button"
          onClick={openWorkspaceSheet}
          disabled={!isConnected}
          className="flex min-w-0 items-center gap-1 rounded-[6px] bg-surface-light px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-lighter disabled:opacity-50"
        >
          <span className="truncate">{workspaceName ?? "No workspace"}</span>
        </button>

        {hasActive && workspacePath && (
          <button
            type="button"
            onClick={() => openSessionSheet(workspacePath)}
            disabled={!isConnected}
            className="flex min-w-0 items-center gap-1 rounded-[6px] bg-surface-light px-2.5 py-1.5 text-[12px] text-text transition-colors hover:bg-surface-lighter disabled:opacity-50"
          >
            <span className="truncate">Session</span>
          </button>
        )}
      </div>

      <BottomSheet open={sheet === "workspace"} onClose={closeSheet}>
        <div className="px-4 pb-2 text-[15px] tracking-[-0.15px] text-text">
          Select workspace
        </div>
        <WorkspaceList
          workspaces={workspaces}
          loading={workspacesLoading}
          error={workspacesError}
          onSelect={handleWorkspaceSelect}
          onBrowse={handleBrowseOpen}
          onRetry={() => httpClient && loadWorkspaces(httpClient)}
        />
      </BottomSheet>

      <BottomSheet open={sheet === "browse"} onClose={closeSheet}>
        <div className="truncate px-4 pb-2 text-[15px] tracking-[-0.15px] text-text">
          {browsePath ?? "Browse"}
        </div>
        <BrowseList
          browsePath={browsePath}
          entries={browseEntries}
          loading={browseLoading}
          error={browseError}
          onNavigate={handleBrowseNavigate}
          onSelect={handleBrowseSelect}
          onRetry={retryBrowse}
        />
      </BottomSheet>

      <BottomSheet open={sheet === "session"} onClose={closeSheet}>
        <div className="px-4 pb-2 text-[15px] tracking-[-0.15px] text-text">
          Sessions
        </div>
        <SessionList
          sessions={sessions}
          loading={sessionsLoading}
          error={sessionsError}
          onSelectNew={handleNewSession}
          onSelectExisting={handleExistingSession}
          onRetry={() =>
            httpClient &&
            effectiveWorkspacePath &&
            loadSessions(httpClient, effectiveWorkspacePath)
          }
        />
      </BottomSheet>
    </>
  );
}
