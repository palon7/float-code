import { describe, expect, it } from "vitest";
import {
  byteLength,
  computeTextLayout,
  findNextRowStart,
  findTailByteStart,
  truncateForDisplay,
} from "./text-utils";

// G2表示メトリクス: 半角50文字/行, 全角28文字/行
// LINE_UNITS=700, HALF_UNITS=14, FULL_UNITS=25

describe("truncateForDisplay", () => {
  describe("空・短いテキスト", () => {
    it("空文字列はそのまま返す", () => {
      expect(truncateForDisplay("", 1000, 9)).toBe("");
    });

    it("文字数制限内のテキストはそのまま返す", () => {
      expect(truncateForDisplay("hello", 1000, 9)).toBe("hello");
    });
  });

  describe("CRLF正規化", () => {
    it("\\r\\n を \\n に正規化する", () => {
      expect(truncateForDisplay("a\r\nb", 1000, 9)).toBe("a\nb");
    });

    it("単独の \\r を \\n に正規化する", () => {
      expect(truncateForDisplay("a\rb", 1000, 9)).toBe("a\nb");
    });
  });

  describe("行数制限 (maxRows)", () => {
    it("maxRows以内なら切り詰めない", () => {
      const text = "line1\nline2\nline3";
      expect(truncateForDisplay(text, 1000, 3)).toBe(text);
    });

    it("maxRowsを超える場合は末尾の行を残す", () => {
      const text = "line1\nline2\nline3\nline4";
      expect(truncateForDisplay(text, 1000, 2)).toBe("line3\nline4");
    });

    it("半角50文字を超えるとソフトラップが発生する", () => {
      const longLine = "A".repeat(50) + "B".repeat(50);
      // 1行目: A×50, 2行目: B×50 → 2表示行
      expect(truncateForDisplay(longLine, 1000, 1)).toBe("B".repeat(50));
    });

    it("全角28文字を超えるとソフトラップが発生する", () => {
      const longLine = "あ".repeat(28) + "い".repeat(28);
      // 1行目: あ×28, 2行目: い×28 → 2表示行
      expect(truncateForDisplay(longLine, 1000, 1)).toBe("い".repeat(28));
    });
  });

  describe("バイト制限 (maxBytes)", () => {
    it("ASCII テキストのバイト制限", () => {
      const text = "ABCDEFGHIJ"; // 10バイト
      expect(truncateForDisplay(text, 5, 9)).toBe("FGHIJ");
    });

    it("日本語テキストのバイト制限", () => {
      // 全角1文字 = 3バイト
      const text = "あいうえお"; // 15バイト
      const result = truncateForDisplay(text, 9, 9);
      expect(result).toBe("うえお"); // 9バイト
    });
  });

  describe("バイト制限の行境界アラインメント", () => {
    it("バイト制限が行の途中にかかる場合、次の行頭に揃える", () => {
      // "あいうえおかきくけこ\nさしすせそ" = 46バイト
      // maxBytes=30 → startByBytes=6("き") → align→11("さ")
      const text = "あいうえおかきくけこ\nさしすせそ";
      const result = truncateForDisplay(text, 30, 9);
      expect(result).toBe("さしすせそ");
    });

    it("バイト制限が行頭にぴったり一致する場合はそのまま", () => {
      // "AAAAA\nBBBBB" = 11バイト
      // maxBytes=5 → startByBytes=6("B") = rowStart → alignそのまま
      const text = "AAAAA\nBBBBB";
      const result = truncateForDisplay(text, 5, 9);
      expect(result).toBe("BBBBB");
    });

    it("ソフトラップの行境界にも揃える", () => {
      // 半角50文字で1表示行 → 50文字+50文字 = 2表示行
      const line1 = "A".repeat(50);
      const line2 = "B".repeat(50);
      const text = line1 + line2; // 100バイト、ソフトラップで2表示行
      // maxBytes=80 → startByBytes=20("A"の21文字目) → align→50(line2先頭)
      const result = truncateForDisplay(text, 80, 9);
      expect(result).toBe(line2);
    });
  });

  describe("バイト制限と行数制限の両方が効く場合", () => {
    it("行数制限の方が厳しい場合はそちらが採用される", () => {
      // 3行のテキスト、各行5バイト + 改行
      const text = "AAAAA\nBBBBB\nCCCCC"; // 17バイト
      // maxRows=1 → 末尾1行: "CCCCC" (startByRows=12)
      // maxBytes=100 → 制限なし (startByBytes=0)
      // 行数制限の方が厳しい
      const result = truncateForDisplay(text, 100, 1);
      expect(result).toBe("CCCCC");
    });

    it("バイト制限の方が厳しい場合はそちらが採用される", () => {
      // 3行のテキスト
      const text = "AAAAA\nBBBBB\nCCCCC"; // 17バイト
      // maxRows=9 → 制限なし (startByRows=0)
      // maxBytes=5 → 末尾5バイト: startByBytes=12("C") = 行頭なのでalignそのまま
      const result = truncateForDisplay(text, 5, 9);
      expect(result).toBe("CCCCC");
    });
  });

  describe("エッジケース", () => {
    it("バイト制限が全体より大きい場合はそのまま", () => {
      const text = "hello";
      expect(truncateForDisplay(text, 9999, 9)).toBe("hello");
    });

    it("maxBytes=0 の場合は空文字列", () => {
      expect(truncateForDisplay("hello", 0, 9)).toBe("");
    });

    it("末尾が改行で終わる場合", () => {
      const text = "line1\nline2\n";
      expect(truncateForDisplay(text, 1000, 9)).toBe(text);
    });
  });
});

// truncateForDisplay の結果がバイト制限を超えないことを保証するプロパティテスト
describe("truncateForDisplay invariants", () => {
  const cases = [
    "hello world",
    "あいうえおかきくけこさしすせそたちつてと",
    "mixed テキスト with 日本語",
    "A".repeat(200),
    "あ".repeat(100),
    "line1\nline2\nline3\nline4\nline5",
    "short\n" + "あ".repeat(50) + "\nend",
  ];

  for (const text of cases) {
    it(`結果のバイト数がmaxBytesを超えない: "${text.slice(0, 30)}..."`, () => {
      const maxBytes = 50;
      const result = truncateForDisplay(text, maxBytes, 9);
      expect(byteLength(result)).toBeLessThanOrEqual(maxBytes);
    });
  }
});

describe("computeTextLayout", () => {
  it("CRLF を正規化する", () => {
    const layout = computeTextLayout("a\r\nb");
    expect(layout.normalized).toBe("a\nb");
  });

  it("chars を正しく分割する", () => {
    const layout = computeTextLayout("aあb");
    expect(layout.chars).toEqual(["a", "あ", "b"]);
  });

  it("offsets が UTF-16 オフセットを持つ", () => {
    const layout = computeTextLayout("aあb");
    // "a"=offset 0, "あ"=offset 1, "b"=offset 2
    expect(layout.offsets).toEqual([0, 1, 2]);
  });

  it("byteOffsets が累積 UTF-8 バイト数を持つ", () => {
    // "a"=1byte, "あ"=3bytes, "b"=1byte
    const layout = computeTextLayout("aあb");
    expect(layout.byteOffsets).toEqual([0, 1, 4, 5]);
  });

  it("改行で rowStarts を記録する", () => {
    const layout = computeTextLayout("ab\ncd\nef");
    expect(layout.rowStarts).toEqual([0, 3, 6]);
  });

  it("ソフトラップで rowStarts を記録する", () => {
    const text = "A".repeat(50) + "B".repeat(10);
    const layout = computeTextLayout(text);
    // 半角50文字で折り返し
    expect(layout.rowStarts).toEqual([0, 50]);
  });

  it("末尾の改行後に文字がなければ rowStart を追加しない", () => {
    const layout = computeTextLayout("ab\n");
    expect(layout.rowStarts).toEqual([0]);
  });

  it("byteOffsets[chars.length] が全体のバイト数と一致する", () => {
    const text = "あいう";
    const layout = computeTextLayout(text);
    expect(layout.byteOffsets[layout.chars.length]).toBe(byteLength(text));
  });

  it("サロゲートペア（絵文字）の offsets が正しい", () => {
    // "😀" は UTF-16 で 2 code units、UTF-8 で 4 bytes
    const layout = computeTextLayout("a😀b");
    expect(layout.chars).toEqual(["a", "😀", "b"]);
    expect(layout.offsets).toEqual([0, 1, 3]);
    expect(layout.byteOffsets).toEqual([0, 1, 5, 6]);
  });
});

describe("findTailByteStart", () => {
  it("全体がmaxBytes以内なら0を返す", () => {
    const { byteOffsets } = computeTextLayout("hello"); // 5バイト
    expect(findTailByteStart(byteOffsets, 100)).toBe(0);
  });

  it("末尾からmaxBytes分の開始インデックスを返す", () => {
    const { byteOffsets } = computeTextLayout("ABCDEFGHIJ"); // 10バイト
    expect(findTailByteStart(byteOffsets, 5)).toBe(5);
  });

  it("日本語テキストでバイト境界を正しく算出する", () => {
    const { byteOffsets } = computeTextLayout("あいうえお"); // 15バイト
    expect(findTailByteStart(byteOffsets, 9)).toBe(2);
  });

  it("maxBytes=0 なら charCount を返す", () => {
    const layout = computeTextLayout("hello");
    expect(findTailByteStart(layout.byteOffsets, 0)).toBe(layout.chars.length);
  });
});

describe("findNextRowStart", () => {
  it("index がちょうど行頭ならそのまま返す", () => {
    const rowStarts = [0, 5, 10];
    expect(findNextRowStart(rowStarts, 5)).toBe(5);
  });

  it("index が行の途中なら次の行頭を返す", () => {
    const rowStarts = [0, 5, 10];
    expect(findNextRowStart(rowStarts, 3)).toBe(5);
  });

  it("index が最後の行の途中なら index をそのまま返す", () => {
    const rowStarts = [0, 5, 10];
    expect(findNextRowStart(rowStarts, 12)).toBe(12);
  });

  it("index=0 なら0を返す", () => {
    const rowStarts = [0, 5];
    expect(findNextRowStart(rowStarts, 0)).toBe(0);
  });
});
