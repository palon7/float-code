# server/

## Rules

- Do not implement anything not described in the plans under docs/server/. Always confirm with the user before adding features or fields not in the plan.
- Do not pre-implement features "just in case they might be needed later". Only implement what is required for the current Phase.

## Architecture Overview

### File Structure

```
shared/src/                          # @float-code/shared -- message types are defined here
  protocol/
    types.ts                         # All message type definitions (AuthChallenge, AuthErrorCode, etc.)
    entry-guard.ts                   # Entry validation
  crypto/
    ed25519-setup.ts                 # @noble/ed25519 sha512 configuration
    pairing-code.ts                  # SHA-256 -> Base32 pairing code derivation
    sign.ts                          # Ed25519 keypair generation, signing, verification

server/src/
  index.ts                           # Entry point (startup / shutdown / CLI dispatch)
  app.ts                             # Hono app assembly (public server)
  config.ts                          # Server configuration loading (v2: networkMode, localPort, etc.)
  local-server.ts                    # Localhost management server (pairing endpoints)
  auth/
    shared-token.ts                  # authToken verification (timing-safe)
    challenge.ts                     # Ed25519 challenge generation and signature verification
    approved-keys.ts                 # Approved key store (CRUD, Promise-chain lock)
    pairing.ts                       # Pairing flow logic, pending storage (TTL 10min, max 5)
    pairing-code.ts                  # SHA-256 -> Base32 pairing code derivation
  cli/
    index.ts                         # CLI subcommand dispatcher
    pairing.ts                       # `pairing list/approve/revoke` commands
  api/
    auth-middleware.ts               # REST API authentication middleware
    error-response.ts                # REST API error response helper
    workspaces.ts                    # GET /api/workspaces/recent, browse, detail
    sessions.ts                      # GET /api/sessions, GET /api/sessions/:id
  workspace/
    workspace-store.ts               # Read/write workspaces.json
    browse.ts                        # Filesystem browsing
    detail.ts                        # Workspace detail retrieval
    errors.ts                        # Workspace-related error definitions
  session/
    session-manager.ts               # Active session management
    active-session-state.ts          # Active session state (status, entries, snapshot)
    claude-session-event-handler.ts  # Claude Code session event handling
    entry-buffer.ts                  # Ring buffer implementation
    pid-tracker.ts                   # Claude CLI PID tracking / leak prevention
  permission/                        # Planned for Phase 4
  utils/
    fs.ts                            # Atomic writes (writeJsonAtomic, writeSecretJsonAtomic), dataPath
    lock.ts                          # Promise-chain lock to prevent read-modify-write races
    logger.ts                        # pino-based logger
  ws/
    heartbeat.ts                     # Connection liveness monitoring via wss.clients
    connection-registry.ts           # Multi-client connection management + broadcast
    gateway.ts                       # Auth flow + message routing
    ws-authenticator.ts              # Challenge-response authentication state machine
    message-guards.ts                # Runtime type guards for pre-auth messages
```

### Data Directory

All data files are stored in `~/.config/float-code/server/` (XDG-compliant). See [pairing.md](../docs/server/pairing.md) for details.

### Request Flow

```
Client connects
    |
    v
[Hono: GET /ws] --upgrade--> [WSContext created]
    |
    v
gateway.handleOpen()
    |  Start 10-second auth timer
    v
Client sends auth { publicKey, authToken }
    |
    v
gateway.handleMessage()
    |  Validate via message-guards (format check)
    v
authenticator.handleAuth()
    |-- authToken invalid --> close(4403)
    |-- publicKey not approved
    |                  Auto-register key in pairing/pending store
    |                  --> auth.error(KEY_NOT_APPROVED)
    |                  --> close(4409, "key_not_approved")
    |
    +-- publicKey approved --> auth.challenge { challenge }
                                 |
                    Client sends auth.response { signature }
                                 |
                    authenticator.handleResponse()
                         |-- Invalid --> close(4403)
                         +-- Valid
                              |-- Add to ConnectionRegistry
                              +-- Send auth.ok (including activeSession if present)

Authenticated --> handleAuthenticatedMessage()
    |-- ping --> return pong
    |-- session.open --> SessionManager.openSession()
    |-- session.send --> SessionManager.send()
    |-- session.interrupt --> SessionManager.interrupt()
    +-- session.abort --> SessionManager.abort()
```

### Separation of Concerns

| Module                   | Responsibility                                                                    |
| ------------------------ | --------------------------------------------------------------------------------- |
| `heartbeat.ts`           | Terminate dead connections via WebSocket protocol-level ping/pong                  |
| `connection-registry.ts` | Manages authenticated connections in a `Set`. broadcast/sendTo                    |
| `message-guards.ts`      | Runtime type validation for pre-auth messages (publicKey format, signature format) |
| `ws-authenticator.ts`    | Challenge-response auth state machine (awaiting_auth -> awaiting_response -> authenticated) |
| `gateway.ts`             | Message routing. Delegates auth to authenticator, session ops to SessionManager   |
| `app.ts`                 | Hono route definitions and assembly of each module                                |
| `local-server.ts`        | Localhost-only Hono instance for pairing management endpoints                     |
| `index.ts`               | Server startup, CLI dispatch, heartbeat init, graceful shutdown                   |

### Key Points

- heartbeat and gateway are independent: heartbeat monitors all connections at the `wss` (ws package) level. gateway manages auth state at the Hono `WSContext` level
- Authentication is multi-step: auth message -> challenge -> response -> auth.ok. All pre-auth messages are validated by type guards before processing
- Multiple connections: authenticated clients are managed in a Set. Session events are broadcast to all clients
- Maximum one active session at a time. `session.open` switches sessions (the previous session is aborted)
- Two servers run simultaneously: the public server (configurable bind) and the localhost management server (127.0.0.1 only)
- Concurrency safety: pairing and approved-keys stores use Promise-chain locks to prevent read-modify-write races
