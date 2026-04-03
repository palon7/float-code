# server/

## Rules

- Do not implement anything not described in the plans under docs/server/. Always confirm with the user before adding features or fields not in the plan.
- Do not pre-implement features "just in case they might be needed later". Only implement what is required for the current Phase.

## Architecture Overview

### File Structure

```
shared/src/                          # @float-code/shared — message types are defined here
├── protocol/
│   ├── types.ts                     # All message type definitions
│   └── entry-guard.ts               # Entry validation

server/src/
├── index.ts                         # Entry point (startup / shutdown)
├── app.ts                           # Hono app assembly
├── config.ts                        # Server configuration loading
├── auth/
│   └── shared-token.ts              # Token authentication
├── api/
│   ├── auth-middleware.ts           # REST API authentication middleware
│   ├── error-response.ts            # REST API error response helper
│   ├── workspaces.ts                # GET /api/workspaces/recent, browse, detail
│   └── sessions.ts                  # GET /api/sessions, GET /api/sessions/:id
├── workspace/
│   ├── workspace-store.ts           # Read/write data/workspaces.json
│   ├── browse.ts                    # Filesystem browsing
│   ├── detail.ts                    # Workspace detail retrieval
│   └── errors.ts                    # Workspace-related error definitions
├── session/
│   ├── session-manager.ts           # Active session management
│   ├── entry-buffer.ts              # Ring buffer implementation
│   └── pid-tracker.ts               # Claude CLI PID tracking / leak prevention
├── permission/                      # Planned for Phase 4
├── utils/
│   ├── fs.ts                        # Atomic writes / JSON reading
│   └── logger.ts                    # pino-based logger
└── ws/
    ├── heartbeat.ts                 # Connection liveness monitoring via wss.clients
    ├── connection-registry.ts       # Multi-client connection management + broadcast
    └── gateway.ts                   # Auth flow + message routing
```

### Request Flow

```
Client connects
    │
    ▼
[Hono: GET /ws] ──upgrade──> [WSContext created]
    │
    ▼
gateway.handleOpen()
    │  Start 10-second auth timer
    ▼
Client sends {"type":"auth","token":"..."}
    │
    ▼
gateway.handleMessage()
    ├─ Unauthenticated → handleAuth()
    │    ├─ Invalid token → close(4403)
    │    └─ Valid token
    │         ├─ Add to ConnectionRegistry (multiple connections allowed)
    │         └─ Send auth.ok (including activeSession if present)
    │
    └─ Authenticated → handleAuthenticatedMessage()
         ├─ ping → return pong
         ├─ session.open → SessionManager.openSession()
         ├─ session.send → SessionManager.send()
         ├─ session.interrupt → SessionManager.interrupt()
         └─ session.abort → SessionManager.abort()
```

### Separation of Concerns

| Module                   | Responsibility                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `heartbeat.ts`           | Terminate dead connections via WebSocket protocol-level ping/pong. Uses `wss.clients` and is unaware of Gateway                      |
| `connection-registry.ts` | Manages authenticated connections in a `Set`. broadcast/sendTo                                                                       |
| `gateway.ts`             | Auth flow (including timeout) and message routing. Receives ConnectionRegistry from outside                                           |
| `app.ts`                 | Hono route definitions and assembly of each module                                                                                   |
| `index.ts`               | Server startup, heartbeat initialization, graceful shutdown                                                                           |

### Key Points

- heartbeat and gateway are independent: heartbeat monitors all connections at the `wss` (ws package) level. gateway manages auth state at the Hono `WSContext` level. They operate at different layers
- Nothing is possible before authentication: while in the `pendingAuth` Map, all messages other than `auth` are rejected
- Multiple connections: authenticated clients are managed in a Set. Session events are broadcast to all clients
- Maximum one active session at a time. `session.open` switches sessions (the previous session is aborted)

