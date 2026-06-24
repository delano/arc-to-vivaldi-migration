import { test } from "node:test";
import { ok, strictEqual, deepStrictEqual } from "node:assert";
import {
  renderPageDocument,
  buildWirePayload,
  safeHref,
} from "../lib/render-page.js";
import type { BookmarkNode, SpaceConversion } from "../lib/types.js";

const leaf = (title: string, url: string): BookmarkNode => ({ kind: "leaf", title, url });
const folder = (title: string, children: readonly BookmarkNode[]): BookmarkNode => ({
  kind: "folder",
  title,
  children,
});

const sample: readonly SpaceConversion[] = [
  {
    title: "Work",
    iconHint: "terminal",
    emoji: "🚀",
    accent: ["#112233", "#445566"],
    pinned: [leaf("Pinned One", "https://pinned.example/a")],
    unpinned: [
      leaf("Top Link", "https://top.example/x"),
      folder("Docs", [leaf("Nested Link", "https://nested.example/y")]),
    ],
    bookmarkCount: 3,
    folderCount: 1,
  },
  {
    title: "Personal",
    iconHint: undefined,
    accent: [],
    pinned: [],
    unpinned: [leaf("Second Space Link", "https://personal.example/z")],
    bookmarkCount: 1,
    folderCount: 0,
  },
];

const opts = { generatedAt: "2026-06-23T00:00:00.000Z" };

// Pull the embedded JSON payload back out of a rendered document, the same way
// the in-page script does (the <script type="application/json"> text node holds
// valid JSON with `<`,`>`,`&` escaped to \uXXXX, which JSON.parse decodes).
function extractPayload(html: string): unknown {
  const m = html.match(
    /<script type="application\/json" id="arc-data">([\s\S]*?)<\/script>/,
  );
  ok(m, "embedded JSON payload present");
  return JSON.parse(m![1]);
}

test("renderPageDocument: is a single self-contained HTML document", () => {
  const html = renderPageDocument(sample, opts);
  ok(html.startsWith("<!DOCTYPE html>"));
  strictEqual(html.match(/<html/g)?.length, 1);
  ok(html.includes("<style>") && html.includes("<script>"));
  // Exactly one bare (executable) <script>; the data block is <script type=...>.
  strictEqual(html.match(/<script>/g)?.length, 1);
});

test("renderPageDocument: makes NO third-party requests (privacy)", () => {
  const html = renderPageDocument(sample, opts);
  ok(!/<img\b/i.test(html), "must not embed <img>");
  ok(!/<iframe\b/i.test(html), "must not embed <iframe>");
  ok(!/\bsrc\s*=\s*["']/i.test(html), "must not reference any HTML src attribute");
  ok(!/<link\b/i.test(html), "must not pull external stylesheets/icons");
  ok(!html.includes("@import"), "must not @import");
  for (const host of ["s2/favicons", "googleapis", "duckduckgo", "gstatic", "cdn."]) {
    ok(!html.includes(host), "must not contact " + host);
  }
});

test("renderPageDocument: the app never uses innerHTML (DOM built safely)", () => {
  const html = renderPageDocument(sample, opts);
  ok(!html.includes("innerHTML"), "client must build DOM via createElement/textContent only");
});

test("renderPageDocument: embeds the spaces as a parseable JSON payload", () => {
  const html = renderPageDocument(sample, opts);
  const payload = extractPayload(html) as {
    v: number;
    title: string;
    docId: string;
    spaces: ReadonlyArray<{ title: string; emoji: string; accent: string[] }>;
  };
  strictEqual(payload.v, 1);
  strictEqual(payload.title, "SpArca");
  // docId = title slug + a content fingerprint, so distinct same-titled docs
  // don't collide in the shared file:// localStorage origin.
  ok(/^sparca-[0-9a-z]+$/.test(payload.docId), "docId is slug + hash");
  deepStrictEqual(
    payload.spaces.map((s) => s.title),
    ["Work", "Personal"],
  );
  strictEqual(payload.spaces[0].emoji, "🚀");
});

test("buildWirePayload: resolves accent stops (Arc theme + deterministic fallback)", () => {
  const p = buildWirePayload(sample, opts);
  deepStrictEqual(p.spaces[0].accent, ["#112233", "#445566"]);
  // Personal has no Arc accent -> hsl() fallback derived from the title hash.
  ok(/^hsl\(\d+ /.test(p.spaces[1].accent[0]), "expected an hsl() accent fallback");
});

test("buildWirePayload: preserves Arc ordering of spaces, links, and folders", () => {
  const p = buildWirePayload(sample, opts);
  deepStrictEqual(p.spaces.map((s) => s.title), ["Work", "Personal"]);
  const work = p.spaces[0];
  strictEqual(work.unpinned[0].t, "leaf");
  strictEqual((work.unpinned[0] as { url: string }).url, "https://top.example/x");
  strictEqual(work.unpinned[1].t, "folder");
});

test("buildWirePayload: folder for a Space falls back to a monogram emoji", () => {
  const p = buildWirePayload(
    [{ ...sample[1], emoji: undefined }],
    { ...opts, title: "Personal" },
  );
  strictEqual(p.spaces[0].emoji, "P");
  ok(p.docId.startsWith("personal-"), "docId derives from the title slug");
});

test("renderPageDocument: escaped JSON cannot break out of the script block", () => {
  const evil: readonly SpaceConversion[] = [
    {
      title: 'X </script><script>alert(1)</script>',
      iconHint: undefined,
      accent: [],
      pinned: [],
      unpinned: [leaf('Bad </script> "&', "https://x.example/")],
      bookmarkCount: 1,
      folderCount: 0,
    },
  ];
  const html = renderPageDocument(evil, opts);
  // The injected </script> must not appear literally inside the data block.
  const block = html.match(
    /<script type="application\/json" id="arc-data">([\s\S]*?)<\/script>/,
  );
  ok(block, "data block still terminates correctly");
  ok(!block![1].includes("</script>"), "no literal </script> inside the JSON");
  ok(!block![1].includes("<script>"), "no literal <script> inside the JSON");
  // Still exactly one executable <script> in the whole document.
  strictEqual(html.match(/<script>/g)?.length, 1);
  // And the data round-trips to the original (malicious) string intact.
  const payload = extractPayload(html) as { spaces: Array<{ title: string }> };
  strictEqual(payload.spaces[0].title, 'X </script><script>alert(1)</script>');
});

test("safeHref: blocks executable schemes, allows real navigation", () => {
  strictEqual(safeHref("javascript:alert(1)"), undefined);
  strictEqual(safeHref("JavaScript:alert(1)"), undefined, "case-insensitive");
  strictEqual(safeHref("java\tscript:alert(1)"), undefined, "obfuscation stripped");
  strictEqual(safeHref("data:text/html,<script>alert(1)</script>"), undefined);
  strictEqual(safeHref("vbscript:msgbox(1)"), undefined);
  strictEqual(safeHref("https://safe.example/"), "https://safe.example/");
  strictEqual(
    safeHref("view-source:https://safe.example/"),
    "view-source:https://safe.example/",
  );
  strictEqual(safeHref("mailto:a@b.example"), "mailto:a@b.example");
  strictEqual(safeHref("not a url"), undefined);
});

test("renderPageDocument: never emits a live javascript:/data: href (in shell or data)", () => {
  const evil: readonly SpaceConversion[] = [
    {
      title: "Bookmarklets",
      iconHint: undefined,
      accent: [],
      pinned: [],
      unpinned: [leaf("Run JS", "javascript:alert(document.domain)")],
      bookmarkCount: 1,
      folderCount: 0,
    },
  ];
  const html = renderPageDocument(evil, opts);
  // Fully client-rendered: there are NO static hrefs at all, and the unsafe URL
  // lives only as inert JSON text (escaped), never as href="javascript:...".
  ok(!/href="javascript:/i.test(html), "must not emit a javascript: href");
  ok(!/href="data:/i.test(html), "must not emit a data: href");
});

test("renderPageDocument: handles an empty space list", () => {
  const html = renderPageDocument([], opts);
  ok(html.startsWith("<!DOCTYPE html>"));
  const payload = extractPayload(html) as { spaces: unknown[] };
  deepStrictEqual(payload.spaces, []);
  // The empty-state copy is shipped in the app so it can render the message.
  ok(html.includes("No Spaces"));
});

test("renderPageDocument: ships interaction the page needs (search, keys, editing)", () => {
  const html = renderPageDocument(sample, opts);
  ok(html.includes("Search links"), "search box");
  ok(html.includes("Show all"), "full-view toggle");
  ok(html.includes("Paste a URL"), "add-link affordance");
  ok(html.includes("application/x-arc"), "internal drag payload type");
  ok(html.includes("localStorage"), "persists working state");
});

// Regression guards for the hardening pass. The client app is a string embedded
// in the document (no DOM in this test runner), so these assert the fixes are
// present by shape; the interactive behaviours are covered by browser checks.
test("renderPageDocument: ships the hardened client (validation, recovery, shared URL parsing)", () => {
  const html = renderPageDocument(sample, opts);
  ok(html.includes("validNode") && html.includes("validColor"),
    "recursive node + accent-token validation of the persisted/imported tree");
  ok(html.includes("firstUrlLine"),
    "shared multi-line URL parsing across drop/paste/add");
  ok(!html.includes("renderInto(wrap, folders)"),
    "pinned folders render against the real backing array, not a throwaway split");
  ok(html.includes("function fatal"),
    "boot has a visible fallback instead of a blank page on corruption");
  ok(html.includes("Shortcuts"), "sidebar ships the shortcuts cheatsheet");
  ok(!html.includes("\\u2625"), "option-key hint is U+2325 (⌥), not the U+2625 ankh");
});
