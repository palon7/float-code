# client-g2

Frontend for Even G2 (smart glasses). Built with React + Vite, runs in a WebView on iPhone.

## Architecture

### Layer Structure

```
src/
├── App.tsx / main.tsx          # React entry point
├── app/                        # App startup / runtime creation
│   ├── app-store.ts            # zustand: holds runtime reference
│   └── create-app-runtime.ts   # Assembles WsClient, HttpClient, G2Runtime
├── client/                     # Server communication layer
│   ├── ws.ts                   # WsClient: WebSocket connection, auth, reconnection
│   ├── http.ts                 # HttpClient: REST API (workspaces, sessions)
│   ├── session-store.ts        # zustand: session state (reducer-based)
│   ├── session-reducer.ts      # Pure transformation: ServerMessage → state
│   ├── session-format.ts       # entry → display text conversion
│   ├── workspace-store.ts      # zustand: workspace list
│   ├── format-utils.ts         # Common format utilities
│   └── send-message.ts         # Message sending helper
├── g2/                         # G2 glasses control layer
│   ├── runtime/
│   │   ├── g2-runtime.ts       # Event loop / state machine driver
│   │   ├── g2-state.ts         # G2State interface / RuntimeEvent types
│   │   └── g2-context.ts       # Aggregates dependencies used by state (DI)
│   ├── display-manager.ts      # Abstracts G2 screen rebuild / upgrade
│   ├── microphone.ts           # G2 microphone control
│   ├── text-utils.ts           # Text truncation with byte limit
│   ├── pages/constants.ts      # Screen layout constants
│   └── states/                 # Each state of the state machine
│       ├── connecting/         # Waiting for WS connection / auth
│       ├── main/               # Main screen (session display)
│       ├── menu/               # Menu screen
│       ├── workspace-select/   # Workspace selection
│       ├── session-select/     # Session selection
│       ├── voice-listening/    # Voice input in progress
│       ├── voice-confirm/      # Voice input confirmation
│       ├── error/              # Error display
│       └── sync-helpers.ts     # Common sync helpers shared between states
├── voice-input/                # Voice input service abstraction
│   ├── voice-input-service.ts  # Integration of G2 mic → STT
│   └── service-types.ts        # VoiceInputEvent type definitions
├── soniox/                     # Soniox STT client
│   ├── soniox-client.ts        # Speech recognition via WebSocket
│   └── types.ts                # Soniox API types
├── components/                 # React UI (browser side)
│   ├── ChatTab.tsx             # Chat display / text input
│   ├── LogTab.tsx              # Debug log
│   ├── SessionBar.tsx          # Session status bar
│   └── SettingsTab.tsx         # Settings screen
├── hooks/
│   └── use-app-runtime.ts      # Runtime initialization hook
└── constants.ts                # localStorage keys, URL derivation
```

### G2 State Machine

G2Runtime manages state transitions. Each state implements `enter` / `exit` / `handle`.

```
connecting ──(auth.ok + activeSession)──> main
     |                                      |
     +──(auth.ok, no session)──> workspace-select
     |                                |
     +──(error)──> error         session-select
                     |                |
                     +───(retry)──> connecting
                                      
main ──(tap)──> menu ──> workspace-select / session-select / main
  |
  +──(swipe up)──> voice-listening ──> voice-confirm ──> main
```

### Data Flow

```
[G2 Events]     [WS Messages]     [Voice Events]
      |                  |                   |
      v                  v                   v
  G2Runtime.dispatch() ← unified via RuntimeEvent union type
      |
      v
  currentState.handle(ctx, event)
      |
      +──> ctx.display (G2 screen update)
      +──> ctx.wsClient (send to server)
      +──> ctx.transition(nextState)
      +──> useSessionStore (React UI update)
```

## Commands

- `pnpm run dev`: Start development server (normally started by the user)
- `pnpm run build`: Build and output to `dist/`
- `pnpm run check`: Run typecheck + lint + format:check at once
- `pnpm run typecheck`: TypeScript type checking
- `pnpm run lint`: Check src directory with ESLint
- `pnpm run lint:fix`: Auto-fix with ESLint
- `pnpm run format`: Format src directory with Prettier
- `pnpm run format:check`: Check formatting differences

## G2 Hardware

- When a TextContainer is placed to fill the entire display area, 50 half-width characters or 28 full-width characters fit per line. Characters beyond this limit are automatically wrapped.

### Communication Path

```
[G2 Mic] --BLE--> [iPhone] --WebView--> [Web App] --WebSocket--> [Soniox API]
                                             |
                                    Display recognition result in text container
                                             |
                                 [iPhone] --BLE--> [G2 Display]
```

## Rules

- **API key handling:** Each user sets their own API key in the Web UI, stored in localStorage.
- **PCM frame size:** The G2 documentation says "40 bytes per frame", but a 10ms frame at 16kHz/16bit/mono should be 320 bytes. Check the actual `.length` of `audioPcm` in logs — if small chunks arrive continuously, buffer them and send ~100ms chunks at a time for efficiency.
- **TextContainer character limit (physical device):** Officially character-based (`createStartUpPageContainer`/`rebuildPageContainer`: 1000 chars, `textContainerUpgrade`: 2000 chars), but on physical devices the Flutter→G2 communication imposes a UTF-8 byte limit. Japanese and Unicode symbols (●, ▶, ◌, etc.) are 3 bytes per character, so even if within the character limit, `rebuildPageContainer` is silently ignored when the byte limit is exceeded (no error is returned). Use `truncateToBytes()` to enforce byte-based limits on content. The same byte limit applies to `itemName` (keep each item under ~60 bytes to be safe).
- **`createStartUpPageContainer` must come first:** `audioControl(true)` does not work until after the page is created. The startup sequence must be `createStartUpPageContainer` → `audioControl(true)` → WebSocket connection.
- **ListContainer index 0 issue:** `listEvent.currentSelectItemIndex` returns `undefined` when the first item (index 0) is selected. Always use `?? 0` to set a default value. Items at index 1, 2, ... behave normally.
- **No overlapping TextContainers (physical device):** On physical devices, placing multiple TextContainers with overlapping coordinates in `rebuildPageContainer` results in no display update (works in the simulator). This is likely a bug in Even Hub SDK 0.0.9. For overlay display, avoid overlapping TextContainers — split the layout or use `textContainerUpgrade` to replace content instead.
- **`rebuildPageContainer` return value:** Always returns `false` on physical devices. Note that it also returns `false` when content exceeds the byte limit, but without updating the display.
- **`borderRadius` is prohibited (physical device):** SDK 0.0.8+ sends `borderRadius`, but older EvenHub apps only understand the old field name `borderRdaius` (a protobuf typo). Any `rebuildPageContainer` / `createStartUpPageContainer` that includes `borderRadius` is silently ignored on physical devices. Do not use `borderRadius` until the EvenHub app is updated.
- **Browser-side UI must follow EvenReality's design system:** Refer to `/docs/er-design-guideline.md` and always design according to the guidelines. Actively use even-toolkit components.

---

## Documentation

- [Unofficial Even G2 API Documentation](https://raw.githubusercontent.com/nickustinov/even-g2-notes/refs/heads/main/docs/README.md)
- [Official Even G2 Document (occasionally inaccurate)](https://hub.evenrealities.com/docs/getting-started/overview/)
- [Soniox Speech-to-Text API Documentation](https://soniox.com/docs/llms.txt)
