# Permission Model

## Workspace-scoped permission model

### Storage

File: `server/data/permission-rules.json`

```json
{
  "version": 1,
  "workspaces": {
    "/abs/path/to/workspaceA": {
      "allow": ["Bash(npm test *)", "Read(./*)"],
      "deny": ["Bash(git push *)"],
      "updatedAt": "2026-03-29T00:00:00.000Z"
    }
  }
}
```

### Scope rule

- Key is the normalized `workspacePath` (real path)
- Independent of the server's own working directory
- Target workspace is determined at connection time / session start

### Rule evaluation order

1. `deny`
2. `allow`
3. If no match: `ask` (default)

First match wins. `ask` is not an explicit rule, but a fallback behavior when neither deny nor allow matches.

## Claude-compatible permission behavior (important)

This section separates "officially confirmed facts" from "compatibility recommendations inferred from CLI implementation".

### Officially confirmed behavior

- Rule order: `deny -> allow -> (fallback: ask)`
- Rule format: `Tool` or `Tool(specifier)`
- Bash supports `*` wildcard (position-dependent)
- `Bash(ls *)` and `Bash(ls*)` have different match conditions
- Shell operators (`&&`, etc.) are recognized
- "Yes, don't ask again" on a compound command saves sub-command-level rules, not the entire command
- Bash "Yes, don't ask again" is persisted by project directory + command

### v1 compatibility policy in this server

- `Allow`:
  - Permit only this tool execution (not persisted)
- `Always Allow`:
  - Persist to workspace-scoped `allow`
  - Decompose Bash compound commands into sub-commands before saving
  - Maximum 5 rules added per approval (matching Claude's description)
- `Deny`:
  - Deny this execution
  - Does not persist deny by default (can be made optional in the future)

### Compound Bash command handling

Example: `git status && npm test`

- Parse and extract `git status` and `npm test` as candidate sub-commands
- On `Always Allow`, only the parts that required approval become rule candidates
- v1 targets the following operators:
  - `&&`, `||`, `;`, `|`, subshell `(...)`
- Strict shell parser is introduced incrementally:
  - v1: Safe simple decomposition (ask if uncertain)
  - v2: Migrate to bash AST-based approach

### Rule matching algorithm (v1)

- Bash:
  - Evaluate specifier as glob
  - Space-aware wildcard follows Claude docs description
  - When operators are present, prioritize sub-command verification over whole-string matching
- Read/Edit/WebFetch/MCP:
  - Follow official syntax
  - MCP allows `mcp__server` / `mcp__server__*` / `mcp__server__tool`

### Fallback safety

- When judgment is impossible: `ask`
- When client is not connected: hold permission prompt in pending state, delegate to Claude CLI timeout (notify on reconnect)

## `--permission-prompt-tool` integration design

### Why this path

- The CLI officially supports `--permission-prompt-tool` to receive "an MCP tool that handles permission prompts in non-interactive mode"
- Therefore, co-locating a permission-dedicated MCP tool inside the server is the shortest and most extensible approach

### Transport: Streamable HTTP (loopback on a separate port)

- The Permission MCP server runs on a **separate `http.Server`** from the public API/WS
- Bound to `host: "127.0.0.1"` so other devices on LAN cannot access it
- Port is obtained dynamically from available ports
- Uses `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport`
- Same process, so direct access to permission engine, WebSocket state, and rule store
- No IPC needed compared to stdio method (separate process), state sharing is easy

```typescript
// Conceptual example: separating public server and MCP server
import { serve } from "@hono/node-server";

// Public server (REST + WebSocket): 0.0.0.0
serve({ fetch: publicApp.fetch, hostname: "0.0.0.0", port: 8080 });

// MCP server: 127.0.0.1 only
serve({ fetch: mcpApp.fetch, hostname: "127.0.0.1", port: mcpPort });
```

### mcpConfig when starting Claude CLI

```json
{
  "mcpServers": {
    "permission": {
      "type": "http",
      "url": "http://127.0.0.1:<mcpPort>/mcp"
    }
  }
}
```

- Use `127.0.0.1` explicitly rather than `localhost` (to avoid DNS resolution ambiguity)
- Ensure the MCP server is closed when the server shuts down

Claude CLI startup command:

```
claude --mcp-config <path> --permission-prompt-tool mcp__permission__handle_permission ...
```

### Concrete design

- On Claude startup:
  - Add `--permission-prompt-tool mcp__permission__handle_permission`
  - Also inject the permission MCP server via `--mcp-config`
- When the permission MCP tool is called:
  1. Receive `tool_name/input/tool_use_id`
  2. Auto-evaluate with existing rules (allow/deny/ask)
  3. Only for `ask`: send `session.permission.request` to G2 via WS
  4. Wait for `permission.respond` and return result to Claude

### Result payload format

Follows the official Agent SDK `PermissionResultAllow/PermissionResultDeny` format:

- allow:
  - `behavior: "allow"`
  - `updated_input?`
  - `updated_permissions?`
- deny:
  - `behavior: "deny"`
  - `message`
  - `interrupt?`

### Note on internals

- In the local CLI implementation strings, `decisionClassification` (`user_temporary`, `user_permanent`, `user_reject`) etc. exist
- Since these are not guaranteed by public documentation at this time, v1 does not depend on them
- If used in the future, feature-flag them
