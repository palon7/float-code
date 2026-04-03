import { useCallback, useEffect, useRef, useState } from "react";
import { Card, StatusDot } from "even-toolkit/web";
import { useAppStore, type BridgeStatus } from "../app/app-store";
import {
  formatToolName,
  getPrimaryParam,
  type LogLine,
} from "../client/session-format";
import { sendMessage } from "../client/send-message";
import { useSessionStore } from "../client/session-store";
import type { ConnectionStatus } from "../client/ws";
import { SessionBar } from "./SessionBar";

const AUTO_SCROLL_THRESHOLD = 80;

function isNearBottom(el: HTMLElement): boolean {
  return (
    el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD
  );
}

function BridgeDot({ status }: { status: BridgeStatus }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-text-dim">
      <StatusDot connected={status === "connected"} />
      Bridge
    </span>
  );
}

function ServerDot({ status }: { status: ConnectionStatus }) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-text-dim">
      <StatusDot connected={status.state === "connected"} />
      Server
    </span>
  );
}

function ChatEntry({ line }: { line: LogLine }) {
  const { entry, result } = line;

  switch (entry.kind) {
    case "system":
      return (
        <div className="py-2 text-center text-[11px] text-text-dim">
          Session started ({entry.model})
        </div>
      );

    case "user_message":
      return (
        <div className="flex justify-end py-1">
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[6px] bg-accent px-3 py-2 text-[13px] text-text-highlight">
            {entry.text}
          </div>
        </div>
      );

    case "thinking":
      if (!entry.text) return null;
      return (
        <div className="py-1">
          <div className="max-w-[85%] whitespace-pre-wrap break-words text-[12px] text-text-dim italic">
            {entry.text}
          </div>
        </div>
      );

    case "tool_call": {
      const name = formatToolName(entry.toolName);
      const param = getPrimaryParam(entry.toolName, entry.input);

      return (
        <div className="py-1">
          <div className="rounded-[6px] bg-surface-light px-3 py-2 text-[12px]">
            <span className="font-medium">{name}</span>
            {param ? <span className="ml-1 text-text-dim">{param}</span> : null}
            {result ? (
              <div className="mt-1 truncate text-[11px] text-text-dim">
                {result.isError ? "Error: " : ""}
                {result.content.replaceAll("\n", " ").slice(0, 100)}
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    case "text": {
      const trimmed = entry.text.replace(/^\n+|\n+$/g, "");
      if (!trimmed) return null;
      return (
        <div className="flex py-1">
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[6px] bg-surface px-3 py-2 text-[13px]">
            {trimmed}
          </div>
        </div>
      );
    }

    case "result":
      return (
        <div className="py-2 text-center text-[11px] text-text-dim">
          {entry.isError
            ? "Error"
            : `Done (${entry.numTurns} turns, $${entry.totalCostUsd.toFixed(4)}, ${(entry.durationMs / 1000).toFixed(1)}s)`}
        </div>
      );

    case "notification":
      return (
        <div className="py-2 text-center text-[11px] text-text-dim">
          {entry.text}
        </div>
      );

    default:
      return null;
  }
}

function MessageInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => boolean;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    if (onSend(trimmed)) setText("");
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0";
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  }, [text]);

  return (
    <div className="flex shrink-0 items-end gap-2 bg-bg px-1 pb-3 pt-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none rounded-[6px] bg-input-bg px-4 py-3 text-[15px] tracking-[-0.15px] text-text outline-none placeholder:text-text-dim disabled:opacity-50"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[6px] bg-accent text-text-highlight transition-colors disabled:pointer-events-none disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
          <rect x={10} y={4} width={2} height={2} fill="currentColor" />
          <rect x={10} y={6} width={2} height={2} fill="currentColor" />
          <rect x={10} y={8} width={2} height={2} fill="currentColor" />
          <rect x={10} y={10} width={2} height={2} fill="currentColor" />
          <rect x={10} y={12} width={2} height={2} fill="currentColor" />
          <rect x={10} y={14} width={2} height={2} fill="currentColor" />
          <rect x={10} y={16} width={2} height={2} fill="currentColor" />
          <rect x={8} y={6} width={2} height={2} fill="currentColor" />
          <rect x={12} y={6} width={2} height={2} fill="currentColor" />
          <rect x={6} y={8} width={2} height={2} fill="currentColor" />
          <rect x={14} y={8} width={2} height={2} fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}

export function ChatTab() {
  const bridgeStatus = useAppStore((s) => s.bridgeStatus);
  const wsStatus = useAppStore((s) => s.wsStatus);
  const wsClient = useAppStore((s) => s.wsClient);
  const lines = useSessionStore((s) => s.lines);
  const sessionStatus = useSessionStore((s) => s.sessionStatus);
  const statusText = useSessionStore((s) => s.getStatusText());

  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottom = useRef(true);

  const hasActive = useSessionStore((s) => s.hasActive);

  // spawning 中もサーバーがキューイングするので送信可能
  const canSend =
    wsStatus.state === "connected" &&
    wsClient !== null &&
    hasActive &&
    sessionStatus !== "none" &&
    sessionStatus !== "waiting_permission";

  const handleSend = useCallback(
    (text: string): boolean => (wsClient ? sendMessage(wsClient, text) : false),
    [wsClient],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      wasAtBottom.current = isNearBottom(el);
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    if (!wasAtBottom.current) return;
    // DOM 描画完了後にスクロールするため rAF で遅延
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
    return () => cancelAnimationFrame(id);
  }, [lines]);

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      aria-label="Chat"
    >
      <Card
        className="flex shrink-0 items-center justify-between"
        padding="default"
        variant="elevated"
      >
        <div className="flex items-center gap-3">
          <BridgeDot status={bridgeStatus} />
          <ServerDot status={wsStatus} />
        </div>
        <span className="truncate text-[12px] text-text-dim">{statusText}</span>
      </Card>

      <div className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-bg to-transparent" />
        <div ref={scrollRef} className="h-full overflow-y-auto pb-4 pt-4">
          <div className="space-y-1 px-1">
            {lines.length > 0 ? (
              lines.map((line) => <ChatEntry key={line.id} line={line} />)
            ) : (
              <p className="py-8 text-center text-[13px] text-text-dim">
                No messages yet
              </p>
            )}
          </div>
        </div>
      </div>

      <SessionBar />
      <MessageInput onSend={handleSend} disabled={!canSend} />
    </section>
  );
}
