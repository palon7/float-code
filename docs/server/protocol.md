# Protocol

## REST API (v1)

Request/response operations are provided as a REST API. Implemented as Hono HTTP routes.

### Authentication (per-request Ed25519 signature)

All REST endpoints (under `/api/*`) require a per-request Ed25519 signature. The client signs each request with its device private key, and the server verifies it against the approved public key list (`approved-keys.json`). No bearer credential is transmitted.

#### HTTP headers

```http
X-Public-Key: <hex-encoded 32-byte public key>
X-Timestamp: <unix milliseconds>
X-Nonce: <UUID v4>
X-Signature: <hex-encoded Ed25519 signature>
```

#### Signature payload (canonical string)

```
float-code-rest-v1\n${method}\n${requestTarget}\n${timestamp}\n${nonce}\n${bodyHash}
```

- `float-code-rest-v1`: Signing context. Separated from WebSocket challenge-response (`float-code-auth-v1`) to prevent cross-protocol attacks
- `method`: HTTP method (uppercase). e.g. `GET`
- `requestTarget`: Normalized path + query (`new URL(url, "http://localhost")` → `pathname + search`)
- `timestamp`: Unix milliseconds string. e.g. `1712300000000`
- `nonce`: UUID v4. e.g. `550e8400-e29b-41d4-a716-446655440000`
- `bodyHash`: SHA-256 hex of the request body. For bodyless requests (GET, HEAD, DELETE, OPTIONS), the SHA-256 of empty input (`e3b0c44...`) is used

#### Server verification order

1. Header presence + format validation (publicKey: 64 hex, signature: 128 hex, nonce: UUID v4, timestamp: safe integer)
2. Timestamp range check (±30s from server time)
3. Nonce claim (atomic check + register via `claimNonce()`)
4. Public key approval check (`isApproved()` against `approved-keys.json`)
5. Request target normalization + body hash computation
6. Ed25519 signature verification

Checks are ordered by cost (cheapest first). Nonce is consumed before the public key check, but the timestamp check filters expired requests first, so nonce exhaustion attacks are impractical.

#### Nonce replay prevention

- Client generates a nonce per request using `generateUUID()` (`shared/src/crypto/uuid.ts`, backed by `@noble/hashes/utils.randomBytes`)
- Server retains used nonces in memory for 60s (2× the ±30s timestamp tolerance), then discards them
- `claimNonce()` is synchronous, so check-then-set is atomic under Node.js single-threaded event loop
- On server restart, the nonce store is cleared. Replay of pre-restart requests requires a valid timestamp (±30s), so restarts longer than 30s are naturally protected. For faster restarts, only read-only GET requests are affected

#### CORS

Browser clients (client-g2) trigger preflight requests due to custom headers. The server allows the signature headers:

```ts
cors({
  origin: "*",
  allowHeaders: ["Content-Type", "X-Public-Key", "X-Timestamp", "X-Nonce", "X-Signature"],
})
```

#### Client integration

Both clients use `createSignedFetch()` (`shared/src/crypto/signed-fetch.ts`) which wraps a `fetch` function to automatically attach signature headers. `HttpClient` receives the wrapped fetch via constructor injection and has no knowledge of the signing details.

#### Source files

| File | Description |
| --- | --- |
| `shared/src/crypto/request-sign.ts` | `normalizeRequestTarget`, `hashBody`, `buildSignPayload`, `signRequest`, `verifyRequestSignature` |
| `shared/src/crypto/signed-fetch.ts` | `createSignedFetch` — fetch wrapper that auto-signs requests |
| `shared/src/crypto/uuid.ts` | `generateUUID` — UUID v4 via `@noble/hashes/utils.randomBytes` |
| `server/src/api/auth-middleware.ts` | `signatureAuth` — Hono middleware implementing the verification flow |
| `server/src/auth/nonce-store.ts` | `claimNonce`, `startNonceCleanup` — in-memory nonce replay prevention |

### Workspace

- `GET /api/workspaces/recent` -> `{ workspaces: WorkspaceInfo[] }`
  - Returns recently used workspaces in descending order of last use (up to 20)
  - The recent list is automatically updated on `session.open`
- `GET /api/workspaces/browse?path=<dir>` -> `{ path: string, entries: BrowseEntry[] }`
  - Browse the server's filesystem directory by directory (for WebUI)

### Session

- `GET /api/sessions?workspacePath=<path>` -> `{ sessions: SessionSummary[] }`
  - List of sessions for the specified workspace (workspacePath required, sorted by last modified descending)
  - Data source: JSONL files in `~/.claude/projects/<encoded-path>/`
    - Folder name is the workspacePath with `/` replaced by `-` (Claude CLI convention)
    - Filename is the sessionId; mtime is the last modified time
    - Summary is extracted from the first few lines of metadata (`cwd`, `version`, `timestamp`, etc.)
  - If the live layer has a running/spawning session, its status overrides the returned value
- `GET /api/sessions/:id` -> `{ sessionId, entries[], meta }`
  - History playback data for the specified session

### Health check

- `GET /health` -> `{ status: "ok", uptime: number, activeSessions: number }`
  - No authentication required
  - For monitoring and connectivity verification

### Error response format

All REST endpoints return a consistent error response:

```typescript
type ErrorResponse = {
  error: {
    code: string; // Machine-readable error code (e.g., "WORKSPACE_NOT_FOUND")
    message: string; // Human-readable description
  };
};
```

HTTP status codes and error code mapping:

| Status | Code                        | Description                                           |
| ------ | --------------------------- | ----------------------------------------------------- |
| 400    | `INVALID_REQUEST`           | Invalid request body, missing required parameters     |
| 401    | `SIGNATURE_INVALID`         | Missing, malformed, or invalid request signature      |
| 401    | `KEY_NOT_APPROVED`          | Public key is not in the approved list                |
| 401    | `TIMESTAMP_OUT_OF_RANGE`    | Request timestamp outside ±30s tolerance              |
| 401    | `NONCE_REUSED`              | Request nonce has already been used                   |
| 404    | `WORKSPACE_NOT_FOUND`       | Specified path does not exist                         |
| 404    | `SESSION_NOT_FOUND`         | Specified session ID does not exist                   |
| 409    | `SESSION_ABORT_TIMEOUT`     | Session abort timed out                               |
| 409    | `SESSION_NOT_RUNNING`       | Session is not in running state (e.g., for interrupt) |
| 500    | `SESSION_SPAWN_FAILED`      | Failed to spawn Claude CLI                            |
| 500    | `SESSION_WORKSPACE_UNKNOWN` | Cannot resolve workspacePath from history             |
| 500    | `INTERNAL_ERROR`            | Unexpected server error                               |

## WebSocket Protocol (v1)

Only operations requiring real-time streaming and bidirectional communication are provided via WebSocket.

### Design principle: Server-managed active session

The server manages **at most one active session**. Session events are automatically delivered to all authenticated clients. Clients only need to connect and authenticate to receive session state.

- There is no subscription/unsubscription concept
- Clients do not need to manage sessionId
- Multiple clients (CLI + G2, etc.) can connect simultaneously and view the same session
- On reconnect, the server automatically sends the current state of the active session

### Envelope

All messages share the following fields:

- `type: string`
- `seq?: number` (for Server -> Client events. Unused in v1. Will be introduced when needed for differential retransmission)
- `requestId?: string`
- `sessionId?: string`
- `timestamp: string` (ISO8601)

### Client -> Server

- `auth` `{ publicKey, authToken }` -- See [pairing.md](pairing.md) for full auth flow
- `auth.response` `{ signature }` -- Signed challenge response (hex-encoded Ed25519 signature)
- `session.open` -- Open a session (context setup). Delivers `session.opened` to all clients. Claude CLI is not started
  - New: `{ workspacePath }` -- Create an empty session in `idle` state
  - Resume: `{ sessionId, workspacePath }` -- Load session history from disk, deliver `session.opened` with `entries[]`. Load in `idle` state
  - If active session is running/spawning: abort first → deliver `session.done` → create/load new session
- `session.send` `{ text }` -- Send text to the active session (execution trigger)
  - `idle` (no sessionId): Start new Claude CLI with `client.start(text)`
  - `idle` (with sessionId): Start CLI with `client.resume(sessionId)`, send text via sendQueue
  - `running`: Send to stdin. If stdin is closed (after result reception, before process exit), fall through to auto-resume
  - `spawning`: Queue (flush when `running` state is reached)
  - No active session: `SESSION_NOT_FOUND`
- `session.interrupt` `{}` -- Send SIGINT (running state only)
- `session.abort` `{}` -- Force terminate (valid in running / spawning state)
- `permission.respond` `{ promptId, decision: "allow" | "always_allow" | "deny" }`
- `ping` `{}`

### Server -> Client

- `auth.challenge` `{ challenge: AuthChallenge }` -- Challenge object for Ed25519 signing
- `auth.ok` `{ activeSession? }` -- Authentication succeeded. Includes current state if an active session exists
  - `activeSession`: `{ sessionId?, status, meta?, entries[], pendingPermission? }`
- `auth.error` `{ code: AuthErrorCode, message }` -- Authentication error. `KEY_NOT_APPROVED` also auto-registers a pending pairing
- `session.opened` `{ sessionId?, status, meta?, entries[] }` -- Session open/load completion notification (delivered to all clients). Treated as an authoritative snapshot. `entries=[]` is normal for a new session
- `session.started` `{ sessionId, status: "running", meta? }` -- Lifecycle event when Claude CLI actually enters running state (delivered to all clients). Does not include `entries` as it is not a snapshot. Clients that join mid-session receive a snapshot via `auth.ok.activeSession`
- `session.entry` `{ sessionId, entry }` -- Streaming event (delivered to all clients)
- `session.done` `{ sessionId, exitReason, result? }` -- Session ended (delivered to all clients)
- `session.error` `{ code, message }` -- Error
- `session.permission.request` `{ sessionId, promptId, toolName, input, suggestions? }`
- `session.permission.resolved` `{ sessionId, promptId, decision }`
- `pong`

### Multiple client connections

- Multiple authenticated connections can be maintained simultaneously
- Unauthenticated state does not affect existing connections (DoS prevention)
- Authentication timeout (10s): unauthenticated connections that exceed the timeout are closed with `close(4401, "auth_timeout")`
- New close code: `4409` (key_not_approved — pending pairing auto-registered)
- Session events are broadcast to all authenticated connections
- Any client can send `session.open` / `session.send` / `session.interrupt`, etc. (no operation permission distinction)

### Active session management

- At most **one** active session (running / spawning) across the entire server
- `session.open` can be called at any time. If there is an active session, it is aborted first before switching
  - abort → wait for process exit → deliver `session.done` → start new session → deliver `session.started`
  - A grace period is provided for abort wait (after timeout, SIGKILL forces process termination to prevent leaks)

## WebSocket disconnect / reconnect behavior

### On disconnect

- Claude CLI session **continues running** (not stopped on disconnect)
- SessionManager continues accumulating events in the entry buffer
- If a permission prompt is pending:
  - The server does not set a timeout; it is delegated to the Claude CLI side
- If other clients are connected, delivery to them continues

### On reconnect

- `auth.ok` contains the current state of the active session in `activeSession`:
  - `{ sessionId, status, meta, entries[], pendingPermission? }`
- The client can restore session state without sending additional messages

### Edge cases

- If the Claude CLI session completes while all clients are disconnected:
  - `session.done` is recorded in the buffer. On reconnect, notified in `auth.ok` with `status: "done"` + buffer
- If Claude CLI's timeout denies a permission during disconnection:
  - The deny is recorded in the buffer as `session.permission.resolved`. Available as history on reconnect
- Reconnect after server restart:
  - Claude CLI process has terminated (due to cleanup in [session.md](session.md))
  - `auth.ok` has null `activeSession`
  - Past sessions can be resumed with `session.open { sessionId, workspacePath }` (get session list from REST API and specify sessionId)

## Workspace Management

### Overview

Provides workspace listing and browsing. The server holds no "current Workspace" state. Workspace selection is done via the `workspacePath` parameter of `session.open`, independently per session.

### Workspace selection flow

```text
[WebUI]                                 [G2 Glasses]
  |                                         |
  +-- Browse filesystem with               +-- Get recent list with
  |   GET /api/workspaces/browse            |   GET /api/workspaces/recent
  |                                         |
  +-- Send session.open with               +-- Select from List container
  |   specified workspacePath               |
                                           +-- Send session.open with
                                               specified workspacePath
```

### `GET /api/workspaces/browse`

- Lists directories on the server's filesystem
- `entries[]` in the response contains only directories (files are excluded)
- Hidden directories (starting with `.`), `node_modules`, etc. are excluded
- **Security**: Full access in v1. In the future, `allowedPaths` can be added to `data/config.json` for restriction

```typescript
type BrowseEntry = {
  name: string; // Directory name
  path: string; // Absolute path
};
```

### `GET /api/workspaces/detail`

- Returns detailed information about the workspace at the specified path
- Includes branch name and dirty state if it is a Git repository
- A timeout (5 seconds) is set for Git information retrieval

```typescript
type GitInfo = {
  branch: string; // Current branch name
  dirty: boolean; // Whether there are uncommitted changes
};

type WorkspaceDetailResponse = {
  path: string; // Absolute path
  name: string; // Directory name (for display)
  git?: GitInfo; // Omitted if not a Git repository
};
```

### `GET /api/workspaces/recent`

- Returns recently used workspaces in descending order of last use
- For display in G2 glasses list container
- Maximum 20 entries (v1)
- When `session.open` is called, adds/updates the workspacePath at the top of the recent list

```typescript
type WorkspaceInfo = {
  path: string; // Absolute path
  name: string; // Directory name (for display)
  lastUsedAt: string; // ISO8601
};
```

### Persistence

File: `~/.config/float-code/server/workspaces.json`

```json
{
  "version": 1,
  "recent": [
    {
      "path": "/Users/user/work/project-a",
      "lastUsedAt": "2026-03-29T10:00:00.000Z"
    },
    {
      "path": "/Users/user/work/project-b",
      "lastUsedAt": "2026-03-28T15:00:00.000Z"
    }
  ]
}
```

### Path normalization

- `workspacePath` is normalized with `realpath` as the key (to prevent double management via symbolic links)

### Future extensions

- Add `allowedPaths: string[]` to `data/config.json` to restrict browsable directories
- Per-workspace configuration (default model, environment variables, etc.)
- Workspace bookmarking/pinning
