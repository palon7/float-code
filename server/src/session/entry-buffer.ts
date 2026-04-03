import type { ParsedEntry, TextEntry, ThinkingEntry } from "@palon7/cc-client";

const MAX_BYTES = 1_500_000; // ~1.5MB

// WeakMap でエントリごとのバイト推定値をキャッシュ
const bytesCache = new WeakMap<ParsedEntry, number>();

function estimateBytes(entry: ParsedEntry): number {
  let bytes = bytesCache.get(entry);
  if (bytes !== undefined) return bytes;
  bytes = JSON.stringify(entry).length;
  bytesCache.set(entry, bytes);
  return bytes;
}

export class EntryBuffer {
  private entries: ParsedEntry[] = [];
  private totalBytes = 0;

  constructor(private readonly maxEntries = 300) {}

  add(entry: ParsedEntry): void {
    this.entries.push(entry);
    this.totalBytes += estimateBytes(entry);
    this.trimExcess();
  }

  appendTextDelta(id: string, deltaText: string): ParsedEntry | null {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) return null;
    const existing = this.entries[index];
    if (existing?.kind !== "text" && existing?.kind !== "thinking") {
      return null;
    }
    this.totalBytes -= estimateBytes(existing);
    const updated = {
      ...existing,
      text: existing.text + deltaText,
    } as TextEntry | ThinkingEntry;
    this.entries[index] = updated;
    this.totalBytes += estimateBytes(updated);
    this.trimExcess();
    return updated;
  }

  replaceEntry(id: string, entry: ParsedEntry): boolean {
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) return false;
    this.totalBytes -= estimateBytes(this.entries[index]);
    this.entries[index] = entry;
    this.totalBytes += estimateBytes(entry);
    this.trimExcess();
    return true;
  }

  clearStreaming(): void {
    this.entries = this.entries.filter((e) => {
      if ("isStreaming" in e && e.isStreaming === true) {
        this.totalBytes -= estimateBytes(e);
        return false;
      }
      return true;
    });
  }

  hasStreamingEntries(): boolean {
    return this.entries.some(
      (e) => "isStreaming" in e && e.isStreaming === true,
    );
  }

  getAll(): ParsedEntry[] {
    return [...this.entries];
  }

  get size(): number {
    return this.entries.length;
  }

  private trimExcess(): void {
    while (
      this.entries.length > 0 &&
      (this.entries.length > this.maxEntries || this.totalBytes > MAX_BYTES)
    ) {
      const removed = this.entries.shift()!;
      this.totalBytes -= estimateBytes(removed);
    }
  }
}
