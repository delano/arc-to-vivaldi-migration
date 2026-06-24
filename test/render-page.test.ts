import { test } from "node:test";
import { ok, strictEqual } from "node:assert";
import { renderPageDocument } from "../lib/render-page.js";
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

test("renderPageDocument: is a single self-contained HTML document", () => {
  const html = renderPageDocument(sample, opts);
  ok(html.startsWith("<!DOCTYPE html>"));
  strictEqual(html.match(/<html/g)?.length, 1);
  ok(html.includes("<style>") && html.includes("<script>"));
});

test("renderPageDocument: makes NO third-party requests (privacy)", () => {
  const html = renderPageDocument(sample, opts);
  // No external resource loads of any kind: no images, no <link>, no @import,
  // no font/CDN/favicon hosts. The only URLs allowed are the user's own
  // bookmark hrefs.
  ok(!/<img\b/i.test(html), "must not embed <img>");
  ok(!/\ssrc\s*=/i.test(html), "must not reference any src");
  ok(!/<link\b/i.test(html), "must not pull external stylesheets/icons");
  ok(!html.includes("@import"), "must not @import");
  for (const host of ["s2/favicons", "googleapis", "duckduckgo", "gstatic", "cdn."]) {
    ok(!html.includes(host), "must not contact " + host);
  }
});

test("renderPageDocument: links carry rel=noreferrer and their href", () => {
  const html = renderPageDocument(sample, opts);
  ok(html.includes('href="https://nested.example/y"'));
  ok(html.includes('rel="noreferrer"'));
});

test("renderPageDocument: renders every space title and the emoji badge", () => {
  const html = renderPageDocument(sample, opts);
  ok(html.includes(">Work<"));
  ok(html.includes(">Personal<"));
  ok(html.includes("🚀"));
});

test("renderPageDocument: emits accent CSS custom properties from Arc theme", () => {
  const html = renderPageDocument(sample, opts);
  ok(html.includes("--a1:#112233;--a2:#445566"));
});

test("renderPageDocument: spaces with no accent get a deterministic fallback", () => {
  const html = renderPageDocument(sample, opts);
  // Personal has accent: [] -> hsl() fallback derived from the title hash.
  ok(/--a1:hsl\(\d+ /.test(html), "expected an hsl() accent fallback");
});

test("renderPageDocument: folders are native collapsible <details>", () => {
  const html = renderPageDocument(sample, opts);
  ok(html.includes("<details"));
  ok(html.includes("<summary>"));
  ok(html.includes(">Docs<"));
});

test("renderPageDocument: includes a search box wired to the script", () => {
  const html = renderPageDocument(sample, opts);
  ok(html.includes('id="q"'));
  ok(html.includes("searching"));
});

test("renderPageDocument: preserves Arc ordering of spaces and links", () => {
  const html = renderPageDocument(sample, opts);
  ok(html.indexOf(">Work<") < html.indexOf(">Personal<"), "space order preserved");
  ok(
    html.indexOf("https://top.example/x") < html.indexOf("https://nested.example/y"),
    "link order within a space preserved",
  );
});

test("renderPageDocument: escapes HTML metacharacters in titles", () => {
  const evil: readonly SpaceConversion[] = [
    {
      title: 'X <script>"&',
      iconHint: undefined,
      accent: [],
      pinned: [],
      unpinned: [leaf('Bad <b> & "q"', "https://x.example/")],
      bookmarkCount: 1,
      folderCount: 0,
    },
  ];
  const html = renderPageDocument(evil, opts);
  ok(html.includes("X &lt;script&gt;"), "space title escaped");
  ok(html.includes("Bad &lt;b&gt; &amp;"), "leaf title escaped");
  // The only real <script> tag is our own inline one.
  strictEqual(html.match(/<script>/g)?.length, 1);
});

test("renderPageDocument: handles an empty space list", () => {
  const html = renderPageDocument([], opts);
  ok(html.startsWith("<!DOCTYPE html>"));
  ok(html.includes("No Spaces"));
});
