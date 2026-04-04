# Float Code

Control and monitor AI coding agent (currently Claude Code) from Even G2.

## Features

- Real-time monitoring of Claude Code output
- Voice-based prompt input (Soniox Speech-to-Text)
- Status display (ToolUse, Thinking, etc.)
- Ed25519 public key authentication with device pairing

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

## Usage

### 1. Start the server

```bash
cd server
pnpm run dev
```

On first startup, configuration is generated at `~/.config/float-code/server/config.json`. The server listens on two ports:

- **Port 8080** -- WebSocket and REST API for clients
- **Port 9090** (localhost only) -- pairing management

### 2. Connect a client and pair

Each client automatically generates a keypair on first launch. When connecting to the server for the first time, the device needs to be paired.

#### Even G2

1. Open the G2 app, enter the server host and token in Settings
2. A pairing code (e.g. `ABCD-EFGH-IJKL`) is displayed on the glasses
3. On the server machine, approve the code:
   ```bash
   cd server && pnpm run start pairing approve ABCD-EFGH-IJKL
   ```
4. Tap glasses to reconnect

#### CLI client

1. Start the CLI client:
   ```bash
   cd client-cli && pnpm run dev
   ```
   If the server is running on the same machine, the token is read automatically.
2. A pairing code is displayed in the terminal
3. In another terminal, approve the code:
   ```bash
   cd server && pnpm run start pairing approve ABCD-EFGH-IJKL
   ```
4. Restart the CLI client

### 3. Manage paired devices

```bash
cd server

# List pending and approved devices
pnpm run start pairing list

# Revoke a device
pnpm run start pairing revoke ABCD-EFGH-IJKL
```

### 4. Network modes

Configure `networkMode` in `~/.config/float-code/server/config.json`:

| Mode        | Bind address | Use case                            |
| ----------- | ------------ | ----------------------------------- |
| `local`     | `127.0.0.1`  | Development, single-machine         |
| `tailscale` | `127.0.0.1`  | Remote access via `tailscale serve` |
| `lan`       | `0.0.0.0`    | Direct LAN access (**unencrypted**) |

## Commands

```bash
# Start server
cd server
pnpm run dev

# Pairing management
cd server
pnpm run start pairing list
pnpm run start pairing approve <code>
pnpm run start pairing revoke <code>

# Typecheck + lint + format check (all packages)
pnpm run -r check
```

## License

Private
