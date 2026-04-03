# Float Code

Software for Even G2 (smart glasses). Wraps Claude Code to control and monitor Claude Code from Even G2.

## Features

- Real-time monitoring of Claude Code output
- Prompt input to Claude Code via voice input (using Soniox Speech-to-Text API)
- Status display for ToolUse, Thinking, etc.

### TODO

- Permission allow/deny on G2 using `--permission-prompt-tool`

## Monorepo Structure

Monorepo using pnpm workspaces.

| Package       | Description                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `client-g2/`  | Frontend for Even G2 (React + Vite). Browser-based app + Even G2 control                                              |
| `client-cli/` | CLI tool for communicating with the server. A development test client, with potential to become a TUI-based app later |
| `server/`     | WebSocket server (Hono + @hono/node-ws). Runs Claude Code and waits for client connections                            |
| `shared/`     | Protocol type definitions and validation shared between packages (`@float-code/shared`)                               |

- Common configuration (`.prettierrc`) is placed at the root
- Each package has its own `tsconfig.json`, `eslint.config.js`, and `CLAUDE.md`

## Rules

- Respond in the language matching the user's prompt or configuration settings
- Always consider security and long-term maintainability. Apply fundamental software design principles such as SOLID, DRY, and KISS
- Check existing code before reimplementing similar functionality
- If you find yourself writing the same code repeatedly, consider extracting it into a function or custom hook
- Write _why_ in comments, not _what_. If the code is complex enough to warrant a "what" comment, consider simplifying through refactoring or design improvements
- Keep comments concise and undecorated: `// Comment here`
- Follow existing implementations to maintain consistency
- Always run `pnpm run -r check` after finishing an implementation

## Protocol Flow

```
[G2 / CLI Client]                                [Server]                         [Claude CLI]
        |                                            |                                  |
        |--- WS connect --------------------------->|                                  |
        |--- { type: "auth", token } -------------->|                                  |
        |<-- { type: "auth.ok", activeSession? } ---|                                  |
        |                                            |                                  |
        |--- { type: "session.open",                 |                                  |
        |      workspacePath } -------------------->| Create session (idle)             |
        |<-- { type: "session.opened",               |                                  |
        |      status: "idle", entries: [] } --------|                                  |
        |                                            |                                  |
        |--- { type: "session.send",                 |                                  |
        |      text: "..." } ---------------------->| client.start(text) ------------->|
        |                                            |  status: spawning                |
        |                                            |<-- system entry ------------------|
        |<-- { type: "session.started",              |  status: running                 |
        |      sessionId, status: "running" } -------|                                  |
        |                                            |                                  |
        |<-- { type: "session.entry", entry } -------|<-- entry (streaming) ------------|
        |<-- { type: "session.entry", entry } -------|<-- entry (streaming) ------------|
        |                                            |                                  |
        |                                            |<-- CLI process exit --------------|
        |<-- { type: "session.done",                 |  status: idle                    |
        |      sessionId, exitReason } --------------|                                  |
```

- After authentication, session events are automatically broadcast to all clients
- `session.open` only prepares the context. `session.send` is the trigger for CLI startup
- On reconnect, restore current state via `activeSession` in `auth.ok`
- See [protocol.md](docs/server/protocol.md) for details

## Documentation

- docs/server/ — Server design documents
  - [overview.md](docs/server/overview.md): Scope, architecture, directory layout
  - [operations.md](docs/server/operations.md): Authentication, persistence, test plan
  - [protocol.md](docs/server/protocol.md): REST API, WebSocket protocol, reconnection, Workspace management
  - [session.md](docs/server/session.md): Session management, two-layer resolution, resume
- docs/todo/ — Design documents for unimplemented features
  - [roadmap.md](docs/todo/roadmap.md): Overview of Phase 4/5
  - [permission.md](docs/todo/permission.md): Permission model, MCP integration (Phase 4)
- docs/claude-code-session.md: Documentation for the session data structure saved locally by Claude Code (`~/.claude/projects/`)

## Commands

Run from within each package directory. Package-specific commands are in each directory's CLAUDE.md / AGENTS.md.

- `pnpm run -r check`: Run typecheck + lint + format:check for all packages at once
- `pnpm run check`: Common to each package. Run typecheck + lint + format:check at once
