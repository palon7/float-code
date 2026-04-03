# Claude Code Session File Specification

Claude Code saves the full history of sessions (conversations) to the local filesystem in JSONL format.

## Directory Structure

```
~/.claude/projects/<encoded-project-path>/
├── memory/                          # Auto-memory (cross-session memory)
│   ├── MEMORY.md                    # Memory index
│   └── *.md                         # Individual memory files
├── <session-id>.jsonl               # Session body (message log)
├── <session-id>/                    # Session auxiliary data (only if it exists)
│   ├── subagents/                   # Sub-agent logs
│   │   ├── agent-<id>.jsonl         # Sub-agent message log
│   │   └── agent-<id>.meta.json     # Sub-agent metadata
│   └── tool-results/                # External files for large tool results
│       └── <id>.txt                 # Tool execution result text
```

- `session-id` is in UUID v4 format (e.g., `413cfb30-e031-469c-a065-651533ceea71`)
- Session directory is only created when sub-agents or large tool results exist

### Project path encoding

Converts the project's absolute path to a directory name.

**Conversion rule:**

```js
path.replace(/[^a-zA-Z0-9]/g, "-");
```

All characters other than alphanumeric (`a-z`, `A-Z`, `0-9`) are replaced with `-`. Upper/lowercase are preserved (case-sensitive). If longer than 200 characters, truncated to the first 200 characters + base-36 hash.

**Examples:**

```
/Users/palon/work/cc-client-test  → -Users-palon-work-cc-client-test
C:\Users\john\work\project        → -C-Users-john-work-project
/home/user/.config                → -home-user--config
```

**Base path determination:**

```js
const configDir =
  process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
const projectDir = path.join(configDir, "projects", toProjectDirName(cwd));
```

The `CLAUDE_CONFIG_DIR` environment variable can override `~/.claude`.

## JSONL File Format

Each line is one JSON object. Appended in chronological order from the beginning.

### Message type list

| type                    | Description                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| `file-history-snapshot` | Snapshot of file changes (for undo)                                            |
| `queue-operation`       | Record of prompt queue operations                                              |
| `user`                  | User message (prompt input or tool result)                                     |
| `assistant`             | Assistant response (text, thinking, tool calls)                                |
| `system`                | System events (turn duration, compact boundary, local commands)                |
| `agent-name`            | Agent name for the session                                                     |
| `custom-title`          | Custom title for the session                                                   |
| `last-prompt`           | Last prompt in the session (at end of session)                                 |

---

## Details of each message type

### `file-history-snapshot`

Tracking snapshot of file changes. Used for undo/redo.

```jsonc
{
  "type": "file-history-snapshot",
  "messageId": "<uuid>", // UUID of the related message
  "snapshot": {
    "messageId": "<uuid>",
    "trackedFileBackups": {
      "<relative-path>": {
        "backupFileName": "<string | null>", // Backup file name
        "version": 1, // Version number
        "backupTime": "<ISO 8601>",
      },
    },
    "timestamp": "<ISO 8601>",
  },
  "isSnapshotUpdate": false, // true: incremental update to existing snapshot, false: new snapshot
}
```

### `queue-operation`

Record of when a prompt is added to or consumed from the queue via SDK/CLI.

```jsonc
{
  "type": "queue-operation",
  "operation": "enqueue" | "dequeue",
  "timestamp": "<ISO 8601>",
  "sessionId": "<uuid>",
  "content": "<prompt text>"  // Only on enqueue
}
```

### `user`

Input message from user. Either a direct prompt input or a tool execution result.

```jsonc
{
  "type": "user",
  "parentUuid": "<uuid | null>",    // UUID of the previous message (null for first message)
  "isSidechain": false,             // Whether this is a sidechain (branch)
  "promptId": "<uuid>",             // Prompt ID (only for user input)
  "message": {
    "role": "user",
    "content": "<string>"           // For text input
    // Or for tool_result:
    // "content": [{ "tool_use_id": "<id>", "type": "tool_result", "content": "<string>", "is_error": false }]
  },
  "uuid": "<uuid>",
  "timestamp": "<ISO 8601>",
  "permissionMode": "<string>",     // Only for user input: "default" | "acceptEdits" | "bypassPermissions" | "plan"
  "userType": "external",
  "entrypoint": "cli" | "sdk-cli",  // Launch source
  "cwd": "<absolute-path>",         // Working directory
  "sessionId": "<uuid>",
  "version": "<semver>",            // Claude Code version
  "gitBranch": "<branch-name>",

  // Additional fields for tool result messages:
  "sourceToolAssistantUUID": "<uuid>",  // UUID of the assistant message that called the tool
  "toolUseResult": { /* see below */ },
  "slug": "<string>"                    // Session slug (from second turn onward)
}
```

### `assistant`

Assistant response. One API response may be split into multiple lines (streaming).

```jsonc
{
  "type": "assistant",
  "parentUuid": "<uuid>",
  "isSidechain": false,
  "message": {
    "model": "claude-opus-4-6",     // Model used
    "id": "msg_<id>",               // Anthropic API message ID
    "type": "message",
    "role": "assistant",
    "content": [/* content blocks */],
    "stop_reason": "end_turn" | "tool_use" | null,
    "stop_sequence": null,
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 0,
      "output_tokens": 100,
      "server_tool_use": {
        "web_search_requests": 0,
        "web_fetch_requests": 0
      },
      "service_tier": "standard",
      "cache_creation": {
        "ephemeral_1h_input_tokens": 0,
        "ephemeral_5m_input_tokens": 0
      }
    }
  },
  "requestId": "req_<id>",          // API request ID
  "uuid": "<uuid>",
  "timestamp": "<ISO 8601>",
  "slug": "<string>",               // Session slug
  "userType": "external",
  "entrypoint": "cli" | "sdk-cli",
  "cwd": "<absolute-path>",
  "sessionId": "<uuid>",
  "version": "<semver>",
  "gitBranch": "<branch-name>"
}
```

#### Content Block types

| type       | Description         | Main fields                                       |
| ---------- | ------------------- | ------------------------------------------------- |
| `thinking` | Extended thinking   | `thinking` (text), `signature` (signature)        |
| `text`     | Text response       | `text`                                            |
| `tool_use` | Tool call           | `id`, `name`, `input`, `caller`                   |

**`tool_use` example:**

```jsonc
{
  "type": "tool_use",
  "id": "toolu_<id>",
  "name": "Bash", // Tool name: Bash, Read, Edit, Write, Glob, Grep, Agent, etc.
  "input": {
    "command": "ls -la",
    "description": "List files",
  },
  "caller": {
    "type": "direct", // "direct" = user's main agent
  },
}
```

### `system`

System events. Type is distinguished by `subtype`.

#### `system/turn_duration`

Duration of one turn (user input → response complete).

```jsonc
{
  "type": "system",
  "subtype": "turn_duration",
  "durationMs": 56370, // Turn duration (milliseconds)
  "messageCount": 40, // Number of messages in the turn
  "parentUuid": "<uuid>",
  "isSidechain": false,
  "isMeta": false,
  "timestamp": "<ISO 8601>",
  "uuid": "<uuid>",
  // ... common fields
}
```

#### `system/compact_boundary`

Boundary where conversation compaction (summarization compression) occurred.

```jsonc
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "parentUuid": null,
  "logicalParentUuid": "<uuid>",   // UUID of last message before compaction
  "compactMetadata": {
    "trigger": "manual" | "auto",  // Compaction trigger
    "preTokens": 251206,           // Token count before compaction
    "preCompactDiscoveredTools": [  // Tools discovered before compaction
      "EnterPlanMode",
      "TaskCreate"
    ]
  },
  // ... common fields
}
```

#### `system/local_command`

Result of a local command executed by the user with `!` prefix.

```jsonc
{
  "type": "system",
  "subtype": "local_command",
  "content": "<local-command-stdout>...</local-command-stdout>",
  "level": "info",
  // ... common fields
}
```

### `agent-name`

Agent name assigned to the session.

```jsonc
{
  "type": "agent-name",
  "agentName": "voice-input-overlay-system",
  "sessionId": "<uuid>",
}
```

### `custom-title`

Custom title assigned to the session.

```jsonc
{
  "type": "custom-title",
  "customTitle": "voice-input-overlay-system",
  "sessionId": "<uuid>",
}
```

### `last-prompt`

The last prompt recorded at the end of the session file.

```jsonc
{
  "type": "last-prompt",
  "lastPrompt": "<last user input text>",
  "sessionId": "<uuid>",
}
```

---

## `toolUseResult` field

The `toolUseResult` field in a `user` message containing tool results varies in structure by tool type.

### Bash tool result (no type)

```jsonc
{
  "stdout": "<string>",
  "stderr": "<string>",
  "interrupted": false,
  "isImage": false,
  "noOutputExpected": false,
}
```

### File read result (type: `text`)

```jsonc
{
  "type": "text",
  "file": {
    "filePath": "<absolute-path>",
    "content": "<file content>",
    "numLines": 35,
    "startLine": 1,
    "totalLines": 35,
  },
}
```

### File create result (type: `create`)

```jsonc
{
  "type": "create",
  "filePath": "<absolute-path>",
  "content": "<new file content>",
  "structuredPatch": [],
  "originalFile": null,
}
```

### File update result (type: `update`)

```jsonc
{
  "type": "update",
  "filePath": "<absolute-path>",
  "content": "<updated content>",
  "structuredPatch": [
    {
      "oldStart": 1,
      "oldLines": 12,
      "newStart": 1,
      "newLines": 14,
      "lines": [" unchanged", "-removed", "+added"],
    },
  ],
  "originalFile": "<original content>",
}
```

### File unchanged (type: `file_unchanged`)

```jsonc
{
  "type": "file_unchanged",
  "file": {
    "filePath": "<absolute-path>",
  },
}
```

---

## Sub-agents

Sub-agents launched with the Agent tool are saved in `subagents/` inside the session directory.

### `agent-<id>.meta.json`

```jsonc
{
  "agentType": "Explore", // Agent type: "Explore", "Plan", etc.
  "description": "Explore Even Hub SDK APIs", // Agent description
}
```

### `agent-<id>.jsonl`

Same JSONL format as the main session. Each message has an additional `agentId` field.

---

## Common fields

Fields common to many message types:

| Field         | Type           | Description                                                                          |
| ------------- | -------------- | ------------------------------------------------------------------------------------ |
| `uuid`        | string         | Unique identifier for the message (UUID v4)                                          |
| `parentUuid`  | string \| null | UUID of the previous message. Forms a linked list structure of the conversation      |
| `isSidechain` | boolean        | Whether this is a conversation branch (sidechain)                                    |
| `timestamp`   | string         | ISO 8601 format timestamp                                                            |
| `sessionId`   | string         | Session ID (matches the filename)                                                    |
| `version`     | string         | Claude Code version (e.g., `2.1.87`)                                                 |
| `entrypoint`  | string         | Launch source. `cli` (normal CLI) or `sdk-cli` (via SDK)                             |
| `cwd`         | string         | Absolute path of working directory                                                   |
| `gitBranch`   | string         | Current git branch name                                                              |
| `userType`    | string         | User type (currently only `external` observed)                                       |
| `slug`        | string         | Session slug (human-readable identifier, e.g., `shiny-roaming-cat`)                 |

## Message chain structure

Messages are chained in a linked list structure via `parentUuid`.

```
user (parentUuid: null)
  → assistant (parentUuid: user.uuid)     # thinking (streaming intermediate)
    → assistant (parentUuid: prev.uuid)   # tool_use
      → user (parentUuid: prev.uuid)      # tool_result
        → assistant (parentUuid: prev.uuid) # text (final response)
```

One API call response may be split into multiple assistant messages due to streaming (sharing the same `message.id`).

## permissionMode

The `permissionMode` of a user input message indicates the session's permission mode.

| Value               | Description                                        |
| ------------------- | -------------------------------------------------- |
| `default`           | Default (user confirmation required for tool use)  |
| `acceptEdits`       | Auto-approve file edits                            |
| `bypassPermissions` | Bypass all permissions                             |
| `plan`              | Plan mode (read-only)                              |
