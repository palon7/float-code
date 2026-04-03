// ANSI escape sequences (colors, cursor movement, etc.)
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

export function stripAnsiEscapes(s: string): string {
  return s.replace(ANSI_ESCAPE_RE, "");
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function byteLength(s: string): number {
  return encoder.encode(s).length;
}

// 先頭を残す形で UTF-8 バイト数を maxBytes 以内に切り詰める
export function truncateToBytesHead(s: string, maxBytes: number): string {
  const encoded = encoder.encode(s);
  if (encoded.length <= maxBytes) return s;

  let end = maxBytes;
  // UTF-8 の継続バイト (10xxxxxx) をスキップして文字境界に合わせる
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) {
    end--;
  }

  return decoder.decode(encoded.subarray(0, end));
}

// 末尾を残す形で UTF-8 バイト数を maxBytes 以内に切り詰める
export function truncateToBytes(s: string, maxBytes: number): string {
  const encoded = encoder.encode(s);
  if (encoded.length <= maxBytes) return s;

  let start = encoded.length - maxBytes;
  // UTF-8 の継続バイト (10xxxxxx) をスキップして文字境界に合わせる
  while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) {
    start++;
  }

  return decoder.decode(encoded.subarray(start));
}

// G2実機の表示メトリクスに基づく行幅計算用の定数
// 実測: 半角50文字/行、全角28文字/行 → lcm(50,28) = 700
const LINE_UNITS = 700;
const HALF_UNITS = 14; // 700 / 50
const FULL_UNITS = 25; // 700 / 28

const WIDE_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF01-\uFF60\uFFE0-\uFFE6]/u;
const ZERO_WIDTH_RE = /\p{Mark}|\u200d|\ufe0e|\ufe0f/u;

function charUnits(ch: string): number {
  if (ZERO_WIDTH_RE.test(ch)) return 0;
  return WIDE_RE.test(ch) ? FULL_UNITS : HALF_UNITS;
}

export type TextLayout = {
  normalized: string;
  chars: string[];
  offsets: number[];
  byteOffsets: number[];
  rowStarts: number[];
};

export function computeTextLayout(text: string): TextLayout {
  const normalized = text.replace(/\r\n?/g, "\n");
  const chars = Array.from(normalized);
  const offsets = new Array<number>(chars.length);
  const byteOffsets = new Array<number>(chars.length + 1);
  const rowStarts = [0];

  let utf16Offset = 0;
  let byteOffset = 0;
  let rowUnits = 0;

  byteOffsets[0] = 0;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    offsets[i] = utf16Offset;
    utf16Offset += ch.length;

    byteOffset += byteLength(ch);
    byteOffsets[i + 1] = byteOffset;

    if (ch === "\n") {
      if (i + 1 < chars.length) rowStarts.push(i + 1);
      rowUnits = 0;
      continue;
    }

    const units = charUnits(ch);
    if (rowUnits > 0 && rowUnits + units > LINE_UNITS) {
      rowStarts.push(i);
      rowUnits = 0;
    }
    rowUnits += units;
  }

  return { normalized, chars, offsets, byteOffsets, rowStarts };
}

export function findTailByteStart(
  byteOffsets: number[],
  maxBytes: number,
): number {
  const charCount = byteOffsets.length - 1;
  if (maxBytes <= 0) return charCount;
  const totalBytes = byteOffsets[charCount];
  if (totalBytes <= maxBytes) return 0;
  const minByteOffset = totalBytes - maxBytes;
  return byteOffsets.findIndex((b) => b >= minByteOffset);
}

// 見つからない場合は index をそのまま返す（行がバイト制限より大きい場合のフォールバック）
export function findNextRowStart(rowStarts: number[], index: number): number {
  const found = rowStarts.find((s) => s >= index);
  return found ?? index;
}

/**
 * メイン画面ログ用: バイト上限 + 表示行数上限で末尾を残して切り詰める。
 */
export function truncateForDisplay(
  text: string,
  maxBytes: number,
  maxRows: number,
): string {
  const layout = computeTextLayout(text);
  if (!layout.normalized) return layout.normalized;

  let startByRows = 0;
  if (layout.rowStarts.length > maxRows) {
    startByRows = layout.rowStarts[layout.rowStarts.length - maxRows];
  }

  const startByBytes = findTailByteStart(layout.byteOffsets, maxBytes);
  const alignedByBytes = findNextRowStart(layout.rowStarts, startByBytes);

  const start = Math.max(startByRows, alignedByBytes);
  if (start >= layout.chars.length) return "";
  return layout.normalized.slice(layout.offsets[start]);
}
