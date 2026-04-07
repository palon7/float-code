import { describe, it, expect } from "vitest";
import { generateUUID } from "./uuid.js";

// RFC 4122 UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
// where y is one of [8, 9, a, b]
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateUUID", () => {
  it("returns a string in UUID v4 format", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(UUID_V4_RE);
  });

  it("sets version nibble to 4", () => {
    const uuid = generateUUID();
    // 15th character (0-indexed position 14) must be '4'
    expect(uuid[14]).toBe("4");
  });

  it("sets variant bits to RFC 4122 (8, 9, a, or b)", () => {
    const uuid = generateUUID();
    // 20th character (0-indexed position 19) must be 8, 9, a, or b
    expect(uuid[19]).toMatch(/[89ab]/);
  });

  it("generates unique values across multiple calls", () => {
    const uuids = new Set(Array.from({ length: 100 }, () => generateUUID()));
    expect(uuids.size).toBe(100);
  });

  it("returns exactly 36 characters (8-4-4-4-12 with hyphens)", () => {
    const uuid = generateUUID();
    expect(uuid).toHaveLength(36);
    expect(uuid[8]).toBe("-");
    expect(uuid[13]).toBe("-");
    expect(uuid[18]).toBe("-");
    expect(uuid[23]).toBe("-");
  });
});
