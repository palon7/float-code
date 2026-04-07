# Public Key Authentication & Pairing

## Overview

Ed25519 public key authentication with a device pairing system. Combined with optional Tailscale integration, this provides device-verified connections.

### Goals

- Device-level identity via Ed25519 public key authentication
- Secure remote connections (via Tailscale) with WireGuard encryption
- Human-verifiable pairing flow for new devices

### Non-goals

- TLS termination within the server itself (delegated to Tailscale or reverse proxy)
- Multi-user access control (single-user, multi-device model)

### Security notes

- In `lan` mode, transport is unencrypted (`ws://`). Challenge-response proves the client holds the private key, but session content and `authToken` are visible to network observers. Use `tailscale` mode for untrusted networks
- `authToken` is sent in WebSocket `auth` messages. REST API uses per-request Ed25519 signatures (no bearer credential transmitted). The public key layer adds device identity, not transport confidentiality

## Key generation

### Client-side

- On first launch, generate an Ed25519 keypair if none exists
- Library: `@noble/ed25519` v3 (pure JS, no native dependencies)
  - Requires manual `hashes.sha512` setup for sync/async operations
- Storage:
  - client-cli: `~/.config/float-code/client-cli/keypair.json`
  - client-g2: localStorage (`float-code-keypair` key)
- Format: hex-encoded 32-byte seed (private) + 32-byte public key
- File permissions (client-cli): `0600` for keypair file, `0700` for parent directory

## Pairing code

- Derived from the public key: `SHA-256(publicKey)` -> Base32 encode -> first 12 characters
- Display format: `XXXX-XXXX-XXXX` (3 groups of 4, hyphen-separated)
- 60-bit entropy -- sufficient for human-verified pairing (not a security boundary)
- Collision handling: checked within pending pairings only. Approval is granted to the public key, not the pairing code, so approved keys are not checked

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
  |                                                | Auto-register pending pairing
  |< -- auth.error { KEY_NOT_APPROVED } ----------|
  |                                                | Close connection (4409)
  |  Client derives pairing code locally           |
  |  (SHA-256(publicKey) → Base32 → XXXX-XXXX-XXXX)|
  |                                                |
  |  [User approves on server via CLI]             |
  |                                                |
  |--- WS connect (retry) ---------------------- >|
  |--- auth { publicKey, authToken } ----------- >|
  |< -- auth.challenge { challenge } -------------|
  |--- auth.response { signature } ------------- >|
  |< -- auth.ok ----------------------------------|
```

### Challenge structure

```typescript
type AuthChallenge = {
  kind: "float-code-auth-v1";
  challengeId: string;  // crypto.randomUUID()
  publicKey: string;    // Echo back the client's public key
  nonce: string;        // crypto.randomBytes(32), hex-encoded
  issuedAt: string;     // ISO8601
  expiresAt: string;    // ISO8601 (issuedAt + 10s)
};
```

- The entire JSON-serialized challenge is the signing input
- Lifetime is bound to the connection; discarded on disconnect

### Message types

Client -> Server:

- `auth` `{ publicKey: string, authToken: string }` -- Initial authentication
- `auth.response` `{ signature: string }` -- Signed challenge response (hex-encoded)

Server -> Client:

- `auth.challenge` `{ challenge: AuthChallenge }` -- Challenge object
- `auth.ok` `{ activeSession? }` -- Authentication succeeded
- `auth.error` `{ code: AuthErrorCode, message: string }` -- Authentication failed. For `KEY_NOT_APPROVED`, the server auto-registers a pending pairing and closes with 4409. The client derives the pairing code locally from its own public key.

### Input validation

All pre-auth messages are validated by type guards (`message-guards.ts`) before processing:

- `publicKey`: must be exactly 64 hex characters (32 bytes)
- `signature`: must be exactly 128 hex characters (64 bytes)
- `authToken`: must be a non-empty string

Invalid payloads are rejected with `auth.error` without reaching the authenticator.

### Error codes

| Code                     | Description                                                |
| ------------------------ | ---------------------------------------------------------- |
| `KEY_NOT_APPROVED`       | Public key is not in the approved list                     |
| `AUTH_TOKEN_INVALID`     | Shared authToken verification failed                       |
| `SIGNATURE_INVALID`      | Challenge-response signature verification failed           |
| `PAIRING_CODE_COLLISION` | Pairing code collides with existing entry                  |
| `TOO_MANY_PENDING`       | Maximum pending pairing requests (5) exceeded              |
| `AUTH_TIMEOUT`           | Authentication not completed within 10s                    |

### WebSocket close codes

| Code | Reason             | Description                                             |
| ---- | ------------------ | ------------------------------------------------------- |
| 4401 | `auth_timeout`     | Authentication timeout                                  |
| 4403 | `auth_failed`      | Authentication failed                                   |
| 4409 | `key_not_approved` | Public key not approved, pending pairing registered      |

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

- File permissions: `0600`
- Read-modify-write operations are serialized via a Promise-chain lock to prevent concurrent update loss

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
- Maximum pending entries: 5
- Cleanup: expired entries are removed on read access (lazy) and on server startup
- File permissions: `0600`

## Management server (localhost)

A separate Hono instance bound to `127.0.0.1` on a dedicated port (`localPort`, default 9090).

### Authentication

- Uses a separate `localAuthToken` (not the same as the WebSocket `authToken`)
- Auto-generated on first startup, stored in `~/.config/float-code/server/config.json`
- Required as `Authorization: Bearer <localAuthToken>` on all endpoints

### Endpoints

- `GET /pairing/pending` -> `{ pairings: [{ code, createdAt, expiresAt }] }`
- `POST /pairing/approve` `{ code }` -> `{ approved: { publicKey, pairingCode } }`
- `DELETE /pairing/revoke` `{ code }` -> `{ revoked: true }`
- `GET /pairing/approved` -> `{ keys: [{ pairingCode, label, approvedAt }] }`

### CLI subcommands

Implemented in `server/src/cli/`. The entry point detects subcommands before starting the server.

```
float-server pairing list          # GET /pairing/pending + GET /pairing/approved
float-server pairing approve <code> # POST /pairing/approve
float-server pairing revoke <code>  # DELETE /pairing/revoke
```

## Network modes

Configured via `networkMode` in config.json.

| Mode        | Bind address | Transport security        | Pairing required |
| ----------- | ------------ | ------------------------- | ---------------- |
| `local`     | `127.0.0.1`  | N/A (loopback)            | Yes              |
| `tailscale` | `127.0.0.1`  | WireGuard (via Tailscale) | Yes              |
| `lan`       | `0.0.0.0`    | None (plaintext)          | Yes              |

- `lan` mode logs a prominent warning on startup about unencrypted transport

## Data directory

All server data files are stored in `~/.config/float-code/server/` (XDG-compliant).

| File                    | Description                     |
| ----------------------- | ------------------------------- |
| `config.json`           | Server configuration (v2)       |
| `approved-keys.json`    | Approved public key registry    |
| `pending-pairings.json` | Pending pairing requests        |
| `workspaces.json`       | Recently used workspace list    |
| `claude-pids.json`      | Leak prevention: PID tracking   |

All files containing secrets or keys use `writeSecretJsonAtomic` with `0600` permissions. Directories are created with `0700`.

## Config (v2)

```json
{
  "version": 2,
  "port": 8080,
  "authToken": "...",
  "localAuthToken": "...",
  "localPort": 9090,
  "networkMode": "local",
  "claude": { ... }
}
```

## Source files

| File                              | Description                                     |
| --------------------------------- | ----------------------------------------------- |
| `server/src/auth/challenge.ts`    | Challenge generation and signature verification |
| `server/src/auth/pairing.ts`      | Pairing flow logic, pending storage             |
| `shared/src/crypto/pairing-code.ts` | SHA-256 -> Base32 pairing code derivation (used by server and clients) |
| `shared/src/crypto/request-sign.ts` | REST request signing and verification |
| `shared/src/crypto/signed-fetch.ts` | fetch wrapper with auto-signing |
| `shared/src/crypto/uuid.ts` | UUID v4 generation via `@noble/hashes` |
| `server/src/auth/approved-keys.ts`| Approved key store (CRUD)                        |
| `server/src/auth/nonce-store.ts` | REST nonce replay prevention (in-memory, 60s retention) |
| `server/src/local-server.ts`      | Localhost management Hono instance              |
| `server/src/cli/index.ts`         | CLI subcommand entry point                      |
| `server/src/cli/pairing.ts`       | Pairing subcommand implementation               |
| `server/src/ws/message-guards.ts` | Runtime type guards for pre-auth messages        |
| `client-g2/src/auth/keypair.ts`   | Keypair generation (browser, localStorage)       |
| `client-cli/src/auth/keypair.ts`  | Keypair generation (Node.js, file)               |

## Related docs

- [Protocol](protocol.md): WebSocket protocol, REST API
- [Operations](operations.md): File persistence, test plan
- [Permission](../todo/permission.md): Permission MCP (shares localhost management server)
