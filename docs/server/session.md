# Session and History Strategy

## Strategy

- Session execution uses `cc-client`
- Conversation continuation uses Claude session ID as-is (`--resume`)
- History listing/playback is based on Claude's saved session logs
- The server manages at most one active session. Automatically delivered to all authenticated clients

## Active Session Model

SessionManager manages sessions in two layers: the active session (at most one) and the history layer:

1. **Active session**: Running Claude CLI process + entry buffer (`null` or one)
2. **History layer**: Claude CLI session history (logs on the filesystem)

Resolution by operation:

| Operation                                   | Active session exists                                         | No active, history exists                                      | Neither             |
| ------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- | ------------------- |
| `session.open { workspacePath }`            | Abort first → deliver done → create new in idle               | Create new in idle                                             | Create new in idle  |
| `session.open { sessionId, workspacePath }` | Abort first → deliver done → load from disk (idle)            | Load from disk, promote to active session (idle)               | `SESSION_NOT_FOUND` |
| `session.send { text }`                     | idle: start/resume CLI, running: send to stdin (auto-resume on failure), spawning: queue | `SESSION_NOT_FOUND` | `SESSION_NOT_FOUND` |
| `session.interrupt`                         | Send SIGINT                                                   | `SESSION_NOT_FOUND`                                            | `SESSION_NOT_FOUND` |
| `session.abort`                             | Send SIGKILL                                                  | `SESSION_NOT_FOUND`                                            | `SESSION_NOT_FOUND` |

## Active Session Management

- At most **one** active session across the entire server
- States are `idle` / `spawning` / `running` / `waiting_permission`. The `done` state is removed; after CLI process exits, returns to `idle`. `waiting_permission` is planned for Phase 4
- `session.open` only sets up context (does not start CLI). `session.send` is the execution trigger
- If the previous session is running/spawning: abort → wait for exit → create new session
- A grace period is provided for abort wait (after timeout, SIGKILL forces process termination to prevent process leaks)
- **Race condition prevention**: Transition state to `spawning` before starting spawn, so subsequent open requests are queued or rejected. Node.js is single-threaded but spawn is async, so transitioning before spawn closes the race window

## Session Lifecycle

### `session.open` — Context setup

#### `session.open { workspacePath }` (new):

1. If active session is running/spawning: abort → wait for exit → deliver `session.done`
2. Create empty active session in `idle` state (Claude CLI is not started)
3. Deliver `session.opened` (entries is empty)

#### `session.open { sessionId, workspacePath }` (resume):

1. If active session is running/spawning: abort → wait for exit → deliver `session.done`
2. Load session history from disk (`loadSession()`). Return `SESSION_NOT_FOUND` if not found
3. Store all loaded entries in the entry buffer
4. Create active session in `idle` state (Claude CLI is not started)
5. Deliver `session.opened`. Includes session history in `entries[]`

### `session.send` — Execution trigger

#### `idle` session (no sessionId = new):

1. Spawn Claude CLI with `client.start(text)`. text becomes the prompt
2. Transition state to `spawning`
3. system entry arrives → transition state to `running`, deliver `session.started`

#### `idle` session (with sessionId = resume):

1. Spawn Claude CLI with `client.resume(sessionId)`
2. Add text to sendQueue
3. system entry arrives → transition state to `running`, flush sendQueue, deliver `session.started`

#### `running` session:

- Send to stdin
- If stdin is closed (cc-client closes stdin on result reception, so between result reception and process exit), fall through to auto-resume (same behavior as idle + sessionId case above)

#### During `spawning`:

- `session.send`: Queue (flush when `running` state is reached)
- `session.abort`: Cancel spawn process (SIGKILL if possible). Return `session.error { code: "SESSION_ABORTED" }` for all queued messages. Discard active session
- **Spawn failure**: Deliver `session.error { code: "SESSION_SPAWN_FAILED" }` and discard active session

### On CLI process exit:

1. Deliver `session.done` to all clients (including exitReason and result)
2. Return state to `idle` (retain session info, clear CLI process reference)
3. Next `session.send` can auto-resume again

workspacePath is resolved from:

- If in live layer: from SessionProcess metadata
- If history layer only: from the `cwd` field in session JSONL (recorded by Claude CLI in every message)
- If neither: return `session.error { code: "SESSION_WORKSPACE_UNKNOWN" }`

## Claude CLI Process Lifecycle Management

- The server manages Claude CLI as a child process
- **Cleanup on server exit**: On receiving `SIGTERM`/`SIGINT`, send `SIGTERM` to all Claude CLI child processes → grace period (5s) → if no response, force stop with `SIGKILL`
- **Leak prevention**:
  - `SessionManager` tracks the PIDs of all running child processes
  - Also stops remaining processes in `process.on('exit')` (safety net)
  - Write PIDs to a PID file (`data/claude-pids.json`) as a safeguard against unexpected crashes, and stop remaining processes on next startup
- **Abnormal process exit**: If Claude CLI crashes, the exit handler transitions session state to `done`. Send `session.done` to all authenticated clients
- **Abnormal exit during spawning**: If the process exits before spawn completes, handle as `SESSION_SPAWN_FAILED`. This handles the case where spawn itself fails, as distinct from the normal abort → done → new session flow

## Entry Buffer

- Ring buffer on active session (max 300 events, byte limit ~1.5MB)
- Send all buffer contents as `entries[]` to new client connections (`auth.ok`)
- Buffer is retained after session completion, provided to reconnecting clients (via `activeSession` in `auth.ok`)
- After server restart, the buffer is lost (Claude CLI process has terminated). History is available via REST API (`GET /api/sessions/:id`)

## Connection Management

- Authenticated clients managed in `Set<WSContext>`
- Broadcast to all authenticated clients when session events occur
- Automatically removed from Set on WS disconnect

## Permission expiration

- When `permission.respond` is received, if the corresponding promptId does not exist in the live layer's pending, it is ignored (e.g., after server restart)
- Log it but do not treat it as an error

## REST API behaviors

- `GET /api/sessions?workspacePath=<path>`: Session list. Retrieved from Claude CLI JSONL files, with live layer status overriding
  - Response `SessionSummary`: `{ sessionId, status, lastModified, model?, lastMessage? }`
  - `status` is `running`/`spawning` if in live layer, otherwise `done`
- `GET /api/sessions/:id`: History playback (entry array and meta)
