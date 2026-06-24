import type { BookmarkNode, SpaceConversion } from "./types.js";

// Renders a single, self-contained HTML "launcher" page that lays out every
// Arc Space and its links — a rough, pretty facsimile of Arc's sidebar that you
// can also rearrange. The page renders ITSELF from an embedded JSON payload:
// the document ships the Spaces as data (a <script type="application/json">)
// and a small vanilla-JS app builds the DOM and owns all interaction.
//
// Why client-rendered: the page is now editable (drag-reorder, paste/drop to
// add links, expand/collapse memory). Those are mutations, and a file:// page
// can't rewrite itself — so a "working tree" lives in localStorage (namespaced
// by docId) and shadows the embedded export. The embedded JSON is also the
// stable contract a future hosted SPA would consume.
//
// HARD PRIVACY CONSTRAINT (unchanged): the output makes ZERO third-party
// requests when opened. No favicon services, no web fonts, no CDNs. Site icons
// are offline monogram tiles by default; with --favicons they become real
// favicons EMBEDDED as base64 data: URIs (fetched at generation time, never at
// open time), so the zero-request guarantee still holds. The DOM is built with
// createElement/textContent (never innerHTML) and icons are set as CSS
// background-image (never a literal <img>/src= reaching a network URL), so
// bookmark data can't inject markup or smuggle in an external request. Outbound
// links carry rel="noreferrer". The only network activity is a clicked link.

export interface RenderPageOptions {
  readonly generatedAt: string;
  readonly title?: string;
  // Per-host favicons, keyed by hostname (see favicons.hostOf), fetched at
  // GENERATION time and embedded as data: URIs. Absent unless --favicons was
  // passed. buildWirePayload keeps only the hosts that actually appear here.
  readonly icons?: ReadonlyMap<string, string>;
}

// ---------- escaping (server-side, for the tiny static shell only) ----------

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// Embeds a JS object as the text content of a <script type="application/json">
// block. JSON.stringify already neutralizes quotes/backslashes; we additionally
// escape `<`, `>`, `&`, and the JS line separators to `\uXXXX`. The result is
// still valid JSON (the browser keeps the escapes literally in the text node and
// JSON.parse decodes them), but cannot terminate the <script> early ("</script>"
// becomes "</script>") nor be mistaken for markup.
function embedJson(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// ---------- small derivations (server-side, for accent + docId) ----------

// Stable hue in [0,360); mirrors the client copy so accent fallbacks match.
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function monogram(s: string): string {
  const m = s.trim().match(/\p{L}|\p{N}/u);
  return m ? m[0].toUpperCase() : "•";
}

function slugify(s: string): string {
  const stripped = s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return stripped.length > 0 ? stripped : "sparca";
}

// Short base36 fingerprint (FNV-1a). Mixed into docId so two DIFFERENT documents
// that happen to share a title don't collide in the single file:// localStorage
// origin. Derived from the Space titles only, so re-exporting the SAME Spaces
// (reordering/adding links doesn't change titles) keeps the same id — a user's
// edits survive re-exporting from Arc; adding/removing/renaming a Space resets.
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// Two CSS color stops for a Space: Arc's theme when present, else a
// deterministic hue from the title. Resolved here so the client needs no Arc
// color logic.
function resolveAccent(sp: SpaceConversion): readonly [string, string] {
  const a = sp.accent ?? [];
  const a1 = a[0];
  const a2 = a[1];
  if (a1 !== undefined && a2 !== undefined) return [a1, a2];
  if (a1 !== undefined) return [a1, a1];
  const h = hashHue(sp.title);
  return [`hsl(${h} 60% 55%)`, `hsl(${(h + 28) % 360} 58% 45%)`];
}

// ---------- wire payload (the embedded contract) ----------

export type WireNode =
  | { readonly t: "leaf"; readonly title: string; readonly url: string }
  | { readonly t: "folder"; readonly title: string; readonly children: readonly WireNode[] }
  // Split view. `o` is "h" (side by side) or "v" (stacked); kept terse because
  // it ships in every document.
  | { readonly t: "split"; readonly o: "h" | "v"; readonly children: readonly WireNode[] };

export interface WireSpace {
  readonly id: string;
  readonly title: string;
  readonly emoji: string;
  readonly accent: readonly [string, string];
  // Arc's per-profile "top apps" icon grid (above the pinned list).
  readonly favorites: readonly WireNode[];
  readonly pinned: readonly WireNode[];
  readonly unpinned: readonly WireNode[];
}

export interface WirePayload {
  readonly v: 1;
  readonly title: string;
  readonly generatedAt: string;
  // Stable per-document identity (slug of the title), used to namespace the
  // localStorage working tree. NOT content-derived, so a user's edits survive
  // re-exporting from Arc into a freshly generated file of the same title.
  readonly docId: string;
  // host -> base64 data: URI favicon, deduped across every space. Empty `{}`
  // when --favicons was not used; the page then renders monogram tiles.
  readonly icons: Record<string, string>;
  readonly spaces: readonly WireSpace[];
}

function toWireNode(n: BookmarkNode): WireNode {
  if (n.kind === "leaf") return { t: "leaf", title: n.title, url: n.url };
  if (n.kind === "split") {
    return { t: "split", o: n.orientation === "vertical" ? "v" : "h", children: n.children.map(toWireNode) };
  }
  return { t: "folder", title: n.title, children: n.children.map(toWireNode) };
}

// Hostname without a leading "www." — mirrors the client hostOf so embedded
// icons (keyed by host) are looked up by the same key in-page.
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// Every host that appears as a leaf anywhere in a Space, so we embed only the
// icons a given document actually needs (matters for --split's per-file output).
function collectHosts(spaces: readonly SpaceConversion[], into: Set<string>): void {
  const walk = (nodes: readonly BookmarkNode[]): void => {
    for (const n of nodes) {
      if (n.kind === "leaf") {
        const h = hostOf(n.url);
        if (h) into.add(h);
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
}

export function buildWirePayload(
  spaces: readonly SpaceConversion[],
  opts: RenderPageOptions,
): WirePayload {
  const title = opts.title ?? "SpArca";
  const docId = `${slugify(title)}-${shortHash(spaces.map((s) => s.title).join("\n"))}`;
  // Keep only the icons whose host is present in these spaces (deduped).
  const icons: Record<string, string> = {};
  if (opts.icons && opts.icons.size > 0) {
    const hosts = new Set<string>();
    collectHosts(spaces, hosts);
    for (const host of hosts) {
      const uri = opts.icons.get(host);
      if (uri !== undefined) icons[host] = uri;
    }
  }
  return {
    v: 1,
    title,
    generatedAt: opts.generatedAt,
    docId,
    icons,
    spaces: spaces.map((sp, i) => ({
      id: `sp-${i}`,
      title: sp.title,
      emoji: sp.emoji && sp.emoji.length > 0 ? sp.emoji : monogram(sp.title),
      accent: resolveAccent(sp),
      favorites: (sp.favorites ?? []).map(toWireNode),
      pinned: sp.pinned.map(toWireNode),
      unpinned: sp.unpinned.map(toWireNode),
    })),
  };
}

// ---------- URL safety ----------

// Schemes that execute script when an href is clicked. Bookmark data can carry
// these (saved bookmarklets, shared/imported entries), so they must never reach
// a live href on a file:// page. Mirrored verbatim in the client SAFE_HREF.
const UNSAFE_SCHEMES = new Set(["javascript:", "data:", "vbscript:"]);

// Returns the URL when safe to place in an href, else undefined. `new URL`
// normalizes case and strips tab/newline obfuscation, so "JavaScript:" and
// "java\tscript:" are both caught. Exported for unit testing; the client carries
// an equivalent copy (kept in sync, covered by the browser path).
export function safeHref(url: string): string | undefined {
  try {
    return UNSAFE_SCHEMES.has(new URL(url).protocol) ? undefined : url;
  } catch {
    return undefined;
  }
}

// ---------- document ----------

export function renderPageDocument(
  spaces: readonly SpaceConversion[],
  opts: RenderPageOptions,
): string {
  const payload = buildWirePayload(spaces, opts);
  const docTitle = payload.title;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeAttr(docTitle)}</title>
<style>${STYLE}</style>
</head>
<body>
<noscript class="noscript">This SpArca page is interactive and needs JavaScript. Your data is embedded below; nothing is sent anywhere.</noscript>
<aside class="sidebar" id="sidebar" aria-label="Spaces and search"></aside>
<main class="content" id="content" aria-label="Bookmarks"></main>
<script type="application/json" id="arc-data">${embedJson(payload)}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

// ---------- static assets (NO interpolation; no backticks, no ${ } inside) ----------

const STYLE = `
:root{
  --bg:#f6f6f7; --panel:#ffffff; --fg:#1d1d1f; --muted:#6b6b70;
  --border:#e6e6e9; --hover:#f0f0f2; --accent2:#3b6ef0; --radius:12px;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#161618; --panel:#1f1f22; --fg:#ececee; --muted:#9a9aa0;
    --border:#2c2c30; --hover:#27272b; --accent2:#5b86f5;
  }
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0; display:grid; grid-template-columns:264px 1fr; height:100vh;
  background:var(--bg); color:var(--fg);
  font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
}
.noscript{position:fixed; inset:0; padding:24px; background:var(--bg); color:var(--fg); z-index:99;}
.sidebar{
  display:flex; flex-direction:column; gap:10px; padding:14px 12px;
  border-right:1px solid var(--border); background:var(--panel); overflow:hidden;
}
.brand{font-weight:700; font-size:15px; padding:2px 6px;}
.search{
  width:100%; padding:9px 11px; border:1px solid var(--border); border-radius:10px;
  background:var(--bg); color:var(--fg); font-size:13px; outline:none;
}
.search:focus{border-color:var(--muted)}
.count{font-size:12px; color:var(--muted); min-height:14px; padding:0 6px;}
.spaces{display:flex; flex-direction:column; gap:2px; overflow-y:auto; margin:-2px; padding:2px;}
.space-link{
  display:flex; align-items:center; gap:10px; width:100%; text-align:left;
  padding:7px 8px; border:0; border-radius:9px; background:transparent;
  color:var(--fg); font:inherit; cursor:pointer;
}
.space-link:hover{background:var(--hover)}
.space-link.active{background:var(--hover); box-shadow:inset 3px 0 0 -1px var(--a1)}
.space-link .key{flex:0 0 auto; font-size:10px; color:var(--muted); width:16px; text-align:right;}
.badge{
  flex:0 0 auto; width:24px; height:24px; border-radius:7px;
  display:grid; place-items:center; font-size:13px; color:#fff;
  background:linear-gradient(135deg,var(--a1),var(--a2));
}
.space-link .nm{flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.space-link .ct{flex:0 0 auto; font-size:11px; color:var(--muted);}
.foot{margin-top:auto; display:flex; flex-direction:column; gap:8px; padding:6px;}
.actions{display:flex; flex-wrap:wrap; gap:6px;}
.mini{
  font:inherit; font-size:11.5px; padding:4px 9px; border:1px solid var(--border);
  border-radius:8px; background:var(--bg); color:var(--fg); cursor:pointer;
}
.mini:hover{border-color:var(--muted)}
.mini.on{background:var(--accent2); border-color:var(--accent2); color:#fff;}
/* The long/wide toggle is only meaningful while all Spaces are shown. */
.layout-btn{display:none;}
body.allspaces .layout-btn{display:inline-block;}
.legend{font-size:10.5px; color:var(--muted); line-height:1.5;}
.legend-h{text-transform:uppercase; letter-spacing:.06em; font-size:9px; opacity:.7; margin:2px 0 3px;}
.legend-row{display:flex; align-items:baseline; gap:5px; margin:1.5px 0;}
.legend-lbl{opacity:.85}
.legend-sep{opacity:.45}
.legend kbd{font:inherit; font-size:10px; background:var(--hover); border:1px solid var(--border); border-radius:4px; padding:0 4px; color:var(--muted);}

.content{overflow-y:auto; padding:24px clamp(16px,4vw,48px); scroll-behavior:smooth;}
.bar{
  max-width:980px; margin:0 auto 16px; padding:10px 14px; border-radius:12px;
  background:var(--panel); border:1px solid var(--border);
  display:flex; align-items:center; gap:10px; font-size:12.5px;
}
.bar .grow{flex:1}
.bar.warn{border-color:#e0a23a}
.emptydoc{color:var(--muted)}
.space{display:none; max-width:980px; margin:0 auto;}
.space.active{display:block}
body.searching .space{display:block}
body.allspaces .space{display:block; margin-bottom:30px;}
/* Wrapper is transparent in long/single view; becomes a horizontal flex row of
   fixed-width columns in the "wide" all-spaces layout (one row, N columns). */
.spacewrap{display:contents;}
body.allspaces.wide .content{overflow:auto;}
body.allspaces.wide .spacewrap{display:flex; gap:24px; width:max-content; align-items:flex-start; padding-bottom:8px;}
body.allspaces.wide .space{flex:0 0 340px; width:340px; max-width:340px; margin:0;}

.banner{
  display:flex; align-items:center; gap:14px; padding:20px 22px; border-radius:16px;
  color:#fff; margin-bottom:20px;
  background:linear-gradient(135deg,var(--a1),var(--a2));
  position:relative; overflow:hidden;
}
.banner::after{content:""; position:absolute; inset:0; background:linear-gradient(180deg,rgba(0,0,0,.10),rgba(0,0,0,.30)); pointer-events:none;}
.banner>*{position:relative; z-index:1}
.banner .emoji{font-size:30px; line-height:1; filter:drop-shadow(0 1px 2px rgba(0,0,0,.3));}
.banner h1{margin:0; font-size:22px; letter-spacing:-.01em; text-shadow:0 1px 2px rgba(0,0,0,.25);}
.banner .sub{margin:3px 0 0; font-size:12.5px; opacity:.92;}

.group{margin:0 0 22px}
.group>h2{
  font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted);
  margin:0 0 8px 2px; font-weight:700;
}
.grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; margin-bottom:6px; min-height:8px;}
.favgrid{display:grid; grid-template-columns:repeat(auto-fill,minmax(66px,1fr)); gap:8px; margin-bottom:6px; min-height:8px;}
a.favtile{
  position:relative; display:flex; flex-direction:column; align-items:center; gap:6px;
  padding:9px 6px; text-align:center; text-decoration:none; color:var(--fg);
  background:var(--panel); border:1px solid var(--border); border-radius:9px; min-height:64px;
}
a.favtile:hover{border-color:var(--muted)}
a.favtile .fav{width:30px; height:30px; border-radius:8px; font-size:15px;}
a.favtile .t{font-size:10.5px; line-height:1.25; max-height:2.5em; overflow:hidden; color:var(--muted); width:100%; white-space:normal; word-break:break-word;}
a.favtile .rm{top:3px; right:3px; left:auto;}

.split{position:relative; border:1px solid var(--border); border-left:3px solid var(--a1); border-radius:9px; padding:8px 8px 4px; margin:2px 0;}
.split>.split-h{display:flex; align-items:center; gap:6px; font-size:9.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:0 0 6px 2px;}
.split>.panes{display:flex; gap:8px;}
.split.vert>.panes{flex-direction:column;}
.split .pane{flex:1 1 0; min-width:0; border:1px dashed var(--border); border-radius:8px; padding:3px;}
.split>.rm{top:6px; right:6px;}

.rove{outline:2px solid var(--accent2) !important; outline-offset:1px; border-radius:9px;}

.addrow{display:flex; gap:6px; margin:2px 0 10px;}
.add-url{
  flex:1; padding:7px 10px; border:1px dashed var(--border); border-radius:9px;
  background:transparent; color:var(--fg); font:inherit; font-size:12.5px; outline:none;
}
.add-url:focus{border-style:solid; border-color:var(--muted)}
.add-url.bad{border-color:#e0533a}

a.link,a.tile{position:relative; display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--fg); border-radius:9px;}
a.link{padding:6px 8px;}
a.link:hover{background:var(--hover)}
a.unsafe{opacity:.5; cursor:default}
a.tile{
  flex-direction:column; align-items:flex-start; gap:8px; padding:11px;
  background:var(--panel); border:1px solid var(--border); min-height:74px;
}
a.tile:hover{border-color:var(--muted)}
a.tile .t{font-size:12.5px; line-height:1.3; max-height:2.6em; overflow:hidden;}
a.link .t{flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.dial{
  position:absolute; top:6px; right:8px; font-size:10px; color:var(--muted);
  background:var(--hover); border-radius:5px; padding:0 5px; line-height:1.5;
}

.fav{
  flex:0 0 auto; width:20px; height:20px; border-radius:6px;
  display:grid; place-items:center; font-size:11px; font-weight:700; color:#fff;
  background:hsl(var(--h) 55% 52%);
}
a.tile .fav{width:30px; height:30px; border-radius:8px; font-size:15px;}
/* Embedded favicon (data: URI set inline as background-image). #fff backing so
   transparent icons read on dark; the gradient/monogram are replaced. */
.fav.hasicon{background:#fff center/contain no-repeat; color:transparent;}

.rm{
  position:absolute; top:4px; right:4px; width:18px; height:18px; line-height:16px;
  text-align:center; border:0; border-radius:6px; background:var(--hover); color:var(--muted);
  font-size:13px; cursor:pointer; opacity:0; transition:opacity .1s; z-index:2;
}
a.tile .rm{top:6px; right:auto; left:8px;}
details.folder>.rm{top:7px; right:8px;}
a:hover .rm, a:focus-within .rm, details.folder:hover>.rm, details.folder:focus-within>.rm, .rm:focus{opacity:1}
.rm:hover{background:#e0533a; color:#fff}

details.folder{margin:2px 0; position:relative}
details.folder>summary{
  position:relative; display:flex; align-items:center; gap:8px; cursor:pointer; list-style:none;
  padding:6px 8px; border-radius:9px; color:var(--fg);
}
details.folder>summary::-webkit-details-marker{display:none}
details.folder>summary::before{
  content:""; width:0; height:0; border-left:5px solid currentColor;
  border-top:4px solid transparent; border-bottom:4px solid transparent;
  opacity:.55; transition:transform .12s ease; flex:0 0 auto;
}
details.folder[open]>summary::before{transform:rotate(90deg)}
details.folder>summary:hover{background:var(--hover)}
.fname{font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.pill{font-size:11px; color:var(--muted); background:var(--hover); padding:0 7px; border-radius:9px; margin-right:18px;}
.kids{padding-left:16px; margin-left:5px; border-left:1px solid var(--border); min-height:6px;}

[draggable="true"]{cursor:grab}
.dragging{opacity:.4}
.di-before{box-shadow:0 -2px 0 0 var(--accent2)}
.di-after{box-shadow:0 2px 0 0 var(--accent2)}
.dropzone{outline:2px dashed var(--accent2); outline-offset:-2px; border-radius:9px;}

body.searching .space.empty{display:none}
body.searching .group.empty{display:none}
body.searching details.empty{display:none}
body.searching .miss{display:none}

@media (prefers-reduced-motion: reduce){
  *{transition:none !important; scroll-behavior:auto !important}
}
`;

const SCRIPT = `
(function(){
  "use strict";
  var dataEl = document.getElementById('arc-data');
  // Visible fallback so a corrupt file/working tree never leaves a blank page.
  function fatal(msg){
    var c = document.getElementById('content');
    if(c){ c.textContent=''; var p = document.createElement('p'); p.className='emptydoc'; p.style.padding='24px'; p.textContent = msg; c.appendChild(p); }
  }
  var DATA;
  try{
    if(!dataEl) throw new Error('missing data block');
    DATA = JSON.parse(dataEl.textContent);
  }catch(e){
    fatal('This file looks corrupted and could not be read. Re-export it from the generator.');
    return;
  }
  var NS = 'arc:' + DATA.docId;
  var KEY_TREE = NS + ':tree';
  var KEY_ACTIVE = NS + ':active';
  var KEY_LAYOUT = NS + ':layout';

  // ---- storage helpers (file:// localStorage works in Chromium/Vivaldi) ----
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,v); return true; }catch(e){ return false; } }
  function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  var storageFailed = false; // set when a persist() write is rejected (quota/disabled)

  // ---- working tree: the editable copy that shadows the embedded export ----
  // A persisted/imported tree is untrusted: validate Space shape, accent color
  // tokens (they reach style sinks), and recurse EVERY node. A malformed leaf or
  // folder (e.g. {t:'folder'} with no children) would otherwise throw mid-render
  // and, because importJson/afterEdit persist first, brick the page on every
  // reload. Depth-capped so a pathologically deep imported tree can't blow the
  // stack here or in the render/count recursions downstream.
  function validColor(c){ return typeof c==='string' && (/^#[0-9a-f]{3,8}$/i.test(c) || /^(?:hsl|rgb)a?\\([0-9 ,.%\\/]+\\)$/i.test(c)); }
  // Embedded favicons are base64 image data: URIs only. An imported/edited tree
  // is untrusted, so every icon is validated before it reaches a style sink; the
  // base64 alphabet excludes the chars that could break out of a CSS url("...").
  var ICON_RE = /^data:image\\/(?:png|jpe?g|gif|webp|x-icon|vnd\\.microsoft\\.icon|svg\\+xml);base64,[A-Za-z0-9+\\/=]+$/;
  function validIcons(m){
    if(typeof m!=='object' || m===null || Array.isArray(m)) return false;
    for(var k in m){ if(!Object.prototype.hasOwnProperty.call(m,k)) continue; var v=m[k]; if(typeof v!=='string' || v.length>262144 || !ICON_RE.test(v)) return false; }
    return true;
  }
  function validNode(n, depth){
    if(!n || depth>100) return false;
    if(n.t==='leaf') return typeof n.url==='string' && typeof n.title==='string';
    if(n.t==='folder'){
      if(typeof n.title!=='string' || !Array.isArray(n.children)) return false;
      for(var i=0;i<n.children.length;i++){ if(!validNode(n.children[i], depth+1)) return false; }
      return true;
    }
    if(n.t==='split'){
      if(!Array.isArray(n.children)) return false;
      for(var j=0;j<n.children.length;j++){ if(!validNode(n.children[j], depth+1)) return false; }
      return true;
    }
    return false;
  }
  function validTree(t){
    if(!t || !Array.isArray(t.spaces)) return false;
    for(var i=0;i<t.spaces.length;i++){
      var s = t.spaces[i];
      if(!s || typeof s.id!=='string' || !s.id) return false;
      if(!Array.isArray(s.pinned) || !Array.isArray(s.unpinned)) return false;
      if(!Array.isArray(s.accent) || s.accent.length<2 || !validColor(s.accent[0]) || !validColor(s.accent[1])) return false;
      // favorites is optional (older exports predate it); when present it must be valid.
      if(s.favorites!==undefined){
        if(!Array.isArray(s.favorites)) return false;
        for(var f=0;f<s.favorites.length;f++){ if(!validNode(s.favorites[f], 0)) return false; }
      }
      for(var p=0;p<s.pinned.length;p++){ if(!validNode(s.pinned[p], 0)) return false; }
      for(var u=0;u<s.unpinned.length;u++){ if(!validNode(s.unpinned[u], 0)) return false; }
    }
    // icons is optional (older exports / --favicons not used); when present it
    // must be a flat map of host -> base64 image data: URI.
    if(t.icons!==undefined && !validIcons(t.icons)) return false;
    return true;
  }
  // Backfill a favorites array onto any Space that lacks one, so the rest of the
  // app can treat it as always-present (older imports, hand-edited files).
  function normTree(t){ if(!t.icons || typeof t.icons!=='object' || Array.isArray(t.icons)) t.icons={}; for(var i=0;i<t.spaces.length;i++){ if(!Array.isArray(t.spaces[i].favorites)) t.spaces[i].favorites=[]; } return t; }
  var working = loadWorking();
  function loadWorking(){
    var raw = lsGet(KEY_TREE);
    if(raw){ try{ var t = JSON.parse(raw); if(validTree(t)) return normTree(t); }catch(e){} }
    return clone(DATA);
  }
  function persist(){ if(!lsSet(KEY_TREE, JSON.stringify(working))) storageFailed = true; }
  function edited(){ return !!lsGet(KEY_TREE); }

  // ---- url safety: mirrors server safeHref() ----
  var UNSAFE = {'javascript:':1,'data:':1,'vbscript:':1};
  function safeHref(url){
    try{ var p = new URL(url).protocol; return UNSAFE[p] ? null : url; }catch(e){ return null; }
  }
  function coerceUrl(s){
    s = (s||'').trim();
    if(!s) return null;
    if(!/^[a-z][a-z0-9+.\\-]*:/i.test(s)) s = 'https://' + s;
    return safeHref(s);
  }
  function hostOf(url){ try{ return new URL(url).hostname.replace(/^www\\./,''); }catch(e){ return ''; } }
  function titleFromUrl(url){ return hostOf(url) || url; }
  // First non-empty, non-'#'-comment line. Mirrors the uri-list convention so a
  // multi-line drop/paste coerces ONE line rather than the whole blob into a
  // single garbage URL. Shared by the drop, paste, and add-row entry points.
  function firstUrlLine(s){
    var lines = String(s||'').split(/\\r?\\n/);
    for(var i=0;i<lines.length;i++){ var ln=lines[i].trim(); if(ln && ln.charAt(0)!=='#') return ln; }
    return '';
  }

  // ---- icon tiles (offline; no favicon services) ----
  function monogram(s){ var m = (s||'').trim().match(/[\\p{L}\\p{N}]/u); return m ? m[0].toUpperCase() : '\\u2022'; }
  function hashHue(s){ var h=0; for(var i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))>>>0; return h%360; }

  function el(tag, cls, txt){ var e=document.createElement(tag); if(cls) e.className=cls; if(txt!=null) e.textContent=txt; return e; }
  // host doubles as the icon-map key and the hue seed. With --favicons the
  // embedded data: URI (validated by validIcons) is painted as a CSS background;
  // otherwise we fall back to the offline monogram tile.
  function favTile(host, label){
    var s = el('span', 'fav');
    var uri = (host && working.icons) ? working.icons[host] : null;
    if(uri){
      s.className = 'fav hasicon';
      s.style.backgroundImage = 'url("' + uri + '")';
      s.setAttribute('aria-hidden', 'true');
    } else {
      s.textContent = monogram(label);
      s.style.setProperty('--h', hashHue(host || label));
    }
    return s;
  }

  function countLeaves(n){
    if(n.t === 'leaf') return 1;
    var c=0; for(var i=0;i<n.children.length;i++) c+=countLeaves(n.children[i]); return c;
  }
  function spaceCount(sp){
    var c=0, i;
    for(i=0;i<sp.pinned.length;i++) c+=countLeaves(sp.pinned[i]);
    for(i=0;i<sp.unpinned.length;i++) c+=countLeaves(sp.unpinned[i]);
    return c;
  }
  function spaceFolders(sp){
    var c=0;
    function walk(n){
      if(n.t==='folder'){ c++; for(var i=0;i<n.children.length;i++) walk(n.children[i]); }
      else if(n.t==='split'){ for(var j=0;j<n.children.length;j++) walk(n.children[j]); }
    }
    var i; for(i=0;i<sp.pinned.length;i++) walk(sp.pinned[i]);
    for(i=0;i<sp.unpinned.length;i++) walk(sp.unpinned[i]);
    return c;
  }

  // ---- mutation helpers (operate on the working tree by array reference) ----
  function indexOf(arr, node){ for(var i=0;i<arr.length;i++){ if(arr[i]===node) return i; } return -1; }
  function isDescendantArr(folder, arr){
    var stack=[folder];
    while(stack.length){ var n=stack.pop(); if(n.t==='folder'){ if(n.children===arr) return true; for(var i=0;i<n.children.length;i++) stack.push(n.children[i]); } }
    return false;
  }
  function moveNode(node, srcArr, destArr, refNode, after){
    if(node===refNode) return; // dropped onto itself: a no-op, not a move-to-end
    if(node.t==='folder' && (node.children===destArr || isDescendantArr(node, destArr))) return; // no self-nesting
    var i = indexOf(srcArr, node); if(i<0) return; srcArr.splice(i,1);
    var idx;
    if(refNode==null){ idx = destArr.length; }
    else { idx = indexOf(destArr, refNode); if(idx<0) idx = destArr.length; else if(after) idx++; }
    destArr.splice(idx,0,node);
  }
  function insertLeaf(destArr, refNode, after, leaf){
    var idx;
    if(refNode==null){ idx = destArr.length; }
    else { idx = indexOf(destArr, refNode); if(idx<0) idx = destArr.length; else if(after) idx++; }
    destArr.splice(idx,0,leaf);
  }

  // ---- drag state ----
  var drag = null; // {node, arr}
  function clearDI(){ var els=document.querySelectorAll('.di-before,.di-after,.dropzone'); for(var i=0;i<els.length;i++) els[i].classList.remove('di-before','di-after','dropzone'); }
  function dtURL(dt){
    var u=''; try{ u = dt.getData('text/uri-list') || ''; }catch(e){}
    if(!u){ try{ u = dt.getData('text/plain') || ''; }catch(e){} }
    return coerceUrl(firstUrlLine(u));
  }
  function dtHasItem(dt){ var t=dt.types; if(!t) return false; for(var i=0;i<t.length;i++){ var v=t[i]; if(v==='application/x-arc'||v==='text/uri-list'||v==='text/plain') return true; } return false; }

  function makeDraggable(elm, node, arr){
    elm.setAttribute('draggable','true');
    elm.addEventListener('dragstart', function(ev){
      drag = {node:node, arr:arr};
      try{
        ev.dataTransfer.effectAllowed='copyMove';
        ev.dataTransfer.setData('application/x-arc','1');
        if(node.t==='leaf' && node.url){ ev.dataTransfer.setData('text/uri-list', node.url); ev.dataTransfer.setData('text/plain', node.url); }
      }catch(e){}
      elm.classList.add('dragging');
    });
    elm.addEventListener('dragend', function(){ drag=null; clearDI(); elm.classList.remove('dragging'); });
  }
  function makeItemDrop(elm, node, arr){
    elm.addEventListener('dragover', function(ev){
      if(!drag && !dtHasItem(ev.dataTransfer)) return;
      ev.preventDefault(); ev.stopPropagation();
      ev.dataTransfer.dropEffect = drag ? 'move' : 'copy';
      var r = elm.getBoundingClientRect();
      var after = (ev.clientY - r.top) > r.height/2;
      clearDI(); elm.classList.add(after ? 'di-after' : 'di-before');
    });
    elm.addEventListener('dragleave', function(){ elm.classList.remove('di-before','di-after'); });
    elm.addEventListener('drop', function(ev){
      if(!drag && !dtHasItem(ev.dataTransfer)) return;
      ev.preventDefault(); ev.stopPropagation();
      var r = elm.getBoundingClientRect();
      var after = (ev.clientY - r.top) > r.height/2;
      if(drag){ moveNode(drag.node, drag.arr, arr, node, after); }
      else { var u = dtURL(ev.dataTransfer); if(u) insertLeaf(arr, node, after, {t:'leaf', title:titleFromUrl(u), url:u}); }
      afterEdit();
    });
  }
  function makeContainerDrop(elm, arr){
    elm.addEventListener('dragover', function(ev){
      if(!drag && !dtHasItem(ev.dataTransfer)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = drag ? 'move' : 'copy';
      if(ev.target===elm) elm.classList.add('dropzone');
    });
    elm.addEventListener('dragleave', function(ev){ if(ev.target===elm) elm.classList.remove('dropzone'); });
    elm.addEventListener('drop', function(ev){
      if(ev.target!==elm) return; // item-level handlers own precise placement
      if(!drag && !dtHasItem(ev.dataTransfer)) return;
      ev.preventDefault();
      if(drag){ moveNode(drag.node, drag.arr, arr, null, false); }
      else { var u = dtURL(ev.dataTransfer); if(u) arr.push({t:'leaf', title:titleFromUrl(u), url:u}); }
      afterEdit();
    });
  }

  function removeBtn(arr, node){
    var b = el('button','rm','\\u00d7'); b.type='button'; b.title='Remove'; b.setAttribute('aria-label','Remove');
    b.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); var i=indexOf(arr,node); if(i>-1){ arr.splice(i,1); afterEdit(); } });
    b.addEventListener('dragstart', function(ev){ ev.preventDefault(); ev.stopPropagation(); });
    return b;
  }

  // ---- node rendering ----
  function makeLeaf(node, arr, cls, dialNo){
    var host = hostOf(node.url);
    var a = el('a', cls);
    a.setAttribute('data-s', ((node.title||'') + ' ' + host).toLowerCase());
    var href = safeHref(node.url);
    if(href){ a.href = href; a.rel = 'noreferrer noopener'; a.target = '_blank'; a.title = node.url; }
    else { a.classList.add('unsafe'); a.title = 'blocked scheme \\u2014 ' + node.url; }
    if(dialNo){ a.appendChild(el('span','dial', String(dialNo))); }
    a.appendChild(favTile(host, node.title || host));
    a.appendChild(el('span','t', node.title));
    a.appendChild(removeBtn(arr, node));
    makeDraggable(a, node, arr);
    makeItemDrop(a, node, arr);
    return a;
  }
  function makeFolder(node, arr){
    var d = el('details','folder'); if(node._open) d.open = true;
    var sum = el('summary');
    sum.appendChild(el('span','fname', node.title));
    sum.appendChild(el('span','pill', String(countLeaves(node))));
    sum.addEventListener('dblclick', function(ev){ ev.preventDefault(); ev.stopPropagation(); renameNode(node); });
    d.appendChild(sum);
    d.appendChild(removeBtn(arr, node)); // sibling of <summary>, not a child: no interactive nesting
    // Persist real user toggles only. Search force-opens every folder; ignore
    // those programmatic toggles so a search doesn't rewrite remembered state.
    d.addEventListener('toggle', function(){ if(document.body.classList.contains('searching')) return; node._open = d.open; persist(); });
    var kids = el('div','kids');
    renderInto(kids, node.children);
    makeContainerDrop(kids, node.children);
    d.appendChild(kids);
    makeDraggable(sum, node, arr);
    makeItemDrop(sum, node, arr);
    return d;
  }
  function nodeEl(n, arr, leafCls){
    if(n.t==='leaf') return makeLeaf(n, arr, leafCls || 'link');
    if(n.t==='split') return makeSplit(n, arr);
    return makeFolder(n, arr);
  }
  function renderInto(container, nodes){
    for(var i=0;i<nodes.length;i++){ container.appendChild(nodeEl(nodes[i], nodes)); }
  }
  // A split view: its panes shown together (side by side or stacked). The header
  // row is the drag/drop handle so panes keep their own per-item drag behaviour.
  function makeSplit(node, arr){
    var d = el('div','split' + (node.o==='v' ? ' vert' : ''));
    var h = el('div','split-h');
    h.appendChild(el('span',null,'\\u25a3'));
    h.appendChild(el('span',null, node.o==='v' ? 'Split \\u00b7 stacked' : 'Split \\u00b7 side by side'));
    d.appendChild(h);
    var panes = el('div','panes');
    for(var i=0;i<node.children.length;i++){
      var pane = el('div','pane');
      pane.appendChild(nodeEl(node.children[i], node.children));
      panes.appendChild(pane);
    }
    d.appendChild(panes);
    d.appendChild(removeBtn(arr, node));
    makeDraggable(h, node, arr);
    makeItemDrop(h, node, arr);
    return d;
  }
  // Favorites: Arc's per-profile top-app grid. Flat tabs render as compact
  // squares; any (rare) folder/split favorite falls back to a normal row below.
  function renderFavorites(container, nodes){
    var grid = el('div','favgrid'), i;
    for(i=0;i<nodes.length;i++){ if(nodes[i].t==='leaf') grid.appendChild(makeLeaf(nodes[i], nodes, 'favtile')); }
    makeContainerDrop(grid, nodes);
    container.appendChild(grid);
    var hasOther=false; for(i=0;i<nodes.length;i++){ if(nodes[i].t!=='leaf'){ hasOther=true; break; } }
    if(hasOther){
      var wrap=el('div');
      for(i=0;i<nodes.length;i++){ if(nodes[i].t!=='leaf') wrap.appendChild(nodeEl(nodes[i], nodes)); }
      container.appendChild(wrap); makeContainerDrop(wrap, nodes);
    }
  }
  function renderPinned(container, nodes){
    var leaves=[], folders=[], i;
    for(i=0;i<nodes.length;i++){ (nodes[i].t==='leaf' ? leaves : folders).push(nodes[i]); }
    if(leaves.length){
      var grid = el('div','grid');
      for(i=0;i<leaves.length;i++){ grid.appendChild(makeLeaf(leaves[i], nodes, 'tile', i<9 ? i+1 : 0)); }
      makeContainerDrop(grid, nodes);
      container.appendChild(grid);
    }
    if(folders.length){
      // Render pinned folders against the REAL backing array (nodes), not the
      // throwaway 'folders' split: otherwise removeBtn/makeDraggable would close
      // over the temp array, so removing a pinned folder is a no-op and dragging
      // one duplicates it (it leaves the temp array but never sp.pinned).
      var wrap=el('div');
      for(i=0;i<nodes.length;i++){ if(nodes[i].t!=='leaf') wrap.appendChild(makeFolder(nodes[i], nodes)); }
      container.appendChild(wrap); makeContainerDrop(wrap, nodes);
    }
  }

  function renameNode(node){
    var nv = window.prompt('Rename', node.title);
    if(nv==null) return;
    nv = nv.trim(); if(nv){ node.title = nv; afterEdit(); }
  }

  // ---- content build ----
  var content = document.getElementById('content');
  var sidebar = document.getElementById('sidebar');
  var q, count, nav, allBtn, expBtn, impBtn, resetBtn, layoutBtn;
  var activeId = lsGet(KEY_ACTIVE);
  var fullView = false;
  var wide = lsGet(KEY_LAYOUT) === 'wide';

  function activeSpace(){ for(var i=0;i<working.spaces.length;i++){ if(working.spaces[i].id===activeId) return working.spaces[i]; } return working.spaces[0]; }

  function renderContent(){
    content.textContent='';
    if(storageFailed) content.appendChild(buildStorageWarn());
    if(staleNeeded()) content.appendChild(buildStaleBar());
    if(!working.spaces.length){ content.appendChild(el('p','emptydoc','No Spaces with bookmarks were found.')); return; }
    var wrap = el('div','spacewrap');
    for(var s=0;s<working.spaces.length;s++){
      var sp = working.spaces[s];
      var sec = el('section','space'); sec.id = sp.id;
      sec.style.setProperty('--a1', sp.accent[0]); sec.style.setProperty('--a2', sp.accent[1]);

      var banner = el('header','banner');
      banner.appendChild(el('span','emoji', sp.emoji));
      var meta = el('div','meta'); meta.appendChild(el('h1', null, sp.title));
      var nL = spaceCount(sp), nF = spaceFolders(sp);
      var sub = nL + (nL===1?' link':' links') + (nF>0 ? ' \\u00b7 ' + nF + (nF===1?' folder':' folders') : '');
      meta.appendChild(el('p','sub', sub)); banner.appendChild(meta);
      sec.appendChild(banner);

      var fav = sp.favorites||[];
      if(fav.length){ var gf=el('section','group'); gf.appendChild(el('h2',null,'Favorites')); renderFavorites(gf, fav); sec.appendChild(gf); }
      var hasP = sp.pinned.length>0, hasU = sp.unpinned.length>0;
      if(hasP){ var gp=el('section','group'); if(hasU) gp.appendChild(el('h2',null,'Pinned')); renderPinned(gp, sp.pinned); sec.appendChild(gp); }
      var gu = el('section','group'); if(hasP && hasU) gu.appendChild(el('h2',null,'Tabs'));
      gu.appendChild(buildAddRow(sp));
      var list = el('div'); renderInto(list, sp.unpinned); makeContainerDrop(list, sp.unpinned); gu.appendChild(list);
      sec.appendChild(gu);

      wrap.appendChild(sec);
    }
    content.appendChild(wrap);
    applyActive();
  }

  function buildAddRow(sp){
    var row = el('div','addrow');
    var inp = el('input','add-url'); inp.type='text'; inp.name='add-url'; inp.placeholder='Paste a URL, press Enter to add\\u2026'; inp.autocomplete='off'; inp.spellcheck=false; inp.setAttribute('aria-label','Add a link by URL');
    function add(){ var u = coerceUrl(firstUrlLine(inp.value)); if(!u){ inp.classList.add('bad'); return; } sp.unpinned.unshift({t:'leaf', title:titleFromUrl(u), url:u}); inp.value=''; afterEdit({focusAdd:true}); }
    inp.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); add(); } });
    inp.addEventListener('input', function(){ inp.classList.remove('bad'); });
    var b = el('button','mini','Add'); b.type='button'; b.addEventListener('click', add);
    row.appendChild(inp); row.appendChild(b);
    return row;
  }

  // ---- staleness banner: embedded export differs from edited working copy ----
  // Only nag when the embedded export is genuinely NEWER than the edited copy.
  // Plain string-inequality also fires when you re-open an OLDER file after
  // editing, and the banner's 'newer' wording would then be wrong-direction.
  function staleNeeded(){
    if(!edited()) return false;
    var w = working.generatedAt, d = DATA.generatedAt;
    if(w === d) return false;
    var wt = Date.parse(w), dt = Date.parse(d);
    if(!isNaN(wt) && !isNaN(dt)) return dt > wt;
    return w !== d;
  }
  function buildStorageWarn(){
    var bar = el('div','bar warn');
    bar.appendChild(el('span','grow','Your edits are not being saved \\u2014 browser storage is full or disabled. Use Export to keep a copy.'));
    return bar;
  }
  function buildStaleBar(){
    var bar = el('div','bar');
    bar.appendChild(el('span','grow','A newer Arc export is embedded in this file. Your edited copy is from ' + (working.generatedAt||'an earlier export') + '.'));
    var useNew = el('button','mini','Use new export');
    useNew.addEventListener('click', function(){ if(!window.confirm('Replace your edited copy with the newer Arc export? Your edits will be discarded.')) return; working = clone(DATA); persist(); rerender(); });
    var keep = el('button','mini','Keep my edits');
    keep.addEventListener('click', function(){ working.generatedAt = DATA.generatedAt; persist(); rerender(); });
    bar.appendChild(useNew); bar.appendChild(keep);
    return bar;
  }

  // ---- sidebar (built once; nav + counts refreshed on change) ----
  function buildShell(){
    sidebar.textContent='';
    sidebar.appendChild(el('div','brand', DATA.title));
    q = el('input','search'); q.type='search'; q.name='search'; q.id='q'; q.placeholder='Search links\\u2026'; q.autocomplete='off'; q.spellcheck=false; q.setAttribute('aria-label','Search links');
    sidebar.appendChild(q);
    count = el('div','count'); count.setAttribute('aria-live','polite'); sidebar.appendChild(count);
    nav = el('nav','spaces'); sidebar.appendChild(nav);

    var foot = el('div','foot');
    var actions = el('div','actions');
    allBtn = el('button','mini','Show all'); allBtn.addEventListener('click', toggleFull); actions.appendChild(allBtn);
    layoutBtn = el('button','mini layout-btn'); layoutBtn.type='button'; layoutBtn.addEventListener('click', toggleWide); actions.appendChild(layoutBtn);
    expBtn = el('button','mini','Export'); expBtn.addEventListener('click', exportJson); actions.appendChild(expBtn);
    impBtn = el('button','mini','Import'); var file = el('input'); file.type='file'; file.accept='application/json,.json'; file.style.display='none';
    impBtn.addEventListener('click', function(){ file.click(); }); file.addEventListener('change', importJson); actions.appendChild(impBtn); actions.appendChild(file);
    resetBtn = el('button','mini','Reset'); resetBtn.addEventListener('click', resetAll); actions.appendChild(resetBtn);
    foot.appendChild(actions);
    var legend = el('div','legend');
    legend.appendChild(el('div','legend-h','Shortcuts'));
    var cheats = [
      [['/'], 'Search'],
      [['1\\u20139'], 'Open pinned'],
      [['\\u23251\\u20139'], 'Switch Space'],
      [['\\u23250'], 'Show all Spaces'],
      [['\\u2191\\u2193'], 'Move focus'],
      [['\\u2190\\u2192'], 'Prev/next Space'],
      [['Tab'], 'Cycle Spaces / actions'],
      [['Paste','Drop'], 'Add a link']
    ];
    for(var ci=0; ci<cheats.length; ci++){
      var lr = el('div','legend-row'), keys = cheats[ci][0];
      for(var ki=0; ki<keys.length; ki++){ if(ki) lr.appendChild(el('span','legend-sep','/')); lr.appendChild(kbd(keys[ki])); }
      lr.appendChild(el('span','legend-lbl', cheats[ci][1]));
      legend.appendChild(lr);
    }
    foot.appendChild(legend);
    sidebar.appendChild(foot);

    q.addEventListener('input', onSearch);
    q.addEventListener('keydown', function(e){ if(e.key==='Escape'){ q.value=''; exitSearch(); count.textContent=''; } });
  }
  function kbd(t){ return el('kbd', null, t); }

  function renderNav(){
    nav.textContent='';
    for(var i=0;i<working.spaces.length;i++){
      (function(sp, idx){
        var b = el('button','space-link'); b.type='button'; b.setAttribute('data-space', sp.id);
        b.style.setProperty('--a1', sp.accent[0]); b.style.setProperty('--a2', sp.accent[1]);
        b.appendChild(el('span','key', idx<9 ? ('\\u2325'+(idx+1)) : ''));
        b.appendChild(el('span','badge', sp.emoji));
        b.appendChild(el('span','nm', sp.title));
        b.appendChild(el('span','ct', String(spaceCount(sp))));
        b.addEventListener('click', function(){ if(q.value){ q.value=''; exitSearch(); count.textContent=''; } gotoSpace(sp.id); });
        nav.appendChild(b);
      })(working.spaces[i], i);
    }
  }

  // ---- selection / full view ----
  function applyActive(){
    var spaces = content.querySelectorAll('.space');
    var found=false, i;
    for(i=0;i<spaces.length;i++){ var on = spaces[i].id===activeId; spaces[i].classList.toggle('active', on); if(on) found=true; }
    if(!found && spaces.length){ activeId = spaces[0].id; lsSet(KEY_ACTIVE, activeId); spaces[0].classList.add('active'); }
    var navs = nav.querySelectorAll('.space-link');
    for(i=0;i<navs.length;i++) navs[i].classList.toggle('active', navs[i].getAttribute('data-space')===activeId);
  }
  function gotoSpace(id){
    activeId = id; lsSet(KEY_ACTIVE, id); applyActive();
    if(fullView){ var sec=document.getElementById(id); if(sec) sec.scrollIntoView({block:'start'}); }
    else { content.scrollTop = 0; }
  }
  function toggleFull(){ fullView=!fullView; document.body.classList.toggle('allspaces', fullView); allBtn.classList.toggle('on', fullView); allBtn.textContent = fullView ? 'Show one' : 'Show all'; if(fullView){ var sec=document.getElementById(activeId); if(sec) sec.scrollIntoView({block:'start'}); } }
  // Long (stacked, the default) vs wide (each Space a column, one row). Only has
  // a visible effect in the all-Spaces view; the choice persists across reloads.
  function applyLayout(){ document.body.classList.toggle('wide', wide); if(layoutBtn){ layoutBtn.textContent = wide ? 'Long' : 'Wide'; layoutBtn.classList.toggle('on', wide); } }
  function toggleWide(){ wide=!wide; lsSet(KEY_LAYOUT, wide ? 'wide' : 'long'); applyLayout(); var sec=document.getElementById(activeId); if(sec) sec.scrollIntoView({block:'nearest', inline:'start'}); }

  // ---- roving keyboard navigation (\\u2191\\u2193 between links, \\u2190\\u2192 between Spaces) ----
  // Drives both the single-Space and the all-Spaces ("Show all") vertical view.
  var roveEl = null;
  function focusList(){
    var all = content.querySelectorAll('a.favtile, a.tile, a.link, details.folder>summary'), out=[], i;
    // offsetParent===null skips items in a hidden Space or a collapsed folder.
    for(i=0;i<all.length;i++){ if(all[i].classList.contains('miss')) continue; if(all[i].offsetParent===null) continue; out.push(all[i]); }
    return out;
  }
  function setRove(e){
    if(roveEl && roveEl!==e) roveEl.classList.remove('rove');
    roveEl = e; e.classList.add('rove');
    try{ e.focus({preventScroll:true}); }catch(_e){ e.focus(); }
    e.scrollIntoView({block:'nearest'});
  }
  function rove(dir){
    var list = focusList(); if(!list.length) return;
    var idx = list.indexOf(document.activeElement);
    if(idx<0 && roveEl) idx = list.indexOf(roveEl);
    if(idx<0){ setRove(dir>0 ? list[0] : list[list.length-1]); return; }
    var ni = idx + dir; if(ni<0) ni=0; if(ni>=list.length) ni=list.length-1;
    setRove(list[ni]);
  }
  function spaceIndex(id){ for(var i=0;i<working.spaces.length;i++){ if(working.spaces[i].id===id) return i; } return -1; }
  // First focusable that is actually on screen: skip search-hidden links (.miss)
  // and anything in a collapsed folder / hidden Space (offsetParent===null), the
  // same filter focusList() uses. Otherwise Tab / arrow-Space could land focus on
  // a display:none element, moving it invisibly.
  function firstFocusable(sec){
    var all = sec.querySelectorAll('a.favtile, a.tile, a.link, details.folder>summary'), i;
    for(i=0;i<all.length;i++){ if(all[i].classList.contains('miss')) continue; if(all[i].offsetParent===null) continue; return all[i]; }
    return null;
  }
  function closestSpace(e){ while(e && e!==content){ if(e.classList && e.classList.contains('space')) return e; e=e.parentNode; } return null; }
  function visibleSpaces(){ var secs=content.querySelectorAll('.space'), out=[], i; for(i=0;i<secs.length;i++){ if(secs[i].offsetParent!==null) out.push(secs[i]); } return out; }
  function roveSpace(dir){
    if(!fullView){
      // Single view: \\u2190\\u2192 switches the active Space, then focuses its first item.
      var ci = spaceIndex(activeId); if(ci<0) ci=0;
      var ni = ci+dir; if(ni<0 || ni>=working.spaces.length) return;
      gotoSpace(working.spaces[ni].id);
      var sec = document.getElementById(working.spaces[ni].id), f = sec && firstFocusable(sec);
      if(f) setRove(f);
      return;
    }
    var vs = visibleSpaces(); if(!vs.length) return;
    var cur = roveEl ? closestSpace(roveEl) : null;
    var idx = Array.prototype.indexOf.call(vs, cur);
    var n2 = (idx<0 ? 0 : idx+dir); if(n2<0) n2=0; if(n2>=vs.length) n2=vs.length-1;
    var f2 = firstFocusable(vs[n2]); if(f2) setRove(f2); else vs[n2].scrollIntoView({block:'start'});
  }

  // ---- Tab cycle (coarse) ----
  // search -> first link of each VISIBLE Space -> Show all -> [Wide] -> Export
  // -> Import -> Reset -> back to search. Single view shows one Space, so its
  // cycle is search -> that Space -> the action row -> search; all-Spaces tabs
  // Space-to-Space. Distinct from the arrow rove (fine: every link). Tab is
  // intentionally hijacked here, so intra-Space links and per-item remove
  // buttons are reached with the arrows or the mouse, not with Tab.
  function tabStops(){
    var stops=[q], vs=visibleSpaces(), i;
    for(i=0;i<vs.length;i++){ var f=firstFocusable(vs[i]); if(f) stops.push(f); }
    if(allBtn) stops.push(allBtn);
    if(layoutBtn && fullView) stops.push(layoutBtn); // only focusable while shown
    if(expBtn) stops.push(expBtn);
    if(impBtn) stops.push(impBtn);
    if(resetBtn) stops.push(resetBtn);
    return stops;
  }
  function tabStopIndex(stops){
    var a=document.activeElement, i=stops.indexOf(a);
    if(i>=0) return i;
    var sec=closestSpace(a || roveEl); // a roved/middle link maps to its Space's stop
    if(sec){ var j=stops.indexOf(firstFocusable(sec)); if(j>=0) return j; }
    if(roveEl){ var k=stops.indexOf(roveEl); if(k>=0) return k; }
    return -1;
  }
  function focusStop(t){
    if(!t) return;
    if(t.matches && t.matches('a.favtile, a.tile, a.link, details.folder>summary')){ setRove(t); return; }
    if(roveEl){ roveEl.classList.remove('rove'); roveEl=null; }
    try{ t.focus(); }catch(_e){}
  }
  function tabCycle(forward){
    var stops=tabStops(); if(!stops.length) return;
    var idx=tabStopIndex(stops);
    var ni = idx<0 ? (forward?0:stops.length-1) : (idx + (forward?1:-1));
    if(ni<0) ni += stops.length; if(ni>=stops.length) ni -= stops.length;
    focusStop(stops[ni]);
  }

  // ---- search ----
  var details, wasOpen=null;
  function exitSearch(){
    if(!document.body.classList.contains('searching')) return;
    document.body.classList.remove('searching');
    var els=content.querySelectorAll('.miss,.empty'); for(var i=0;i<els.length;i++) els[i].classList.remove('miss','empty');
    if(wasOpen){ for(var d=0; d<details.length; d++) details[d].open = wasOpen[d]; wasOpen=null; }
  }
  function enterSearch(){
    if(document.body.classList.contains('searching')) return;
    details = Array.prototype.slice.call(content.querySelectorAll('details'));
    wasOpen = details.map(function(d){ return d.open; });
    for(var d=0; d<details.length; d++) details[d].open = true;
    document.body.classList.add('searching');
  }
  function onSearch(){
    var term = q.value.trim().toLowerCase();
    if(!term){ exitSearch(); count.textContent=''; return; }
    enterSearch();
    var spaces = content.querySelectorAll('.space'), total=0, s;
    for(s=0;s<spaces.length;s++){
      var sp=spaces[s], links=sp.querySelectorAll('a.link, a.tile, a.favtile'), n=0, l;
      for(l=0;l<links.length;l++){ var hit = links[l].getAttribute('data-s').indexOf(term)!==-1; links[l].classList.toggle('miss', !hit); if(hit) n++; }
      var dets=sp.querySelectorAll('details'), dd;
      for(dd=0;dd<dets.length;dd++) dets[dd].classList.toggle('empty', !dets[dd].querySelector('a.link:not(.miss), a.tile:not(.miss), a.favtile:not(.miss)'));
      var groups=sp.querySelectorAll('.group'), g;
      for(g=0;g<groups.length;g++) groups[g].classList.toggle('empty', !groups[g].querySelector('a.link:not(.miss), a.tile:not(.miss), a.favtile:not(.miss)'));
      sp.classList.toggle('empty', n===0); total+=n;
    }
    count.textContent = total + (total===1 ? ' result' : ' results');
  }

  // ---- export / import / reset ----
  function download(name, text){
    var blob = new Blob([text], {type:'application/json'});
    var url = URL.createObjectURL(blob);
    var a = el('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 0);
  }
  function exportJson(){ download((DATA.docId||'sparca') + '-export.json', JSON.stringify(working, null, 2)); }
  function importJson(ev){
    var f = ev.target.files && ev.target.files[0]; if(!f) return;
    var r = new FileReader();
    r.onload = function(){
      try{
        var t = JSON.parse(String(r.result));
        if(t && t.v !== undefined && t.v !== 1){ window.alert('That export is from an unsupported version.'); return; }
        if(!validTree(t)){ window.alert('Not a valid SpArca export.'); return; }
        if(t.docId && DATA.docId && t.docId !== DATA.docId && !window.confirm('That file was exported from a different document. Import it over this one anyway?')) return;
        if(!t.generatedAt) t.generatedAt = DATA.generatedAt;
        working = normTree(t); persist(); rerender();
      }catch(e){ window.alert('Could not parse that file.'); }
    };
    r.readAsText(f); ev.target.value='';
  }
  function resetAll(){
    if(!window.confirm('Discard your edits and restore the original Arc export?')) return;
    // Restore the export fully: drop the edited tree AND the remembered active
    // Space, so "restore the original" lands on the export's default Space.
    lsDel(KEY_TREE); lsDel(KEY_ACTIVE); activeId = null; working = clone(DATA); rerender();
  }

  function clearSearch(){ if(document.body.classList.contains('searching')){ q.value=''; exitSearch(); count.textContent=''; } }
  function afterEdit(opts){
    if(!working.generatedAt) working.generatedAt = DATA.generatedAt;
    persist(); clearDI();
    rerender();
    // A full rerender rebuilds the add-row <input>; after adding a link, restore
    // focus to the rebuilt field in the active Space so rapid adds keep typing.
    if(opts && opts.focusAdd){ var a = content.querySelector('.space.active .add-url'); if(a) a.focus(); }
  }
  // Every full rebuild drops search state first: the freshly built DOM carries
  // no .miss/.empty marks, so leaving body.searching set would show a broken,
  // half-filtered view. Centralizing here covers edit, import, reset and stale.
  function rerender(){ clearSearch(); roveEl=null; renderNav(); renderContent(); }

  // ---- keyboard ----
  document.addEventListener('keydown', function(e){
    var t = e.target, typing = t && (t.tagName==='INPUT' || t.tagName==='TEXTAREA' || t.isContentEditable);
    // Tab works even from the search field (its whole point is search -> links).
    if(e.key==='Tab' && !e.metaKey && !e.ctrlKey && !e.altKey){ e.preventDefault(); tabCycle(!e.shiftKey); return; }
    if(!typing && e.key==='/' && !e.metaKey && !e.ctrlKey && !e.altKey){ e.preventDefault(); q.focus(); return; }
    if(!typing && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey){
      if(e.key==='ArrowDown'){ e.preventDefault(); rove(1); return; }
      if(e.key==='ArrowUp'){ e.preventDefault(); rove(-1); return; }
      if(e.key==='ArrowRight'){ e.preventDefault(); roveSpace(1); return; }
      if(e.key==='ArrowLeft'){ e.preventDefault(); roveSpace(-1); return; }
    }
    var m = /^Digit([0-9])$/.exec(e.code || '');
    if(!m) return;
    if(e.metaKey || e.ctrlKey) return; // Cmd/Ctrl+number are browser-reserved (tab switching); don't fight them
    if(typing) return; // never steal digits while typing (macOS Option+digit types  ™ £ ¢ etc.)
    var n = parseInt(m[1], 10);
    if(e.altKey){ // switch space; Alt+0 toggles full view
      e.preventDefault();
      if(n===0){ toggleFull(); return; }
      var sp = working.spaces[n-1]; if(sp) gotoSpace(sp.id);
      return;
    }
    if(n===0) return;
    if(document.body.classList.contains('searching')) return; // dial badges index the unfiltered grid; don't open by number while a search filters it
    e.preventDefault();
    var sec = document.getElementById(activeId); if(!sec) return;
    var tiles = sec.querySelectorAll('.grid a.tile:not(.miss)');
    var tile = tiles[n-1]; if(tile && tile.href) tile.click();
  });

  // ---- global paste-to-add (when not typing in a field) ----
  document.addEventListener('paste', function(e){
    var t = e.target; if(t && (t.tagName==='INPUT' || t.tagName==='TEXTAREA' || t.isContentEditable)) return;
    var txt = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    var u = coerceUrl(firstUrlLine(txt)); if(!u) return;
    var sp = activeSpace(); if(!sp) return;
    e.preventDefault();
    sp.unpinned.unshift({t:'leaf', title:titleFromUrl(u), url:u}); afterEdit();
  });
  // swallow stray drops on the document so a dropped URL never navigates the page away
  document.addEventListener('dragover', function(e){ if(drag || dtHasItem(e.dataTransfer)) e.preventDefault(); });
  document.addEventListener('drop', function(e){ if(drag || dtHasItem(e.dataTransfer)) e.preventDefault(); clearDI(); });

  // ---- boot ----
  function boot(){ buildShell(); applyLayout(); rerender(); q.focus(); }
  try{ boot(); }
  catch(e){
    // A corrupt working tree slipped past validation: discard it, fall back to
    // the embedded export, and retry once. If even that fails, show a message
    // rather than leave a blank page.
    try{ lsDel(KEY_TREE); working = clone(DATA); boot(); }
    catch(e2){ fatal('Your saved edits could not be loaded and have been set aside. Reload to start from the embedded export.'); }
  }
})();
`;
