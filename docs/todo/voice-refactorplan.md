# G2 State Machine Refactor Plan

## Goals

- Separate G2 screen transitions and behavior from `App.tsx` and Web UI
- Manage G2 side with a single active state
- Allow screen overlapping, but only the frontmost state holds processing logic
- Extract voice input as a headless service that does not directly operate G2 UI
- Continue to use `display-manager` as the foundation without overloading its responsibilities

## Confirmed decisions (2026-03-29)

- `audioControl` and Soniox connection / PCM transfer are handled by `VoiceInputService`
- The runtime commands `VoiceInputService` to start/stop, and controls UI and state transitions based on received events
- `VoiceInputService -> runtime` notifies events via callback, not direct reference
- `VoiceInputService.start()` returns a session with `sessionId`, and `stop()` returns `Promise<void>` to await stop completion
- If `start()` is called while an old session is running, throw an error (the runtime must guarantee stop → await → start order)
- The runtime ignores delayed events that don't match the current `sessionId`
- Double-click meaning is only implemented as `idle=start` and `voice-listening=manually stop and proceed to confirm` for now (others remain undefined)
- Provide `maxSessionMs` timeout for automatic stop in case endpoint does not arrive

## Premises

- The G2 side always needs only one active state
- Screens may be overlaid, but background state processing can be stopped
- There is no plan to start voice input from the Web UI
- `createStartUpPageContainer` is called only once; subsequent screen updates use `rebuildPageContainer`
- `onEvenHubEvent` for UI operations (text/list/sys) is handled by the runtime
- `audioControl` and voice `onEvenHubEvent` (audioEvent) are handled by `VoiceInputService`

## Target separation of concerns

### `App.tsx`

- Display bridge connection status
- Settings input in Web UI (API key, etc.)
- Only starts G2 runtime
- Does not handle G2 screen transitions or G2 events

### `src/g2/display-manager.ts`

- Compositing base page and overlay
- Calling `rebuildPageContainer`
- Setting up event capture for frontmost container
- Helper to look up container id from container name
- Low-level foundation for event delivery

The following are excluded:

- Business flow
- Voice input flow
- State transition rules
- Soniox integration

### `src/g2/runtime/*`

- State machine for the entire G2
- Switching active state
- Executing `enter` / `exit` / `handle` for states (transitions serialized via queue)
- G2 startup sequence after bridge initialization
- Bundler of G2-facing services
- `VoiceInputService` session lifecycle management (start/stop, sessionId matching)
- Forwarding events from `VoiceInputService` to the state machine

### `src/voice-input/*`

- Headless service for voice input
- G2 UI independent
- Soniox connection, PCM transfer, `audioControl` control
- Transcript update notifications
- Endpoint notifications
- Error notifications
- Stopped notifications

## Recommended directory structure

```text
src/
  App.tsx
  app/
    create-app-runtime.ts
  g2/
    display-manager.ts
    runtime/
      g2-runtime.ts
      g2-state.ts
      g2-context.ts
    states/
      idle/
        state.ts
        view.ts
      voice-listening/
        state.ts
        view.ts
      voice-confirm/
        state.ts
        view.ts
    services/
      g2-microphone.ts
      g2-text.ts
  voice-input/
    transcription-session.ts
    voice-input-service.ts
    soniox-client.ts
    types.ts
```

Notes:

- Existing `src/g2/pages/*` will eventually be merged into `src/g2/states/*/view.ts`
- Existing `src/g2/microphone.ts` will be moved to the equivalent of `src/g2/services/g2-microphone.ts`
- `voice-input-context.tsx` is a candidate for deletion or minimization

## State Machine Design

### Basic policy

- Only one state is active at a time
- Only the active state processes `onEvenHubEvent`
- UI and side effects of a state are encapsulated within that state
- Views are pure functions
- Transitions between states only happen through the runtime
- The runtime's `transition` is processed in a serial queue. If another transition is requested while a transition is in progress (e.g., awaiting `stop()` in exit), it is queued and executed sequentially after the preceding transition completes
- Voice input events are received by the runtime and only those matching the current `sessionId` are processed

### Interface proposal

Events entering the runtime are either G2 events or voice input events, but the state's handler is unified to one.

```ts
export type RuntimeEvent =
  | { kind: "g2"; event: EvenHubEvent }
  | { kind: "voice"; event: VoiceInputEvent };

export interface G2State {
  id: string;
  enter(ctx: G2Context): Promise<void> | void;
  exit?(ctx: G2Context): Promise<void> | void;
  handle?(ctx: G2Context, event: RuntimeEvent): Promise<void> | void;
}
```

- The runtime wraps G2 events and `VoiceInputService` callbacks into `RuntimeEvent` and delegates to the active state's `handle`
- Does not directly operate on state from `VoiceInputService` callbacks

### What `G2Context` includes

```ts
export interface G2Context {
  bridge: EvenAppBridge;
  display: G2DisplayManager;
  transition: (next: G2State) => Promise<void>;
  voiceInput: VoiceInputService;
  getVoiceSession: () => VoiceInputSession | null;
  setVoiceSession: (session: VoiceInputSession | null) => void;
  getSettings: () => {
    sonioxApiKey: string;
  };
  updateTranscript: (text: string) => Promise<void>;
}
```

Key points:

- States do not depend on React
- States build the screen through `display-manager`
- States call `voiceInput`, but `voiceInput` does not know about G2 screens

## Responsibilities per state

### `idle`

- Display default screen
- Receive double-click
- Check for API key presence
- Transition to `voice-listening` if voice input can start
- Double-click meaning is only "start"

### `voice-listening`

- Display listening overlay or page
- Call `VoiceInputService.start()` and retain the session
- Update with `textContainerUpgrade` on transcript events
- Transition to `voice-confirm` on endpoint
- On error: display error message on G2 screen for 3 seconds, then transition to `idle`. Double-clicks during the 3 seconds are ignored
- On `maxSessionMs` timeout: transition to `voice-confirm` if transcript exists, otherwise to `idle`
- Double-click meaning is "manually stop and proceed to confirm": after `await session.stop("manual_confirm")`, pass the retained transcript to `voice-confirm`
- `exit` performs cleanup including `await session.stop(...)`

### `voice-confirm`

- Display recognition result with `OK / Retry / Cancel`
- `OK`: apply transcript to default screen and return to `idle`
- `Retry`: return to `voice-listening`
- `Cancel`: return to `idle`
- Double-click meaning is currently undefined (not implemented)

## Handling Views

### Conclusion

- Keep view and behavior close together
- But don't cram everything in one file — split `state.ts` and `view.ts` under each state

Reasons:

- Easy to track responsibilities per state
- UI definition and behavior are close, less confusion when making changes
- Clearer than scattering pure views in `pages/` about which state uses which screen

### Example

```text
src/g2/states/voice-listening/
  state.ts
  view.ts
```

- `state.ts`: enter, exit, event handling, service coordination
- `view.ts`: pure builders like `buildVoiceListeningOverlay()`

## Handling `display-manager`

### Current assessment

The existing `display-manager` is appropriate in direction.

- Compositing base screen and overlay
- Reassigning container ids
- Premise that only frontmost receives events

This fits this project.

### Change policy

Converge to the following without major breakage:

- Fix responsibilities to "foundation for rendering and event delivery"
- Does not hold active state itself
- High-level concepts like `setBaseEventHandler` can eventually be moved to the runtime side

### Considerations

Whether to keep page's `onEvent` inside `display-manager` has migration cost, so introduce incrementally, but the final goal is fixed as runtime-driven (Plan B).

Plan A (early migration):

- `display-manager` maintains the current `G2PageDef.onEvent`
- Runtime passes active state's view to `display-manager`
- Easy to migrate with small changes
- However, while overlay is present, do not fall back to base handler (make it no-op if overlay has no `onEvent`)

Plan B (final goal):

- Remove page-level `onEvent` from `display-manager`
- All events received by runtime, delegated to active state
- Cleaner design

Use Plan A compatibility layer in Phase 1, converge to Plan B in Phase 3.

## Voice Input Separation

### Goal

- Do not let `VoiceInputProvider` operate G2 UI
- Make voice input a headless service

### `VoiceInputService` responsibilities

- Start with API key
- Connect G2 mic source to Soniox client
- Manage `audioControl(true/false)` start/stop
- Transcript update notifications
- Endpoint notifications
- Error notifications
- Stopped notifications
- Automatic stop on timeout
- stop (can await stop completion)

### `VoiceInputService` interface proposal

```ts
export type VoiceInputEvent =
  | {
      type: "transcript";
      sessionId: string;
      finalText: string;
      interimText: string;
    }
  | {
      type: "endpoint";
      sessionId: string;
      finalText: string;
    }
  | {
      type: "error";
      sessionId: string;
      message: string;
    }
  | {
      type: "stopped";
      sessionId: string;
      reason:
        | "manual_confirm"
        | "completed"
        | "timeout"
        | "error";
    };

export interface VoiceInputSession {
  sessionId: string;
  stop(reason?: "manual_confirm" | "completed"): Promise<void>;
}

export interface VoiceInputService {
  start(args: {
    apiKey: string;
    maxSessionMs?: number;
    onEvent: (event: VoiceInputEvent) => void;
  }): Promise<VoiceInputSession>;
}
```

Stop contract:

- Calling `stop()` stops the mic and disconnects Soniox, fires the `stopped` event, then resolves
- After `stop()` resolves, no more events are fired (including delayed transcripts)
- If `start()` is called while an old session is running, throw an error

This service does not know about:

- G2 overlay
- G2 state
- Web UI

## App Startup Sequence

### Target sequence

1. `waitForEvenAppBridge()`
2. Create G2 runtime
3. Runtime executes `createStartUpPageContainer` once only
4. Transition to initial state `idle`
5. Runtime subscribes to G2 events for UI (text/list/sys) and delivers to active state
6. Only when voice starts, call `VoiceInputService.start()`; voice events enter the runtime via callback

### Final image of `App.tsx`

- Just call `createAppRuntime(...).start()` after bridge connection
- Does not handle G2 side double-click processing
- Does not handle G2 side overlay control

## Implementation Phases

### Phase 0: Fix contracts (interfaces)

- Finalize `RuntimeEvent` union (`g2` / `voice`) and `G2State.handle`
- Finalize types for `VoiceInputEvent` / `VoiceInputSession` / `VoiceInputService.start()` first
- Document `stop(): Promise<void>` and `sessionId` matching rules
- Document stop contract: `stopped` event fires before `stop()` resolves, no events after resolve
- Document rule: calling `start()` while old session is running throws error
- Define event on `maxSessionMs` timeout (`stopped: timeout`)
- Fix double-click meaning to only `idle=start` / `voice-listening=manually stop and proceed to confirm`

Completion criteria:

- Dependency direction between runtime and voice-input confirmed as one-way (runtime -> service command / service -> runtime event)
- Async stop and delayed event invalidation rules confirmed as specification
- State interface confirmed as unified `RuntimeEvent`

### Phase 1: Runtime foundation + idle state

- Add `src/app/create-app-runtime.ts`
- Add `src/g2/runtime/g2-state.ts`
- Add `src/g2/runtime/g2-context.ts`
- Add `src/g2/runtime/g2-runtime.ts`
- Move G2 startup processing from `App.tsx` to runtime
- Move `DOUBLE_CLICK_EVENT` processing currently in `App.tsx` to `idle/state.ts`
- Move `buildDefaultPage()` to the equivalent of `idle/view.ts`

Completion criteria:

- `App.tsx` only receives bridge and starts runtime
- `idle` view is displayed after startup
- G2 side double-click starts state transition
- G2 event dependencies removed from `App.tsx`

### Phase 2: Voice-input service + listening / confirm states

- Move `useTranscription` logic from hook to service
- Move `audioControl` control and audioEvent subscription to `VoiceInputService`
- `VoiceInputService.start()` returns session; runtime holds and discards it
- Add `voice-listening/state.ts` and `view.ts`
- Add `voice-confirm/state.ts` and `view.ts`
- Move transcript updates inside `voice-listening` state
- Implement 3-second display → idle transition on error
- On `maxSessionMs` timeout: transition to `voice-confirm` if transcript exists, otherwise `idle`
- Move `OK / Retry / Cancel` processing to `voice-confirm` state

Completion criteria:

- Voice input start and stop work without React dependency
- Can `await` stop completion before transitioning
- Entire voice input flow is contained within G2 state machine
- `VoiceInputService` only does callback notifications

### Phase 3: Cleanup + display-manager reorganization

- Delete or minimize `voice-input-context.tsx`
- Remove `VoiceInputProvider` if not needed
- Converge to runtime-driven event delivery (Plan B)
- Gradually reduce page-level `onEvent` in `display-manager`

Completion criteria:

- G2 operation code in `voice-input-context.tsx` is removed
- `display-manager` responsibilities fixed to "foundation for rendering and event delivery"
- Boundary between state machine and rendering foundation is clear

## Concrete migration targets

### `src/App.tsx`

Current:

- Bridge connection
- Startup page creation
- Default page setup
- Double-click handling

After migration:

- Bridge connection
- Runtime startup
- Web UI display only

### `src/voice-input/voice-input-context.tsx`

Current:

- Phase management
- Overlay control
- confirming screen event processing
- G2 transcript reflection

After migration:

- Deleted, or reduced to a thin wrapper for Web UI only

### `src/voice-input/use-transcription.ts`

Current:

- Hook with React state
- Actually headless session control

After migration:

- Replaced by `transcription-session.ts` or `voice-input-service.ts`

### `src/g2/pages/*`

Current:

- Pure view builders

After migration:

- Relocated to `src/g2/states/*/view.ts`

## Implementation notes

- Known bug: `soniox-client.ts`'s `ws.send(pcm.buffer as ArrayBuffer)` loses subarray offset/length. Fix to `ws.send(pcm)` when converting to service in Phase 2
- At Phase 1, voice-input is not yet connected. Double-click on idle starts transition to voice-listening, but actual voice input is connected in Phase 2
- `createStartUpPageContainer` only once
- All subsequent screen updates use `rebuildPageContainer`
- `VoiceInputService.start()` (internal `audioControl(true)`) only after startup page creation succeeds
- `textContainerUpgrade` depends on container id resolution for the active screen, so fix the naming convention for container names
- `containerName` has a 16-character limit, so keep names short
- Transcript display character limit is uniformly handled on the state side
- Guarantee one `sessionId` per session; runtime discards non-matching events
- Do not transition to next session before `stop()` completes

## Naming convention proposal

- State ids should be short and explicit
  - `idle`
  - `voice-listening`
  - `voice-confirm`
- Container names also fixed short
  - `transcript`
  - `voiceText`
  - `voiceMenu`

## Test perspectives

- Initial state is displayed after bridge connection
- `idle` double click transitions to `voice-listening`
- `voice-listening` double click manually stops and transitions to `voice-confirm`
- Transcript at manual stop is carried over to `voice-confirm`
- Transcript is reflected in the listening screen
- Transitions to confirm screen after endpoint
- `OK` applies transcript to default screen
- `Retry` returns to listening
- `Cancel` returns to idle
- On error, error message is displayed on G2 screen for 3 seconds, then returns to idle
- Double-click during error display is ignored
- Even if endpoint does not arrive, `maxSessionMs` stops it, transitioning to `voice-confirm` if transcript exists, otherwise `idle`
- Delayed events with old `sessionId` do not update UI
- `createStartUpPageContainer` is called only once

## Recommended implementation order

1. Phase 0: Fix interface/event contracts
2. Phase 1: Runtime skeleton + idle state + double-click handling migration
3. Phase 2: Voice-input service + create listening/confirm states together
4. Phase 3: Remove old code + display-manager responsibility organization

## Conclusion

- Keep `display-manager`
- Create new state machine runtime on G2 side
- Each state has `state.ts` and `view.ts`
- Make voice input a headless service that does not touch G2 UI
- `audioControl` is held by `VoiceInputService`; runtime controls sessions and events
- Connect runtime and voice-input at the command/event boundary, invalidate delayed events with `sessionId`
- Reduce `App.tsx` to only bootstrap and Web UI

With this approach, G2 screen changes and behavior are contained within the G2 runtime, and the web side can focus on settings UI and monitoring UI.
