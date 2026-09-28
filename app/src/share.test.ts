// Tests for the progress import/share plumbing: validation, payload shaping,
// and the #p= share-code codec (compression + raw fallback + garbage input).

import { describe, expect, it, vi } from "vitest";
import type { Progress } from "./progress";
import { parseProgressText, progressPayload, validateProgress } from "./progress";
import { decodeShare, encodeShare } from "./share";

// b64url of an ASCII string — same bytes btoa makes, minus padding, url-alphabet
const b64url = (s: string): string =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const P: Progress = {
  answers: {
    "3.1": { items: { 1: ["taking"] } },
    "9.1": { items: { 2: "some long answer text" } },
  },
  results: {
    "3.1": { correct: 1, total: 5 },
    "9.1": { correct: 3, total: 4 },
  },
  selfMarks: { "9.1": { 1: true } },
};

describe("validateProgress", () => {
  it("accepts a complete object and returns it", () => {
    expect(validateProgress(P)).toEqual(P);
  });

  it("rejects null / non-objects / arrays", () => {
    expect(validateProgress(null)).toBeNull();
    expect(validateProgress(42)).toBeNull();
    expect(validateProgress([P])).toBeNull();
  });

  it("rejects non-numeric results entries", () => {
    const bad: unknown = {
      answers: {},
      results: { "3.1": { correct: "1", total: 5 } },
      selfMarks: {},
    };
    expect(validateProgress(bad)).toBeNull();
  });

  it("requires all three maps", () => {
    const bad: unknown = { answers: {}, results: {} };
    expect(validateProgress(bad)).toBeNull();
  });
});

describe("parseProgressText", () => {
  it("parses serialized progress", () => {
    expect(parseProgressText(JSON.stringify(P))).toEqual(P);
  });

  it("returns null for broken JSON", () => {
    expect(parseProgressText("{oops")).toBeNull();
  });

  it("returns null for incomplete shapes", () => {
    expect(parseProgressText('{"answers":{}}')).toBeNull();
  });
});

describe("progressPayload", () => {
  it("drops answers but keeps results/selfMarks", () => {
    const p = progressPayload(P, false);
    expect(p.answers).toEqual({});
    expect(p.results).toEqual(P.results);
    expect(p.selfMarks).toEqual(P.selfMarks);
  });

  it("passes the object through with answers included", () => {
    expect(progressPayload(P, true)).toBe(P);
  });
});

describe("encodeShare / decodeShare", () => {
  it("round-trips through compression", { skip: typeof CompressionStream === "undefined" }, async () => {
    expect(await decodeShare(await encodeShare(P))).toEqual(P);
  });

  it("falls back to the raw prefix without CompressionStream", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    try {
      const code = await encodeShare(P);
      expect(code.startsWith("0.")).toBe(true);
      expect(await decodeShare(code)).toEqual(P);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects malformed codes", async () => {
    expect(await decodeShare("2.abcd")).toBeNull();
    expect(await decodeShare("1.")).toBeNull();
    expect(await decodeShare(`0.${b64url('{"answers":1}')}`)).toBeNull(); // valid JSON that fails validation
    expect(await decodeShare(`0.${b64url("not json")}`)).toBeNull();
    expect(await decodeShare("garbage")).toBeNull();
  });

  it("compression actually shrinks the payload", { skip: typeof CompressionStream === "undefined" }, async () => {
    vi.stubGlobal("CompressionStream", undefined);
    let raw: string;
    try {
      raw = await encodeShare(P);
    } finally {
      vi.unstubAllGlobals();
    }
    const packed = await encodeShare(P);
    expect(packed.startsWith("1.")).toBe(true);
    expect(packed.length).toBeLessThan(raw.length);
  });
});
