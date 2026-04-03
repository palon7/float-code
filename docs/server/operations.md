# Operations

## Auth and network policy

### v1 auth

- Shared token (stored in `server/data/config.json`)
- REST API: `Authorization: Bearer <token>` header validated by Hono middleware
- WebSocket: all messages are rejected until the `auth` message succeeds
- On the client side (G2 Web App), the token is entered in a text box and saved to localStorage

### Security defaults

- Unauthenticated connections are immediately closed
- `origin`/`host` checks can be enabled via configuration
- Permission response timeout is delegated to the Claude CLI side (the server does not time out)
- Do not log tokens in plaintext

### Future hooks

- Mutual authentication based on public keys
- Pairing UI

## File Persistence Strategy

JSON files under `data/` (`config.json`, `workspaces.json`, `claude-pids.json`) use atomic writes to prevent corruption on crash.

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

Use this utility for all writes to `data/*.json` files. Normal `fs.readFile` is sufficient for reads.

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
