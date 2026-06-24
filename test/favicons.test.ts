import { test } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { hostOf, collectHosts, fetchFavicons } from "../lib/favicons.js";
import type { FetchLike } from "../lib/favicons.js";
import type { BookmarkNode, SpaceConversion } from "../lib/types.js";

const leaf = (title: string, url: string): BookmarkNode => ({ kind: "leaf", title, url });

// ---- pure helpers ----

test("hostOf: strips www and tolerates junk", () => {
  strictEqual(hostOf("https://www.example.com/a"), "example.com");
  strictEqual(hostOf("https://sub.example.com/"), "sub.example.com");
  strictEqual(hostOf("not a url"), "");
});

test("collectHosts: dedupes across tiers and recurses folders/splits", () => {
  const spaces: readonly SpaceConversion[] = [
    {
      title: "S",
      iconHint: undefined,
      favorites: [leaf("Fav", "https://www.example.com/fav")],
      pinned: [
        { kind: "folder", title: "F", children: [leaf("Deep", "https://deep.test/x")] },
        { kind: "split", orientation: "horizontal", children: [leaf("L", "https://left.test/")] },
      ],
      unpinned: [leaf("Dup", "https://example.com/again")],
      bookmarkCount: 0,
      folderCount: 0,
    },
  ];
  // example.com appears via www-favorite AND bare-unpinned -> one entry.
  deepStrictEqual(collectHosts(spaces).sort(), ["deep.test", "example.com", "left.test"]);
});

// ---- fetch resolution (mocked, fully offline) ----

const PNG = (tag: number): Uint8Array =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tag, tag, tag]);
const ICO = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x10, 0x10]);
const GLOBE = PNG(0xfe); // Google's placeholder, returned for unknown hosts

function imageResponse(bytes: Uint8Array, type: string): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": type } });
}

// Mock provider: s2 returns a real icon for example.com, the GLOBE for unknown
// hosts (mimicking Google), and DDG serves ddgonly.test only.
const mockFetch: FetchLike = (url) => {
  const u = String(url);
  if (u.includes("s2/favicons")) {
    if (u.includes("domain=example.com")) return Promise.resolve(imageResponse(PNG(0x01), "image/png"));
    if (u.includes("domain=big.test")) return Promise.resolve(imageResponse(PNG(0x02), "image/png"));
    return Promise.resolve(imageResponse(GLOBE, "image/png")); // sentinel + unknowns
  }
  if (u.includes("icons.duckduckgo.com")) {
    if (u.includes("ddgonly.test")) return Promise.resolve(imageResponse(ICO, "image/x-icon"));
    return Promise.resolve(new Response(null, { status: 404 }));
  }
  return Promise.resolve(new Response(null, { status: 404 }));
};

test("fetchFavicons: embeds a resolved icon as a base64 data: URI", async () => {
  const icons = await fetchFavicons(["example.com"], { fetchImpl: mockFetch });
  const expected = "data:image/png;base64," + Buffer.from(PNG(0x01)).toString("base64");
  strictEqual(icons.get("example.com"), expected);
});

test("fetchFavicons: treats Google's globe placeholder as a miss", async () => {
  // unknown.test resolves to the same bytes as the sentinel globe -> dropped,
  // and DDG has nothing either, so the host is absent (page renders a monogram).
  const icons = await fetchFavicons(["unknown.test"], { fetchImpl: mockFetch });
  ok(!icons.has("unknown.test"));
});

test("fetchFavicons: falls back to DuckDuckGo when s2 has only the globe", async () => {
  const icons = await fetchFavicons(["ddgonly.test"], { fetchImpl: mockFetch });
  const expected = "data:image/x-icon;base64," + Buffer.from(ICO).toString("base64");
  strictEqual(icons.get("ddgonly.test"), expected);
});

test("fetchFavicons: skips icons larger than the byte cap", async () => {
  const icons = await fetchFavicons(["big.test"], { fetchImpl: mockFetch, maxBytes: 4 });
  ok(!icons.has("big.test"), "11-byte PNG exceeds the 4-byte cap");
});

test("fetchFavicons: rejects non-image responses", async () => {
  const htmlFetch: FetchLike = () =>
    Promise.resolve(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
  const icons = await fetchFavicons(["example.com"], { fetchImpl: htmlFetch });
  ok(!icons.has("example.com"));
});

test("fetchFavicons: a failed globe sentinel disables s2 (no placeholder leak)", async () => {
  // The sentinel request errors, so `globe` is null. We must NOT trust s2 then
  // (its response could be the globe) — so example.com, which only s2 serves,
  // misses; a DDG-served host still resolves.
  const failSentinel: FetchLike = (url, init) => {
    if (String(url).includes("sentinel.invalid")) return Promise.reject(new Error("network"));
    return mockFetch(url, init);
  };
  const icons = await fetchFavicons(["example.com", "ddgonly.test"], { fetchImpl: failSentinel });
  ok(!icons.has("example.com"), "s2 skipped when the globe is unknown");
  ok(icons.has("ddgonly.test"), "DuckDuckGo fallback still resolves");
});

test("fetchFavicons: resolves a batch and skips empties", async () => {
  const icons = await fetchFavicons(["example.com", "", "ddgonly.test", "unknown.test"], {
    fetchImpl: mockFetch,
    concurrency: 2,
  });
  deepStrictEqual([...icons.keys()].sort(), ["ddgonly.test", "example.com"]);
});
