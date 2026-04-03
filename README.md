# Float Code

Control and monitor AI coding agent (currently Claude Code) from Even G2.

## Features

- Real-time monitoring of Claude Code output
- Voice-based prompt input (Soniox Speech-to-Text)
- Status display (ToolUse, Thinking, etc.)

## Structure

Monorepo using pnpm workspaces.

| Package       | Description                             |
| ------------- | --------------------------------------- |
| `client-g2/`  | App for Even G2 (React + Vite)          |
| `client-cli/` | TUI-based client                        |
| `server/`     | WebSocket server (Hono + @hono/node-ws) |
| `shared/`     | Shared protocol types and validation    |

## Setup

```bash
pnpm install
pnpm --filter=shared build
```

## Commands

```bash
# start server
cd server
pnpm run dev

# Typecheck + lint + format check (all packages)
pnpm run -r check

```

## License

Private
