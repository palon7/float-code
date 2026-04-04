// Server -> Client message payloads

import type { ParsedEntry } from "@palon7/cc-client";

export type SessionSnapshot = {
  sessionId?: string;
  status: SessionStatus;
  meta?: SessionMeta;
  entries: ParsedEntry[];
  pendingPermission?: PendingPermission;
};

export type SessionStartedMeta = Omit<SessionMeta, "sessionId">;

export type SessionStarted = {
  sessionId: string;
  status: "running";
  meta?: SessionStartedMeta;
};

// Challenge-response authentication

export type AuthChallenge = {
  kind: "float-code-auth-v1";
  challengeId: string;
  publicKey: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
};

export type AuthErrorCode =
  | "KEY_NOT_APPROVED"
  | "AUTH_TOKEN_INVALID"
  | "SIGNATURE_INVALID"
  | "PAIRING_CODE_COLLISION"
  | "TOO_MANY_PENDING"
  | "AUTH_TIMEOUT";

export type ServerMessageMap = {
  "auth.challenge": { challenge: AuthChallenge };
  "auth.ok": { activeSession?: SessionSnapshot };
  "auth.error": { code: AuthErrorCode; message: string };
  "pairing.pending": { code: string };
  "session.opened": SessionSnapshot;
  "session.started": SessionStarted;
  "session.entry": { sessionId: string; entry: ParsedEntry };
  "session.done": { sessionId: string; exitReason: string; result?: unknown };
  "session.error": { code: string; message: string };
  "session.permission.request": {
    sessionId: string;
    promptId: string;
    toolName: string;
    input: unknown;
    suggestions?: string[];
  };
  "session.permission.resolved": {
    sessionId: string;
    promptId: string;
    decision: string;
  };
  pong: Record<string, never>;
};

// Client -> Server message payloads

export type ClientMessageMap = {
  auth: { publicKey: string; authToken: string };
  "auth.response": { signature: string };
  pairing: { publicKey: string; authToken: string };
  "session.open":
    | { workspacePath: string; sessionId?: never }
    | { workspacePath: string; sessionId: string };
  "session.send": { text: string };
  "session.interrupt": Record<string, never>;
  "session.abort": Record<string, never>;
  "permission.respond": {
    promptId: string;
    decision: "allow" | "always_allow" | "deny";
  };
  ping: Record<string, never>;
};

// Envelope

type ServerEnvelope = {
  timestamp: string; // ISO8601
  seq?: number;
};

type ClientEnvelope = {
  timestamp: string; // ISO8601
  requestId?: string;
};

// Derived union types

export type ServerMessage = {
  [K in keyof ServerMessageMap]: { type: K } & ServerMessageMap[K] &
    ServerEnvelope;
}[keyof ServerMessageMap];

export type ClientMessage = {
  [K in keyof ClientMessageMap]: { type: K } & ClientMessageMap[K] &
    ClientEnvelope;
}[keyof ClientMessageMap];

// WebSocket close codes

export const WsCloseCode = {
  AUTH_TIMEOUT: { code: 4401, reason: "auth_timeout" },
  AUTH_FAILED: { code: 4403, reason: "auth_failed" },
  KEY_NOT_APPROVED: { code: 4409, reason: "key_not_approved" },
  PAIRING_PENDING: { code: 4410, reason: "pairing_pending" },
} as const;

// Shared types

export type SessionStatus =
  | "idle"
  | "spawning"
  | "running"
  | "waiting_permission";

export type SessionMeta = {
  sessionId?: string;
  workspacePath?: string;
  model?: string;
};

export type PendingPermission = {
  promptId: string;
  toolName: string;
  input: unknown;
};

// REST API types

export type ErrorResponse = {
  error: {
    code: string;
    message: string;
  };
};

export type HealthResponse = {
  status: "ok";
  uptime: number;
  activeSessions: number;
};

// Workspace API types

export type WorkspaceInfo = {
  path: string;
  name: string;
  lastUsedAt: string;
};

export type WorkspacesRecentResponse = {
  workspaces: WorkspaceInfo[];
};

export type BrowseEntry = {
  name: string;
  path: string;
};

export type WorkspacesBrowseResponse = {
  path: string;
  entries: BrowseEntry[];
};

export type GitInfo = {
  branch: string;
  dirty: boolean;
};

export type WorkspaceDetailResponse = {
  path: string;
  name: string;
  git?: GitInfo;
};

// Session API types

export type SessionListItem = {
  sessionId: string;
  status: SessionStatus;
  model?: string;
  title?: string;
  numTurns: number;
  durationMs: number;
  startedAt: string;
  lastModified: string;
  lastMessage?: string;
};

export type SessionsListResponse = {
  sessions: SessionListItem[];
};

export type SessionDetailResponse = {
  sessionId: string;
  model?: string;
  title?: string;
  numTurns: number;
  durationMs: number;
  entryCount: number;
  inputTokens: number;
  outputTokens: number;
  entries: ParsedEntry[];
};
