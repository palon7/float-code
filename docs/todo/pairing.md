# Public Key Authentication & Pairing

## Overview

Replace the current shared-token-only WebSocket authentication with Ed25519 public key authentication and a device pairing system. Combined with optional Tailscale integration, this provides end-to-end encrypted, device-verified connections.

### Goals

- Add device-level identity via Ed25519 public key authentication
- Enable secure remote connections (via Tailscale) with WireGuard encryption
- Provide a human-verifiable pairing flow for new devices

### Non-goals

- TLS termination within the server itself (delegated to Tailscale or reverse proxy)
- Multi-user access control (single-user, multi-device model)

### Security notes

- In `lan` mode, transport is unencrypted (`ws://`). Challenge-response proves the client holds the private key, but session content and `authToken` are visible to network observers. Use `tailscale` mode for untrusted networks
- `authToken` is sent in every WebSocket `auth` message and every REST API request. This is a known trade-off — the public key layer adds device identity, not transport confidentiality

## Key generation

### Client-side (client-g2, client-cli)

- On first launch, generate an Ed25519 keypair if none exists
- Library: `@noble/ed25519` (pure JS, no native dependencies, works in both Node.js and browser)
  - WebCrypto's Ed25519 support is inconsistent across browsers; pure JS ensures Even G2 compatibility
- Storage:
  - client-cli: `~/.config/float-code/client-cli/keypair.json` (XDG-compliant path)
  - client-g2: EvenAppBridge localStorage (packaged app, no third-party code execution)
- Format: hex-encoded 32-byte seed (private) + 32-byte public key
- File permissions: `0600` for keypair file, `0700` for parent directory

## Pairing code

- Derived from the public key: `SHA-256(publicKey)` → Base32 encode → first 12 characters
- Display format: `xxxx-xxxx-xxxx` (3 groups of 4, hyphen-separated)
- 60-bit entropy — sufficient for human-verified pairing (not a security boundary; the public key itself is the identity)
- Collision handling: if a pending code collides with an existing one, reject with an error prompting retry

## Authentication flow (challenge-response)

```text
Client                                          Server
  |                                                |
  |--- WS connect ------------------------------ >|
  |                                                | Start 10s auth timer
  |--- auth { publicKey, authToken } ----------- >|
  |                                                |
  |    [publicKey in approved-keys.json?]           |
  |                                                |
  |  YES:                                          |
  |< -- auth.challenge { challenge } -------------|
  |                                                |
  |--- auth.response { signature } ------------- >|
  |                                                | Verify signature
  |< -- auth.ok { activeSession? } --------------- |
  |                                                |
  |  NO:                                           |
  |< -- auth.error { code: "KEY_NOT_APPROVED" } --|
  |                                                |
  |--- pairing { publicKey, authToken } --------- >|
  |                                                | Verify authToken
  |                                                | Add to pending-pairings.json
  |< -- pairing.pending { code: "xxxx-xxxx-xxxx" }|
  |                                                | Close connection
  |                                                |
  |  [User approves on PC via CLI tool]            |
  |                                                |
  |--- WS connect (retry) ---------------------- >|
  |--- auth { publicKey, authToken } ----------- >|
  |< -- auth.challenge { challenge } -------------|
  |--- auth.response { signature } ------------- >|
  |< -- auth.ok ----------------------------------|
```

### Challenge structure

The challenge is a structured object, not a bare nonce. This provides domain separation and prevents cross-protocol signature reuse.

```typescript
type AuthChallenge = {
  kind: "float-code-auth-v1";
  challengeId: string; // crypto.randomUUID()
  publicKey: string; // Echo back the client's public key
  nonce: string; // crypto.randomBytes(32), hex-encoded
  issuedAt: string; // ISO8601
  expiresAt: string; // ISO8601 (issuedAt + 10s)
};
```

- The entire JSON-serialized challenge is the signing input
- Lifetime is bound to the connection; discarded on disconnect
- `challengeId` enables logging and debugging without exposing the nonce

### Message types

Client -> Server:

- `auth` `{ publicKey: string, authToken: string }` — Initial authentication with public key and shared token
- `auth.response` `{ signature: string }` — Signed challenge response (hex-encoded Ed25519 signature)
- `pairing` `{ publicKey: string, authToken: string }` — Pairing request (sent after `KEY_NOT_APPROVED`)

Server -> Client:

- `auth.challenge` `{ challenge: AuthChallenge }` — Structured challenge object
- `auth.ok` `{ activeSession? }` — Authentication succeeded (unchanged from current)
- `auth.error` `{ code: string, message: string }` — Authentication failed
- `pairing.pending` `{ code: string }` — Pairing request accepted, awaiting approval. Connection will be closed after this message

### Error codes

| Code                     | Description                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `KEY_NOT_APPROVED`       | Public key is not in the approved list                                                 |
| `AUTH_TOKEN_INVALID`     | Shared authToken verification failed                                                   |
| `SIGNATURE_INVALID`      | Challenge-response signature verification failed                                       |
| `PAIRING_CODE_COLLISION` | Generated pairing code collides with existing entry (client should regenerate keypair) |
| `AUTH_TIMEOUT`           | Authentication not completed within 10s (existing, code 4401)                          |

### authToken handling

- `authToken` is sent in the initial `auth` message alongside the public key
- This replaces the current token-only authentication: the token verifies the client knows the server secret, while the public key establishes device identity
- After the initial auth exchange, subsequent messages do not include the token
- REST API (`/api/*`) continues to use Bearer `authToken` for authentication (unchanged)

## Approved keys storage

File: `~/.config/float-code/server/approved-keys.json`

```json
{
  "version": 1,
  "keys": [
    {
      "publicKey": "ab12cd34...",
      "pairingCode": "ABCD-EFGH-IJKL",
      "label": "",
      "approvedAt": "2026-04-04T12:00:00.000Z"
    }
  ]
}
```

- `label`: optional human-readable name (e.g., "G2 glasses", "dev laptop"), set via management CLI
- File permissions: `0600`

## Pending pairings storage

File: `~/.config/float-code/server/pending-pairings.json`

```json
{
  "version": 1,
  "pairings": [
    {
      "publicKey": "ab12cd34...",
      "pairingCode": "ABCD-EFGH-IJKL",
      "createdAt": "2026-04-04T12:00:00.000Z",
      "expiresAt": "2026-04-04T12:10:00.000Z"
    }
  ]
}
```

- TTL: 10 minutes from creation
- Maximum pending entries: 5 (reject with error if exceeded)
- Cleanup: expired entries are removed on read access (lazy) and on server startup
- Not real-time precision — a few minutes of delay in cleanup is acceptable
- File permissions: `0600`

## Management server (localhost)

A separate Hono instance bound to `127.0.0.1` on a different port. This server is shared with the future permission MCP integration (see [permission.md](permission.md)).

### Authentication

- Uses a separate `localAuthToken` (not the same as the WebSocket `authToken`)
- Auto-generated on first startup, stored in `~/.config/float-code/server/config.json`
- Required as `Authorization: Bearer <localAuthToken>` on all endpoints

### Endpoints

- `GET /pairing/pending` → `{ pairings: [{ code, createdAt, expiresAt }] }`
  - Lists pending pairing requests (expired entries filtered out)
- `POST /pairing/approve` `{ code: "ABCD-EFGH-IJKL" }` → `{ approved: { publicKey, pairingCode } }`
  - Moves the matching entry from pending to approved-keys.json
  - Returns 404 if code not found or expired
- `DELETE /pairing/revoke` `{ code: "ABCD-EFGH-IJKL" }` → `{ revoked: true }`
  - Removes a key from approved-keys.json
- `GET /pairing/approved` → `{ keys: [{ pairingCode, label, approvedAt }] }`
  - Lists approved keys (publicKey omitted for brevity)

### CLI subcommands

Implemented as part of the server package, but in a clearly separated module (e.g., `server/src/cli/`). The entry point rejects unrecognized subcommands with an error (never falls through to starting the server).

```
float-server pairing list          # GET /pairing/pending + GET /pairing/approved
float-server pairing approve <code> # POST /pairing/approve
float-server pairing revoke <code>  # DELETE /pairing/revoke
```

- Reads `localAuthToken` from `~/.config/float-code/server/config.json`
- Output format: human-readable table for terminal

## Network modes

The server supports three network modes, configured via `networkMode` in `config.json`.

### `local` mode (default)

- Bind address: `127.0.0.1`
- Access: localhost only
- Use case: development, single-machine use

### `tailscale` mode

- Bind address: `127.0.0.1`
- Access: via `tailscale serve` over the tailnet (WireGuard encryption)
- `tailscale serve` setup is manual for now (user runs `tailscale serve https / http://127.0.0.1:<port>`)
- Future: automate via `tailscale serve` CLI integration
- Pairing is required even over Tailscale

### `lan` mode

- Bind address: `0.0.0.0`
- Access: LAN direct (current behavior)
- **Warning**: on startup, log a prominent warning that transport is unencrypted and authToken/session content are visible to network observers

### Server binding summary

| Mode        | Bind address | Transport security        | Pairing required |
| ----------- | ------------ | ------------------------- | ---------------- |
| `local`     | `127.0.0.1`  | N/A (loopback)            | Yes              |
| `tailscale` | `127.0.0.1`  | WireGuard (via Tailscale) | Yes              |
| `lan`       | `0.0.0.0`    | None (plaintext)          | Yes              |

## File permissions

All files in `~/.config/float-code/server/` containing secrets or keys must be written with restricted permissions:

- Directories: `0700`
- Files: `0600`

This applies to: `config.json`, `approved-keys.json`, `pending-pairings.json`

The atomic write utility should enforce these permissions:

```typescript
export async function writeSecretJsonAtomic(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp.${crypto.randomUUID()}`;
  const fd = await fs.open(tmp, "wx", 0o600);
  try {
    await fd.writeFile(JSON.stringify(data, null, 2), "utf8");
    await fd.sync();
  } finally {
    await fd.close();
  }
  await fs.rename(tmp, filePath);
  await fs.chmod(filePath, 0o600);
}
```

## Impact on existing protocol

### Changed messages

- `auth` message gains `publicKey` field, keeps `token` (renamed internally but wire-compatible as `authToken`)
- New messages: `auth.challenge`, `auth.response`, `pairing`, `pairing.pending`

### New close codes

| Code | Reason             | Description                                             |
| ---- | ------------------ | ------------------------------------------------------- |
| 4409 | `key_not_approved` | Public key not in approved list (triggers pairing flow) |
| 4410 | `pairing_pending`  | Pairing request registered, awaiting approval           |

### Backward compatibility

- Not maintained. This is a breaking protocol change; all clients must be updated simultaneously
- The `auth { token }` message without `publicKey` is rejected

### Data directory migration

All server data files move from `server/data/` (project-local) to `~/.config/float-code/server/` (XDG-compliant). This applies to **all** existing files (`config.json`, `workspaces.json`, etc.), not only the new pairing-related files. No migration of old files is performed — the server generates fresh config on first startup at the new path.

Similarly, client-cli config moves to `~/.config/float-code/client-cli/`.

### Config changes

`~/.config/float-code/server/config.json` additions:

```json
{
  "version": 2,
  "authToken": "...",
  "localAuthToken": "...",
  "localPort": 9090,
  "networkMode": "local"
}
```

- `localAuthToken`: separate token for the localhost management server
- `localPort`: port for the localhost management server (auto-assigned if not set)
- `networkMode`: `"local"` | `"tailscale"` | `"lan"` (default: `"local"`)

## New files

| File                                                | Description                                     |
| --------------------------------------------------- | ----------------------------------------------- |
| `~/.config/float-code/server/approved-keys.json`    | Approved public key registry                    |
| `~/.config/float-code/server/pending-pairings.json` | Pending pairing requests (TTL: 10min)           |
| `server/src/auth/challenge.ts`                      | Challenge generation and signature verification |
| `server/src/auth/pairing.ts`                        | Pairing flow logic, pending storage             |
| `server/src/auth/approved-keys.ts`                  | Approved key store (CRUD)                       |
| `server/src/local-server.ts`                        | Localhost management Hono instance              |
| `server/src/cli/index.ts`                           | CLI subcommand entry point and dispatcher       |
| `server/src/cli/pairing.ts`                         | Pairing subcommand implementation               |
| `shared/src/protocol/types.ts`                      | Updated with new message types                  |
| `client-g2/src/auth/keypair.ts`                     | Keypair generation and storage                  |
| `client-cli/src/auth/keypair.ts`                    | Keypair generation and storage                  |

## Related docs

- [protocol.md](../server/protocol.md): Current WebSocket protocol
- [permission.md](permission.md): Permission MCP (shares localhost management server)
- [roadmap.md](roadmap.md): Phase overview
