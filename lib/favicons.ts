// Favicon resolution for the --page / --json output.
//
// Privacy model: favicons are fetched HERE, at generation time, on the machine
// running the CLI — and embedded into the output as base64 `data:` URIs. The
// rendered page therefore still makes ZERO network requests when opened (the
// HARD PRIVACY CONSTRAINT in render-page.ts). The only disclosure is at
// generation time: this module queries a favicon provider with the list of
// bookmarked hostnames. That trade is opt-in (the CLI's --favicons flag).
//
// Provider chain (multi-source, best-effort, per host):
//   1. Google s2 favicons  (durable, no key, sized). Its "globe" placeholder is
//      returned 200 for unknown hosts; we fingerprint it via a sentinel request
//      and treat matches as a miss so the page's offline monogram tile shows.
//   2. DuckDuckGo ip3       (.ico only; fragile, fine for a one-shot export).
//   3. miss -> no entry; the page falls back to its monogram tile.
//
// Everything network-facing is funnelled through an injectable `fetchImpl`, so
// the unit tests exercise the resolution logic fully offline.

import type { BookmarkNode, SpaceConversion } from "./types.js";

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; redirect?: "follow" },
) => Promise<Response>;

export interface FetchFaviconsOptions {
  readonly size?: number;
  readonly concurrency?: number;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly fetchImpl?: FetchLike;
  readonly log?: (msg: string) => void;
  // Per-host progress, fired once after EACH attempted host (post dedupe/empty
  // filter). The library does no throttling — the driver decides how (and
  // whether) to render. `log` stays reserved for one-time notices.
  readonly onProgress?: (p: FaviconProgress) => void;
}

export interface FaviconProgress {
  readonly done: number; // hosts attempted so far (1..total)
  readonly total: number; // queue length, post dedupe/empty-filter
  readonly ok: number; // resolved so far (== out.size)
  readonly host: string; // host just finished
  readonly hit: boolean; // did this host resolve?
}

// Image MIME types we are willing to embed. SVG is allowed: when used as an
// <img>/background-image source the browser renders it in "secure static mode"
// (no script, no external fetches), and the client also re-validates the data
// URI against this same allowlist before it reaches any style sink.
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/svg+xml",
]);

// Hostname without a leading "www.". MUST match the client's hostOf() so the
// per-host icon map the page embeds is keyed the same way the page looks it up.
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Every distinct host that appears as a leaf across all spaces (pinned,
// unpinned, and the favorites grid), recursing through folders and splits.
export function collectHosts(spaces: readonly SpaceConversion[]): string[] {
  const set = new Set<string>();
  const walk = (nodes: readonly BookmarkNode[]): void => {
    for (const n of nodes) {
      if (n.kind === "leaf") {
        const h = hostOf(n.url);
        if (h) set.add(h);
      } else {
        walk(n.children);
      }
    }
  };
  for (const s of spaces) {
    walk(s.pinned);
    walk(s.unpinned);
    if (s.favorites) walk(s.favorites);
  }
  return [...set];
}

interface RawIcon {
  readonly mime: string;
  readonly bytes: Uint8Array;
}

// host -> base64 data: URI, for every host an icon resolved for. Hosts that
// miss are simply absent (the page renders a monogram for them).
export async function fetchFavicons(
  hosts: readonly string[],
  opts: FetchFaviconsOptions = {},
): Promise<Map<string, string>> {
  const size = opts.size ?? 64;
  const concurrency = opts.concurrency ?? 8;
  const timeoutMs = opts.timeoutMs ?? 6000;
  const maxBytes = opts.maxBytes ?? 24 * 1024;
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  const log = opts.log ?? ((): void => {});
  const onProgress = opts.onProgress ?? ((): void => {});
  const out = new Map<string, string>();

  const queue = [...new Set(hosts.filter((h) => h.length > 0))];
  if (queue.length === 0) return out;
  if (!doFetch) {
    log("favicons: no fetch implementation available; skipping");
    return out;
  }

  // Capture the s2 globe placeholder once so per-host hits can be told apart
  // from "Google had nothing and handed back the generic globe".
  const globe = await fetchGlobeSentinel(doFetch, size, timeoutMs, maxBytes);
  if (!globe) log("favicons: globe sentinel unavailable — using DuckDuckGo only");

  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < queue.length) {
      const host = queue[next++]!;
      const uri = await resolveOne(host, doFetch, size, timeoutMs, maxBytes, globe);
      done++;
      const hit = uri !== null;
      if (uri) out.set(host, uri);
      onProgress({ done, total: queue.length, ok: out.size, host, hit });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()),
  );
  return out;
}

async function resolveOne(
  host: string,
  doFetch: FetchLike,
  size: number,
  timeoutMs: number,
  maxBytes: number,
  globe: Uint8Array | null,
): Promise<string | null> {
  // s2 is usable only when we captured the globe placeholder: without it we
  // can't tell a real icon from Google's generic globe, and embedding the globe
  // is worse than falling back to a monogram. So if the sentinel failed (globe
  // === null), skip s2 entirely and rely on DuckDuckGo.
  if (globe) {
    const s2 = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
    const r1 = await tryFetchImage(doFetch, s2, timeoutMs, maxBytes);
    if (r1 && !bytesEqual(r1.bytes, globe)) return toDataUri(r1);
  }

  const ddg = `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`;
  const r2 = await tryFetchImage(doFetch, ddg, timeoutMs, maxBytes);
  if (r2) return toDataUri(r2);

  return null;
}

async function tryFetchImage(
  doFetch: FetchLike,
  url: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<RawIcon | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return null;
    const declared = (res.headers.get("content-type") ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
    const mime = ALLOWED_MIME.has(declared) ? declared : sniffMime(bytes);
    if (!mime) return null;
    return { mime, bytes };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGlobeSentinel(
  doFetch: FetchLike,
  size: number,
  timeoutMs: number,
  maxBytes: number,
): Promise<Uint8Array | null> {
  // A reserved-TLD host Google can never have an icon for -> the globe default.
  const url = `https://www.google.com/s2/favicons?domain=arc-to-vivaldi-sentinel.invalid&sz=${size}`;
  const r = await tryFetchImage(doFetch, url, timeoutMs, maxBytes);
  return r ? r.bytes : null;
}

function toDataUri(icon: RawIcon): string {
  return `data:${icon.mime};base64,${Buffer.from(icon.bytes).toString("base64")}`;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// Best-effort magic-byte sniff, used only when the server omitted or mislabeled
// the content type. Returns "" (a miss) for anything not recognizably an image.
function sniffMime(b: Uint8Array): string {
  const at = (i: number): number => b[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return "image/gif";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x00 && at(1) === 0x00 && at(2) === 0x01 && at(3) === 0x00) return "image/x-icon";
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) return "image/webp";
  return "";
}
