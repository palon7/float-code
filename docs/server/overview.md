# Server Overview

## 1. Scope and Decisions

### Confirmed requirements

- The new server is implemented under `server/` and communicates with the G2 frontend via WebSocket
- Uses `@palon7/cc-client` to control Claude CLI
- Server is intended for LAN/remote access
- Authentication: WebSocket uses Ed25519 public key challenge-response + shared authToken. REST API uses per-request Ed25519 signature (no bearer credential)
- Device pairing via human-verifiable pairing codes, managed through a localhost management server and CLI
- Supports three network modes: `local` (loopback), `tailscale` (WireGuard), `lan` (plaintext)
- Supports multiple simultaneous client connections (CLI + G2, etc.)
- The server manages at most one active session and automatically delivers it to all authenticated clients
- There is no subscription concept. Connecting and authenticating is all that's needed to receive session state
- Entry buffer is sent to new connections (up to 300 entries)
- `Always Allow` rules are persisted independently
- Rule scope is per workspace
- History and resume use Claude Code's built-in session features as-is
- All data files stored in `~/.config/float-code/server/` (XDG-compliant) with restricted permissions
- Workspace listing and browsing is provided via REST API (the server holds no "current Workspace" state)

### Non-goals (for v1)

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
[G2 Web App / WebUI / CLI Client]
    |
  WebSocket / REST API (authToken + Ed25519 challenge-response)
    |
[Public Server (bind based on networkMode)]
    |
    +---- [Ws Gateway]
    |         +---- challenge-response auth + multi-client broadcast
    |         +---- message-guards (input validation)
    |         +---- ws-authenticator (auth state machine)
    |
    +---- [REST API (/api/*)]
    |
    +---- [Auth]
    |         +---- shared-token (authToken verification)
    |         +---- challenge (Ed25519 challenge/verify)
    |         +---- approved-keys (approved key store)
    |         +---- pairing (pending pairing management)
    |         +---- nonce-store (REST replay prevention)
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

[Localhost Management Server (127.0.0.1:localPort)]
    |
    +---- [Pairing endpoints] (list/approve/revoke)
    +---- [Permission MCP Tool]  (Planned for Phase 4)
```

## 5. Suggested directory layout

```text
shared/                        # @float-code/shared — shared between packages
  src/
    protocol/
      types.ts                 # All message type definitions
      entry-guard.ts           # Entry validation
    crypto/
      ed25519-setup.ts         # @noble/ed25519 sha512 configuration
      sign.ts                  # Ed25519 keypair generation, signing, verification
      pairing-code.ts          # SHA-256 -> Base32 pairing code derivation
      request-sign.ts          # REST request signing and verification
      signed-fetch.ts          # fetch wrapper with auto-signing
      uuid.ts                  # UUID v4 generation via @noble/hashes

server/
  package.json
  tsconfig.json
  src/
    index.ts                   # Entry point (startup / shutdown / CLI dispatch)
    app.ts                     # Hono app assembly (public server)
    config.ts                  # Server configuration loading (v2)
    local-server.ts            # Localhost management server (pairing endpoints)
    auth/
      shared-token.ts          # authToken verification (timing-safe)
      challenge.ts             # Ed25519 challenge generation and signature verification
      approved-keys.ts         # Approved key store (CRUD)
      pairing.ts               # Pairing flow logic, pending storage
      pairing-code.ts          # SHA-256 -> Base32 pairing code derivation
      nonce-store.ts           # REST nonce replay prevention (in-memory, 60s retention)
    cli/
      index.ts                 # CLI subcommand dispatcher
      pairing.ts               # `pairing list/approve/revoke` commands
    api/
      auth-middleware.ts       # REST API authentication middleware
      error-response.ts        # REST API error response helper
      workspaces.ts            # GET /api/workspaces/recent, browse, detail
      sessions.ts              # GET /api/sessions, GET /api/sessions/:id
    ws/
      gateway.ts               # Auth flow / message routing
      ws-authenticator.ts      # Challenge-response authentication state machine
      message-guards.ts        # Runtime type guards for pre-auth messages
      connection-registry.ts   # Multi-client connection management + broadcast
      heartbeat.ts             # Connection liveness monitoring via wss.clients
    workspace/
      workspace-store.ts       # Read/write workspaces.json (recent list)
      browse.ts                # Filesystem browsing
      detail.ts                # Workspace detail retrieval
      errors.ts                # Workspace-related error definitions
    session/
      session-manager.ts       # Active session management, entry buffer
      entry-buffer.ts          # Ring buffer implementation
      pid-tracker.ts           # Claude CLI PID tracking / leak prevention
    permission/                # Planned for Phase 4
    utils/
      fs.ts                    # Atomic writes (writeJsonAtomic, writeSecretJsonAtomic), dataPath
      logger.ts                # pino-based logger

~/.config/float-code/server/     # XDG-compliant data directory
    config.json                  # Server configuration (v2: authToken, localAuthToken, networkMode, etc.)
    approved-keys.json           # Approved public key registry
    pending-pairings.json        # Pending pairing requests
    workspaces.json              # Recently used workspace list
    claude-pids.json             # Leak prevention: tracks running Claude CLI PIDs
```

## Related docs

- [Protocol](protocol.md) - REST API + WebSocket protocol
- [Pairing](pairing.md) - Ed25519 public key authentication, device pairing, management server
- [Session](session.md) - Session management, two-layer resolution, resume
- [Operations](operations.md) - Persistence, test plan
- [Permission](../todo/permission.md) - Permission model (Phase 4, not yet implemented)
- [Roadmap](../todo/roadmap.md) - Overview of unimplemented phases
