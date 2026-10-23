import { describe, expect, it } from "vitest";

import { containsWakePhrase, normalizePhrase } from "../src/wake/phrase";

describe("wake phrase matching", () => {
  it("normalizes casing, punctuation, and spacing", () => {
    expect(normalizePhrase("  Hey,   BEE! ")).toBe("hey bee");
  });

  it("matches the configured phrase on word boundaries", () => {
    expect(containsWakePhrase("Okay, Hey Bee, what's next?", "Hey Bee")).toBe(true);
    expect(containsWakePhrase("hey bee", "Hey Bee")).toBe(true);
    expect(containsWakePhrase("hey been there", "Hey Bee")).toBe(false);
    expect(containsWakePhrase("hey", "Hey Bee")).toBe(false);
  });

  it("never matches an empty phrase", () => {
    expect(containsWakePhrase("anything", "")).toBe(false);
    expect(containsWakePhrase("anything", "  !!! ")).toBe(false);
  });
});
