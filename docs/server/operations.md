# Operations

## Auth and network policy

### Authentication

- Two-factor: shared `authToken` + Ed25519 public key challenge-response
- REST API: Per-request Ed25519 signature (no bearer credential transmitted). See [protocol.md](protocol.md) for details
- WebSocket: `auth { publicKey, authToken }` -> `auth.challenge` -> `auth.response { signature }` -> `auth.ok`
- New devices go through a pairing flow: `pairing` -> `pairing.pending { code }` -> user approves via CLI
- See [pairing.md](pairing.md) for full details

### Network modes

- `local` (default): bind to `127.0.0.1`, loopback only
- `tailscale`: bind to `127.0.0.1`, accessed via `tailscale serve` (WireGuard encryption)
- `lan`: bind to `0.0.0.0`, plaintext transport (warning logged on startup)

### Security defaults

- Pre-auth messages are validated by type guards before processing (publicKey format, signature format)
- authToken verified with `crypto.timingSafeEqual`
- REST requests authenticated via per-request Ed25519 signature with timestamp (±30s) and nonce replay prevention (60s retention)
- Unauthenticated connections time out after 10 seconds
- All secret files (`config.json`, `approved-keys.json`, `pending-pairings.json`) written with `0600` permissions
- `origin`/`host` checks can be enabled via configuration
- Permission response timeout is delegated to the Claude CLI side (the server does not time out)
- Do not log tokens or private keys in plaintext

### Management server

- Separate Hono instance on `127.0.0.1:localPort` (default 9090)
- Uses a separate `localAuthToken` for authentication
- Provides pairing management endpoints (list/approve/revoke)
- CLI subcommands available: `float-server pairing list/approve/revoke`

## File Persistence Strategy

JSON files under `~/.config/float-code/server/` use atomic writes to prevent corruption on crash. Files containing secrets additionally use `writeSecretJsonAtomic` which enforces `0600` file permissions and `0700` directory permissions.

### Method: tmp + fsync + rename

Implemented with `node:fs`, no external dependencies:

1. Create a temporary file in the same directory (`<target>.tmp.<random>`)
2. Write JSON
3. Flush to disk with `fsync`
4. Replace the target path with `rename` (atomic on POSIX)
5. Delete the temporary file on error

```typescript
async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp.${crypto.randomUUID()}`;
  const fd = await fs.open(tmp, "w");
  try {
    await fd.writeFile(JSON.stringify(data, null, 2));
    await fd.sync();
    await fd.close();
    await fs.rename(tmp, path);
  } catch (e) {
    await fd.close().catch(() => {});
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}
```

### Applicable targets

Use `writeJsonAtomic` for non-secret files and `writeSecretJsonAtomic` for files containing tokens or keys. Normal `fs.readFile` is sufficient for reads.

## Test plan

### Unit

- Workspace browsing (hidden directory exclusion, .git detection)
- Order and limit management of recently used workspaces

### Integration

- Unauthenticated connections cannot drop existing authenticated connections
- Multiple clients can authenticate and connect simultaneously
- `session.open` -> `session.started` is delivered to all clients
- A client that joins mid-session can receive session state via `activeSession` in `auth.ok`
- `session.send` with a done session resumes via `--resume`
- `session.open` while a session is active causes the previous session to abort → done → new session starts
- With 2 simultaneous clients sending `session.open`, only one succeeds

### Reconnect / disconnect

- Session continues during disconnection; reconnection can restore buffer via `auth.ok`
- Orphaned Claude CLI processes are stopped on server restart
- `auth.ok` has null `activeSession` after server restart
- After server restart, `session.send { sessionId }` -> `--resume` can resume the session

### Edge cases

- Additional `session.send` during resume spawn is queued
- Claude CLI process crash -> `session.done` is sent to all clients
- No active session + `session.send` (sessionId omitted) -> `SESSION_NOT_FOUND` error

### Failure cases

- Authentication failure
- Authentication timeout (10s)
- Memory release on session end
- Missing/corrupted history files

## References

- Claude Code CLI reference:
  - https://code.claude.com/docs/en/cli-reference
- Claude Code permissions:
  - https://code.claude.com/docs/en/permissions
- Agent SDK Python reference (`permission_prompt_tool_name`, `CanUseTool`, `PermissionResult*`):
  - https://platform.claude.com/docs/en/agent-sdk/python
