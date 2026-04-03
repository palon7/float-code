# Server Overview

## 1. Scope and Decisions

### Confirmed requirements

- The new server is implemented under `server/` and communicates with the G2 frontend via WebSocket
- Uses `@palon7/cc-client` to control Claude CLI
- Server is intended for LAN/remote access
- Authentication uses a "shared token" for now
- Supports multiple simultaneous client connections (CLI + G2, etc.)
- The server manages at most one active session and automatically delivers it to all authenticated clients
- There is no subscription concept. Connecting and authenticating is all that's needed to receive session state
- Entry buffer is sent to new connections (up to 300 entries)
- `Always Allow` rules are persisted independently
- Rule scope is per workspace
- History and resume use Claude Code's built-in session features as-is
- In the future, wss/https + public key authentication will be introduced (design room only for now)
  - OpenClaw will be a useful reference when implementing this: tailscale serve-based remote HTTPS, client-level pairing in public key authentication, etc.
- Workspace listing and browsing is provided via REST API (the server holds no "current Workspace" state)

### Non-goals (for v1)

- Pairing UI
- Public key authentication implementation
- Distinguishing operation permissions between multiple simultaneous clients
- Distributed storage support for rule synchronization
- Allowed directory restriction for filesystem browser (future work)

## 2. Why `server/` as a standalone package

### Decision

- Place an independent `package.json` under `server/`
- Decouple from the root build/check pipeline
- Structure `server/` so it can be reused as a standalone package

### Rationale

- Avoid mixing Node server dependencies into existing G2 frontend dependencies
- CI/execution responsibilities can be separated
- Easy to either split or merge in the future

## 3. Framework choice

### Decision

- v1 adopts `hono + ws`
- For Node.js: use `@hono/node-ws` (v1.3.0+) + `@hono/node-server` + `ws`
- Auth middleware runs before WebSocket upgrade, so token verification can be handled by normal Hono middleware
- Note: Exclude CORS middleware from WebSocket routes (to avoid header conflicts)

## 4. High-level Architecture

```text
[G2 Web App / WebUI]
    |
  WebSocket / REST API (auth token)
    |
[Public Server (0.0.0.0:port)]
    |
    +---- [Ws Gateway]
    |         +---- auth + multi-client broadcast
    |
    +---- [REST API (/api/*)]
    |
    +---- [Workspace Store]
    |         +---- recent workspaces (JSON)
    |         +---- filesystem browse (WebUI only)
    |
    +---- [Session Manager] ---- [cc-client / Claude CLI]
    |              |
    |              +---- active session (max 1) + entry buffer (max 300 / ~1.5MB)
    |              +---- history layer: Claude CLI session logs
    |
    +---- [Permission Engine]              (Planned for Phase 4)
                   |
                   +---- [Workspace-scoped Rule Store (JSON)]

[MCP Server (127.0.0.1:mcpPort)]  <- loopback only, same process  (Planned for Phase 4)
    |
    +---- [Permission MCP Tool (--permission-prompt-tool)]
              +---- shares Permission Engine / WS state in-process
```

## 5. Suggested directory layout

```text
shared/                        # @float-code/shared — shared between packages
  src/
    protocol/
      types.ts                 # All message type definitions
      entry-guard.ts           # Entry validation

server/
  package.json
  tsconfig.json
  src/
    index.ts                   # Entry point (startup / shutdown)
    app.ts                     # Hono app assembly
    config.ts                  # Server configuration loading
    auth/
      shared-token.ts          # Token authentication
    api/
      auth-middleware.ts       # REST API authentication middleware
      error-response.ts        # REST API error response helper
      workspaces.ts            # GET /api/workspaces/recent, browse, detail
      sessions.ts              # GET /api/sessions, GET /api/sessions/:id
    ws/
      gateway.ts               # Auth flow / message routing
      connection-registry.ts   # Multi-client connection management + broadcast
      heartbeat.ts             # Connection liveness monitoring via wss.clients
    workspace/
      workspace-store.ts       # Read/write data/workspaces.json (recent list)
      browse.ts                # Filesystem browsing
      detail.ts                # Workspace detail retrieval
      errors.ts                # Workspace-related error definitions
    session/
      session-manager.ts       # Active session management, entry buffer
      entry-buffer.ts          # Ring buffer implementation
      pid-tracker.ts           # Claude CLI PID tracking / leak prevention
    permission/                # Planned for Phase 4
    utils/
      fs.ts                    # Atomic writes / JSON reading
      logger.ts                # pino-based logger
  data/
    config.json                # Server configuration (auth token, port, etc.)
    claude-pids.json           # Leak prevention: tracks running Claude CLI PIDs
    workspaces.json            # Recently used workspace list
```

## Related docs

- [Protocol](protocol.md) - REST API + WebSocket protocol
- [Session](session.md) - Session management, two-layer resolution, resume
- [Operations](operations.md) - Authentication, persistence, test plan
- [Permission](../todo/permission.md) - Permission model (Phase 4, not yet implemented)
- [Roadmap](../todo/roadmap.md) - Overview of unimplemented phases
