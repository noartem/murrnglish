// Share-code codec: a Progress <-> "#p=<version>.<base64url>" hash fragment.
// "0." carries raw JSON bytes (the same JSON.stringify that lands in
// localStorage), "1." the same bytes deflate-raw compressed. Pure module —
// no window/document, so it runs and is tested under a plain node env.

import type { Progress } from "./progress";
import { validateProgress } from "./progress";

// "#p=0.<payload>" | "#p=1.<payload>"; payload is unpadded base64url.
export const SHARE_HASH_RE = /^#p=([01])\.([A-Za-z0-9_-]+)$/;

export async function encodeShare(p: Progress): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  if (typeof CompressionStream === "undefined") {
    return `0.${toBase64Url(bytes)}`;
  }
  const compressed = await streamBytes(
    new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw")),
  );
  return `1.${toBase64Url(compressed)}`;
}

export async function decodeShare(code: string): Promise<Progress | null> {
  try {
    const parts = code.split(".");
    if (parts.length !== 2) return null;
    const [version, payload] = parts;
    if ((version !== "0" && version !== "1") || !payload || !/^[A-Za-z0-9_-]+$/.test(payload)) {
      return null;
    }
    let bytes = fromBase64Url(payload);
    if (version === "1") {
      if (typeof DecompressionStream === "undefined") return null;
      bytes = await streamBytes(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
      );
    }
    return validateProgress(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null; // malformed code, bad base64, wrong compression, bad JSON
  }
}

// Pump a web stream into bytes without needing Response/Buffer.
async function streamBytes(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = s.getReader();
  const chunks: Uint8Array[] = [];
  let len = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    len += value.length;
  }
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// Chunked so the spread never hits the argument-count limit; no "=" padding
// (the alphabet check in decodeShare rejects it).
function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
