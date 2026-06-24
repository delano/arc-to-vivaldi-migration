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

// ---- Arc two-tier layout: favorites grid + split tabs + arrow-key nav ----

const split = (children: readonly BookmarkNode[]): BookmarkNode => ({
  kind: "split",
  orientation: "horizontal",
  children,
});

const twoTier: readonly SpaceConversion[] = [
  {
    title: "Onetime",
    iconHint: "terminal",
    emoji: "🔐",
    accent: ["#112233", "#445566"],
    favorites: [leaf("Mail", "https://mail.example/"), leaf("Cal", "https://cal.example/")],
    pinned: [
      leaf("Home", "https://home.example/"),
      split([leaf("Left", "https://left.example/"), leaf("Right", "https://right.example/")]),
    ],
    unpinned: [leaf("Tab", "https://tab.example/")],
    bookmarkCount: 4,
    folderCount: 0,
  },
];

test("buildWirePayload: carries the favorites grid as its own tier", () => {
  const p = buildWirePayload(twoTier, opts);
  const sp = p.spaces[0];
  deepStrictEqual(sp.favorites.map((n) => n.t), ["leaf", "leaf"]);
  strictEqual((sp.favorites[0] as { url: string }).url, "https://mail.example/");
  // Favorites are profile-shared and must NOT be folded into pinned/unpinned.
  strictEqual(sp.pinned.length, 2);
});

test("buildWirePayload: a Space with no favorites still emits an empty array", () => {
  const p = buildWirePayload(sample, opts);
  // sample has no `favorites` field; the wire contract normalizes it to [].
  deepStrictEqual(p.spaces[0].favorites, []);
  deepStrictEqual(p.spaces[1].favorites, []);
});

test("buildWirePayload: split view survives as a {t:'split'} node with panes", () => {
  const p = buildWirePayload(twoTier, opts);
  const node = p.spaces[0].pinned[1] as { t: string; o: string; children: { t: string; url?: string }[] };
  strictEqual(node.t, "split");
  strictEqual(node.o, "h", "horizontal orientation encodes as 'h'");
  deepStrictEqual(node.children.map((c) => c.url), [
    "https://left.example/",
    "https://right.example/",
  ]);
});

test("renderPageDocument: ships favorites, split, and arrow-key navigation", () => {
  const html = renderPageDocument(twoTier, opts);
  ok(html.includes("renderFavorites") && html.includes("favgrid"),
    "client builds the per-profile favorites grid");
  ok(html.includes("makeSplit") && html.includes("el('div','panes')"),
    "client renders split views as side-by-side panes");
  ok(html.includes("ArrowDown") && html.includes("ArrowRight") && html.includes("function rove"),
    "client wires roving arrow-key navigation for the all-spaces view");
});

// ARROW SCOPING regression: every arrow (\\u2191\\u2193 and \\u2190\\u2192) navigates WITHIN
// the active Space only; arrows never switch Spaces (that is Tab / \\u23251\\u20139).
// The fix scopes the rove focusable list to the active Space (focusList(scope)),
// routes \\u2190\\u2192 to a horizontal in-Space move (roveHoriz), and removes the old
// per-Space arrow handler (roveSpace) entirely.
test("renderPageDocument: arrows are scoped to the active Space (no Space switching)", () => {
  const html = renderPageDocument(twoTier, opts);
  // The old Space-switching arrow handler and its index helper are gone.
  ok(!html.includes("function roveSpace"),
    "roveSpace (arrow-driven Space switching) is removed");
  ok(!html.includes("function spaceIndex"),
    "spaceIndex (used only by roveSpace) is removed");
  ok(!/ArrowRight'\)\{ e\.preventDefault\(\); roveSpace/.test(html),
    "ArrowRight no longer switches Spaces");
  // \\u2190\\u2192 now move horizontally within the Space; the focusable list is
  // scoped to the active Space so roving never crosses Space boundaries.
  ok(html.includes("function roveHoriz"),
    "client wires a horizontal in-Space move for \\u2190\\u2192");
  ok(html.includes("roveHoriz(1)") && html.includes("roveHoriz(-1)"),
    "ArrowRight/ArrowLeft route to roveHoriz");
  ok(html.includes("function activeRoveSpace") && html.includes("focusList(activeRoveSpace())"),
    "rove scopes its focusable list to the active Space");
});

// AVATAR REMOVAL regression: the main-content Space header no longer emits the
// single-letter monogram/avatar tile. The emoji/monogram is kept in the sidebar
// nav badge and as the favicon fallback, so those constructs must remain.
test("renderPageDocument: main-content space header drops the monogram avatar tile", () => {
  const html = renderPageDocument(twoTier, opts);
  // The banner emoji span must not be appended in renderContent anymore.
  ok(!html.includes("banner.appendChild(el('span','emoji', sp.emoji))"),
    "renderContent no longer emits the main-content avatar tile");
  // The sidebar nav badge and the favicon monogram fallback are untouched.
  ok(html.includes("el('span','badge', sp.emoji)"),
    "sidebar nav badge still carries the Space emoji/monogram");
  ok(html.includes("s.textContent = monogram(label)"),
    "favicon fallback monogram is preserved");
});

// SPLIT BUG regression: a split in the PINNED tier must render as side-by-side
// panes carrying its children's real link titles, NOT a folder with an empty
// title. The fix routes pinned non-leaves through nodeEl (-> makeSplit) instead
// of calling makeFolder directly. twoTier pins exactly such a split (Left/Right).
test("renderPageDocument: a PINNED split routes through nodeEl (side-by-side panes, not an empty-title folder)", () => {
  const html = renderPageDocument(twoTier, opts);
  // The buggy direct makeFolder() call on pinned non-leaves must be gone:
  // renderPinned must hand non-leaves to nodeEl so splits reach makeSplit.
  ok(!/wrap\.appendChild\(makeFolder\(nodes\[i\], nodes\)\)/.test(html),
    "pinned non-leaves no longer go straight to makeFolder (which empties a split's title)");
  ok(html.includes("if(nodes[i].t!=='leaf') wrap.appendChild(nodeEl(nodes[i], nodes));"),
    "renderPinned routes non-leaf pinned nodes through nodeEl");
  // makeSplit builds .panes (side-by-side via flex) and pane wrappers per child;
  // CSS must lay panes out horizontally for o:'h'.
  ok(html.includes("el('div','panes')") && html.includes("el('div','pane')"),
    "makeSplit builds a .panes row with a .pane per child");
  ok(html.includes(".split>.panes{display:flex; flex-wrap:nowrap;"),
    "split panes are laid out side by side (horizontal flex, no wrap)");
  ok(html.includes(".split.vert>.panes{flex-direction:column;"),
    "the stacked (o:'v') variant keeps its column layout");
  // The split's child link titles survive into the embedded payload non-empty,
  // so makeSplit -> makeLeaf renders them as real titles (no empty '.t').
  const payload = extractPayload(html) as {
    spaces: Array<{ pinned: Array<{ t: string; children?: Array<{ title: string }> }> }>;
  };
  const splitNode = payload.spaces[0].pinned.find((n) => n.t === "split");
  ok(splitNode, "the pinned split survives in the payload");
  deepStrictEqual(splitNode!.children!.map((c) => c.title), ["Left", "Right"],
    "the split's child links carry non-empty titles");
});

// ARC FLAT-SPLIT regression: split views drop Arc-foreign chrome \\u2014 no outer
// container box and no "SPLIT \\u00b7 SIDE BY SIDE" label \\u2014 leaving only a faint
// hairline between panes. The container itself becomes the drag/drop handle.
test("renderPageDocument: split views render flat (no box, no label) with a hairline between panes", () => {
  const html = renderPageDocument(twoTier, opts);
  // The "Split \\u00b7 side by side / stacked" label element is gone entirely.
  ok(!html.includes(".split-h"),
    "the .split-h label/header element and its CSS are removed");
  ok(!html.includes("Split \\u00b7 side by side") && !html.includes("Split \\u00b7 stacked"),
    "the 'Split \\u00b7 ...' label text is removed");
  ok(!html.includes("el('div','split-h')"),
    "makeSplit no longer builds a .split-h header");
  // The container box is gone: no border/radius on .split, no dashed pane border.
  ok(!/\.split\{[^}]*border:1px solid var\(--border\)/.test(html),
    ".split no longer has a bordering box");
  ok(!/\.split\{[^}]*border-left:3px solid var\(--a1\)/.test(html),
    ".split no longer has the accent left rail of a box");
  ok(!/\.split \.pane\{[^}]*border:1px dashed var\(--border\)/.test(html),
    ".pane no longer has a dashed border");
  // A faint 1px hairline now separates adjacent side-by-side panes; the stacked
  // variant gets a horizontal separator instead.
  ok(html.includes(".split>.panes>.pane + .pane{border-left:1px solid var(--border)"),
    "side-by-side panes are divided by a faint vertical hairline");
  ok(html.includes(".split.vert>.panes>.pane + .pane{border-left:0; border-top:1px solid var(--border)"),
    "stacked panes are divided by a faint horizontal hairline");
  // The per-split remove button still ships and the container is the drag handle.
  ok(html.includes("d.appendChild(removeBtn(arr, node));"),
    "the per-split remove button is still appended");
  ok(html.includes("makeDraggable(d, node, arr);") && html.includes("makeItemDrop(d, node, arr);"),
    "the flat split container is now the drag/drop handle");
});

// ---- embedded favicons (--favicons), Tab cycle, wide layout ----

const ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

test("buildWirePayload: embeds only icons for hosts present, keyed by host", () => {
  const map = new Map([
    ["mail.example", ICON],
    ["home.example", ICON],
    ["ghost.example", ICON], // not referenced by any leaf -> dropped
  ]);
  const p = buildWirePayload(twoTier, { ...opts, icons: map });
  deepStrictEqual(Object.keys(p.icons).sort(), ["home.example", "mail.example"]);
  strictEqual(p.icons["mail.example"], ICON);
});

test("buildWirePayload: no icons option yields an empty icon map", () => {
  const p = buildWirePayload(twoTier, opts);
  deepStrictEqual(p.icons, {});
});

test("renderPageDocument: embeds favicons inline, still making zero third-party requests", () => {
  const html = renderPageDocument(twoTier, { ...opts, icons: new Map([["home.example", ICON]]) });
  const payload = extractPayload(html) as { icons: Record<string, string> };
  strictEqual(payload.icons["home.example"], ICON, "icon round-trips through the embedded JSON");
  // Icons are inline bytes painted as a CSS background at runtime: no <img>, no
  // src=, and no favicon provider hostname anywhere in the document.
  ok(!/<img\b/i.test(html), "no literal <img>");
  ok(!/\bsrc\s*=\s*["']/i.test(html), "no src= attribute");
  for (const host of ["s2/favicons", "googleapis", "duckduckgo", "gstatic"]) {
    ok(!html.includes(host), "must not contain provider host " + host);
  }
  ok(html.includes("validIcons") && html.includes("ICON_RE"),
    "client re-validates the (untrusted) imported icon map against an allowlist");
  ok(html.includes("hasicon"), "client paints a resolved icon as a background tile");
});

test("renderPageDocument: ships the Tab cycle and the wide all-spaces layout", () => {
  const html = renderPageDocument(twoTier, opts);
  ok(html.includes("function tabCycle") && html.includes("function tabStops"),
    "coarse Tab cycle: search -> each Space's first link -> action row -> search");
  ok(html.includes("'Tab'") || html.includes("key==='Tab'"),
    "Tab is intercepted in the keyboard handler");
  ok(html.includes("function toggleWide") && html.includes("KEY_LAYOUT") && html.includes("spacewrap"),
    "persisted long/wide column layout for the all-spaces view");
});

// URL HOTKEY: a bare 'u' toggles a per-link URL sub-line (smaller + muted, with
// the hostname emphasized). It's a body-class toggle (no rerender), persisted as
// a view pref in localStorage (KEY_URLS), and resetAll must leave it untouched.
// The .url sub-line is always built into the DOM and shown/hidden by CSS.
test("renderPageDocument: ships the 'u' URL-sub-line toggle (handler, persistence, CSS, builder)", () => {
  const html = renderPageDocument(twoTier, opts);
  // Hotkey handler lives in the keyboard listener, toggles state, persists, and
  // applies via the body class (not a rerender).
  ok(html.includes("e.key==='u'") && html.includes("applyUrls()"),
    "'u' toggles the URL sub-line via applyUrls()");
  ok(html.includes("KEY_URLS") && html.includes("lsSet(KEY_URLS"),
    "the URL-sub-line preference persists to localStorage (KEY_URLS)");
  ok(html.includes("classList.toggle('showurls', showUrls)"),
    "applyUrls toggles a body class (no rerender, sub-line is CSS-hidden)");
  // resetAll only clears the working tree + active Space; view prefs (KEY_URLS)
  // must survive a reset, like KEY_LAYOUT.
  ok(!/lsDel\(KEY_URLS\)/.test(html),
    "resetAll leaves the URL-sub-line view pref untouched");
  // CSS hooks: hidden by default, revealed under body.showurls, hostname in --fg.
  ok(html.includes(".url{display:none;") && html.includes("body.showurls .url{display:block;}"),
    "URL sub-line is hidden by default and shown under body.showurls");
  ok(html.includes(".url-h{color:var(--fg)"),
    "the hostname segment is emphasized (rendered in --fg)");
  // The builder emits a .url node with an emphasized .url-h hostname segment,
  // built via el/textContent (no innerHTML), and only for link/tile (not favtile).
  ok(html.includes("el('span','url')") && html.includes("el('span','url-h', host)"),
    "makeLeaf builds a .url sub-line with an emphasized .url-h hostname");
  ok(html.includes("cls!=='favtile' && href"),
    "the URL sub-line is attached for links/tiles only (skips favtiles)");
  // Cheatsheet advertises the hotkey.
  ok(html.includes("'Show URLs'"), "the shortcuts cheatsheet lists the URL toggle");
});

// THEME MODES: a bare 't' cycles dark -> sepia -> system (default 'system',
// which follows prefers-color-scheme). It's a body[data-theme] attribute swap
// (no rerender), persisted as a view pref in localStorage (KEY_THEME), and
// resetAll must leave it untouched. The palettes reuse the existing :root CSS
// variables via theme overrides; the dark media query is gated to 'system'.
test("renderPageDocument: ships the 't' theme cycle (palettes, data-theme hooks, persistence, matchMedia)", () => {
  const html = renderPageDocument(twoTier, opts);
  // Palette overrides keyed off body[data-theme] reuse the :root variables.
  ok(html.includes('body[data-theme="dark"]{') && html.includes('body[data-theme="sepia"]{'),
    "explicit dark + sepia palettes override the :root variables via data-theme");
  // The dark media query is gated to 'system' so explicit modes win over the OS,
  // and 'system' still follows prefers-color-scheme.
  ok(html.includes('@media (prefers-color-scheme: dark){') &&
     html.includes('body[data-theme="system"]{'),
    "system mode follows prefers-color-scheme via a gated dark media query");
  // Hotkey handler cycles the mode, persists, and applies via the attribute.
  ok(html.includes("e.key==='t'") && html.includes("applyTheme()"),
    "'t' cycles the theme via applyTheme()");
  ok(html.includes("var THEMES = ['dark','sepia','system']"),
    "the cycle order is dark -> sepia -> system");
  ok(html.includes("lsGet(KEY_THEME) || 'system'"),
    "theme defaults to 'system' and loads the persisted preference");
  ok(html.includes("KEY_THEME") && html.includes("lsSet(KEY_THEME"),
    "the theme preference persists to localStorage (KEY_THEME)");
  ok(html.includes("setAttribute('data-theme', theme)"),
    "applyTheme sets a body data-theme attribute (no rerender, CSS repaints)");
  // resetAll only clears the working tree + active Space; view prefs (KEY_THEME)
  // must survive a reset, like KEY_LAYOUT / KEY_URLS.
  ok(!/lsDel\(KEY_THEME\)/.test(html),
    "resetAll leaves the theme view pref untouched");
  // System mode reacts live to OS scheme flips via a matchMedia listener.
  ok(html.includes("matchMedia('(prefers-color-scheme: dark)')") &&
     html.includes("if(theme==='system') applyTheme()"),
    "client reacts live to OS scheme changes while in system mode");
  // applyTheme runs on boot so the initial paint matches the saved mode.
  ok(html.includes("applyTheme(); rerender()"),
    "boot applies the theme before the first render");
  // Cheatsheet advertises the hotkey.
  ok(html.includes("'Theme'"), "the shortcuts cheatsheet lists the theme toggle");
});

// SEARCH-ACTIVE visual hierarchy: while a live query is running the document
// carries body.searching, and the CSS under it foregrounds the matches while
// muting (but not hiding) the surviving structural scaffolding. Non-search
// browsing must be unaffected, so every hook below is scoped to body.searching.
test("renderPageDocument: search-active state foregrounds matches and de-emphasizes scaffolding", () => {
  const html = renderPageDocument(twoTier, opts);
  // The body-level state class is set when the query is non-empty and cleared
  // when it empties / search exits.
  ok(html.includes("document.body.classList.add('searching')"),
    "entering search sets the body.searching state class");
  ok(html.includes("document.body.classList.remove('searching')"),
    "exiting search clears the body.searching state class");
  // Matches (surviving, non-.miss links) are lifted above the scaffolding.
  ok(html.includes("body.searching a.link:not(.miss)"),
    "search-active CSS foregrounds matching links");
  // Scaffolding is muted but kept visible (no display:none on these hooks).
  ok(html.includes("body.searching .fname{font-weight:400; color:var(--muted);}"),
    "search-active CSS de-emphasizes folder names without hiding them");
  ok(html.includes("body.searching .group>h2{opacity:.5;}"),
    "search-active CSS mutes group headers");
  ok(html.includes("body.searching .banner{"),
    "search-active CSS flattens the space banner");
  ok(html.includes("body.searching .badge{background:var(--hover); color:var(--muted); box-shadow:none;}"),
    "search-active CSS drops the heavy badge fill");
  ok(html.includes("body.searching .pill,") || html.includes("body.searching .pill{") ||
     html.includes("body.searching .pill\n"),
    "search-active CSS mutes folder count pills");
  // The de-emphasis must not hide the scaffolding it targets.
  ok(!/body\.searching \.fname\{[^}]*display:\s*none/.test(html),
    "muted scaffolding stays visible for context");
});
