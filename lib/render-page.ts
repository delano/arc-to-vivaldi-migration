import type { BookmarkLeaf, BookmarkNode, SpaceConversion } from "./types.js";

// Renders a single, self-contained HTML "launcher" page that lays out every
// Arc Space and its links in original order — a rough, pretty facsimile of
// Arc's sidebar.
//
// HARD PRIVACY CONSTRAINT: the output makes ZERO third-party requests when
// opened. No favicon services, no web fonts, no CDNs. Site icons are rendered
// as offline monogram tiles (first letter on a hash-derived color). The only
// network activity is the user clicking a link, and those carry rel="noreferrer".

export interface RenderPageOptions {
  readonly generatedAt: string;
  readonly title?: string;
}

// ---------- escaping ----------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// ---------- small derivations ----------

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function monogram(s: string): string {
  const m = s.trim().match(/\p{L}|\p{N}/u);
  return m ? m[0].toUpperCase() : "•";
}

// Stable hue in [0,360) so a given host always gets the same tile color.
function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function countLeaves(node: BookmarkNode): number {
  if (node.kind === "leaf") return 1;
  return node.children.reduce((n, c) => n + countLeaves(c), 0);
}

// ---------- per-node rendering ----------

// Offline site tile: a colored rounded chip bearing the site's monogram.
function tileIcon(seed: string, label: string): string {
  const hue = hashHue(seed || label);
  return `<span class="fav" style="--h:${hue}">${escapeHtml(monogram(label))}</span>`;
}

function leafMarkup(leaf: BookmarkLeaf, cls: string): string {
  const host = hostOf(leaf.url);
  const search = `${leaf.title} ${host}`.toLowerCase();
  return (
    `<a class="${cls}" href="${escapeAttr(leaf.url)}" rel="noreferrer"` +
    ` data-s="${escapeAttr(search)}" title="${escapeAttr(leaf.url)}">` +
    tileIcon(host, leaf.title || host) +
    `<span class="t">${escapeHtml(leaf.title)}</span>` +
    `</a>`
  );
}

function renderNodes(nodes: readonly BookmarkNode[], depth: number): string {
  return nodes
    .map((n) =>
      n.kind === "leaf" ? leafMarkup(n, "link") : renderFolder(n, depth),
    )
    .join("\n");
}

function renderFolder(node: BookmarkNode & { kind: "folder" }, depth: number): string {
  // Top two levels open by default; deeper folders start collapsed to stay tidy.
  const open = depth < 2 ? " open" : "";
  return [
    `<details class="folder"${open}>`,
    `<summary><span class="fname">${escapeHtml(node.title)}</span>` +
      `<span class="pill">${countLeaves(node)}</span></summary>`,
    `<div class="kids">`,
    renderNodes(node.children, depth + 1),
    `</div>`,
    `</details>`,
  ].join("\n");
}

// Pinned section mimics Arc: top-level pinned links become a favicon-tile grid;
// any pinned folders render as collapsible lists beneath it.
function renderPinned(nodes: readonly BookmarkNode[]): string {
  const leaves = nodes.filter((n): n is BookmarkLeaf => n.kind === "leaf");
  const folders = nodes.filter((n) => n.kind === "folder");
  const parts: string[] = [];
  if (leaves.length > 0) {
    parts.push(
      `<div class="grid">`,
      leaves.map((l) => leafMarkup(l, "tile")).join("\n"),
      `</div>`,
    );
  }
  if (folders.length > 0) parts.push(renderNodes(folders, 0));
  return parts.join("\n");
}

// ---------- accent ----------

// Two CSS color stops for a Space, from Arc's theme when present, else a
// deterministic hue derived from the title. Values are safe inside a
// double-quoted style attribute (hex and hsl() contain no double quotes).
function accentStyle(sp: SpaceConversion): string {
  const a = sp.accent ?? [];
  const a1 = a[0];
  const a2 = a[1];
  if (a1 !== undefined && a2 !== undefined) return `--a1:${a1};--a2:${a2}`;
  if (a1 !== undefined) return `--a1:${a1};--a2:${a1}`;
  const h = hashHue(sp.title);
  return `--a1:hsl(${h} 60% 55%);--a2:hsl(${(h + 28) % 360} 58% 45%)`;
}

function spaceBadge(sp: SpaceConversion): string {
  return escapeHtml(sp.emoji && sp.emoji.length > 0 ? sp.emoji : monogram(sp.title));
}

// ---------- document ----------

export function renderPageDocument(
  spaces: readonly SpaceConversion[],
  opts: RenderPageOptions,
): string {
  const docTitle = opts.title ?? "Arc Spaces";
  const totalLinks = spaces.reduce((n, s) => n + s.bookmarkCount, 0);

  const navItems = spaces
    .map((sp, i) => {
      const id = `sp-${i}`;
      return (
        `<button class="space-link" type="button" data-space="${id}"` +
        ` style="${accentStyle(sp)}">` +
        `<span class="badge">${spaceBadge(sp)}</span>` +
        `<span class="nm">${escapeHtml(sp.title)}</span>` +
        `<span class="ct">${sp.bookmarkCount}</span>` +
        `</button>`
      );
    })
    .join("\n");

  const sections = spaces
    .map((sp, i) => {
      const id = `sp-${i}`;
      const hasPinned = sp.pinned.length > 0;
      const hasUnpinned = sp.unpinned.length > 0;
      const sub = `${sp.bookmarkCount} link${sp.bookmarkCount === 1 ? "" : "s"}` +
        (sp.folderCount > 0
          ? ` · ${sp.folderCount} folder${sp.folderCount === 1 ? "" : "s"}`
          : "");

      const groups: string[] = [];
      if (hasPinned) {
        groups.push(
          `<section class="group">` +
            (hasUnpinned ? `<h2>Pinned</h2>` : "") +
            renderPinned(sp.pinned) +
            `</section>`,
        );
      }
      if (hasUnpinned) {
        groups.push(
          `<section class="group">` +
            (hasPinned ? `<h2>Tabs</h2>` : "") +
            renderNodes(sp.unpinned, 0) +
            `</section>`,
        );
      }

      return [
        `<section class="space" id="${id}" style="${accentStyle(sp)}">`,
        `<header class="banner">`,
        `<span class="emoji">${spaceBadge(sp)}</span>`,
        `<div class="meta"><h1>${escapeHtml(sp.title)}</h1><p class="sub">${sub}</p></div>`,
        `</header>`,
        groups.join("\n"),
        `</section>`,
      ].join("\n");
    })
    .join("\n");

  const empty =
    spaces.length === 0
      ? `<p class="emptydoc">No Spaces with bookmarks were found.</p>`
      : "";

  return (
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeAttr(docTitle)}</title>
<style>${STYLE}</style>
</head>
<body>
<aside class="sidebar">
<div class="brand">${escapeHtml(docTitle)}</div>
<input id="q" class="search" type="search" placeholder="Search ${totalLinks} links…" autocomplete="off" spellcheck="false" aria-label="Search links">
<div id="count" class="count" aria-live="polite"></div>
<nav class="spaces">
${navItems}
</nav>
<div class="foot">Generated ${escapeHtml(opts.generatedAt)} · offline, no tracking</div>
</aside>
<main class="content">
${empty}${sections}
</main>
<script>${SCRIPT}</script>
</body>
</html>
`
  );
}

// ---------- static assets (no interpolation; no backticks, no ${ } ) ----------

const STYLE = `
:root{
  --bg:#f6f6f7; --panel:#ffffff; --fg:#1d1d1f; --muted:#6b6b70;
  --border:#e6e6e9; --hover:#f0f0f2; --radius:12px;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#161618; --panel:#1f1f22; --fg:#ececee; --muted:#9a9aa0;
    --border:#2c2c30; --hover:#27272b;
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
.badge{
  flex:0 0 auto; width:24px; height:24px; border-radius:7px;
  display:grid; place-items:center; font-size:13px; color:#fff;
  background:linear-gradient(135deg,var(--a1),var(--a2));
}
.space-link .nm{flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
.space-link .ct{flex:0 0 auto; font-size:11px; color:var(--muted);}
.foot{margin-top:auto; font-size:11px; color:var(--muted); padding:6px;}

.content{overflow-y:auto; padding:24px clamp(16px,4vw,48px);}
.emptydoc{color:var(--muted)}
.space{display:none; max-width:980px; margin:0 auto;}
.space.active{display:block}

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
.grid{display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; margin-bottom:6px;}

a.link,a.tile{display:flex; align-items:center; gap:10px; text-decoration:none; color:var(--fg); border-radius:9px;}
a.link{padding:6px 8px;}
a.link:hover{background:var(--hover)}
a.tile{
  flex-direction:column; align-items:flex-start; gap:8px; padding:11px;
  background:var(--panel); border:1px solid var(--border); min-height:74px;
}
a.tile:hover{border-color:var(--muted)}
a.tile .t{font-size:12.5px; line-height:1.3; max-height:2.6em; overflow:hidden;}
a.link .t{overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}

.fav{
  flex:0 0 auto; width:20px; height:20px; border-radius:6px;
  display:grid; place-items:center; font-size:11px; font-weight:700; color:#fff;
  background:hsl(var(--h) 55% 52%);
}
a.tile .fav{width:30px; height:30px; border-radius:8px; font-size:15px;}

details.folder{margin:2px 0}
details.folder>summary{
  display:flex; align-items:center; gap:8px; cursor:pointer; list-style:none;
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
.fname{font-weight:600}
.pill{font-size:11px; color:var(--muted); background:var(--hover); padding:0 7px; border-radius:9px;}
.kids{padding-left:16px; margin-left:5px; border-left:1px solid var(--border);}

body.searching .space{display:block}
body.searching .space.empty{display:none}
body.searching .group.empty{display:none}
body.searching details.empty{display:none}
body.searching .miss{display:none}
`;

const SCRIPT = `
(function(){
  var body = document.body;
  var q = document.getElementById('q');
  var count = document.getElementById('count');
  var content = document.querySelector('.content');
  var spaces = Array.prototype.slice.call(document.querySelectorAll('.space'));
  var navs = Array.prototype.slice.call(document.querySelectorAll('.space-link'));
  var details = Array.prototype.slice.call(document.querySelectorAll('details'));
  var wasOpen = null;

  function select(id){
    for(var i=0;i<spaces.length;i++) spaces[i].classList.toggle('active', spaces[i].id===id);
    for(var j=0;j<navs.length;j++) navs[j].classList.toggle('active', navs[j].getAttribute('data-space')===id);
    try{ localStorage.setItem('arc-space', id); }catch(e){}
    if(content) content.scrollTop = 0;
  }

  function clearMarks(sel){
    var els = document.querySelectorAll(sel);
    for(var i=0;i<els.length;i++) els[i].classList.remove('empty','miss');
  }

  function exitSearch(){
    if(!body.classList.contains('searching')) return;
    body.classList.remove('searching');
    clearMarks('.miss'); clearMarks('.empty');
    if(wasOpen){ for(var d=0;d<details.length;d++) details[d].open = wasOpen[d]; wasOpen = null; }
  }

  function enterSearch(){
    if(body.classList.contains('searching')) return;
    wasOpen = details.map(function(d){ return d.open; });
    for(var d=0;d<details.length;d++) details[d].open = true;
    body.classList.add('searching');
  }

  for(var i=0;i<navs.length;i++){
    (function(btn){
      btn.addEventListener('click', function(){
        if(q.value){ q.value=''; exitSearch(); count.textContent=''; }
        select(btn.getAttribute('data-space'));
      });
    })(navs[i]);
  }

  q.addEventListener('input', function(){
    var term = q.value.trim().toLowerCase();
    if(!term){ exitSearch(); count.textContent=''; return; }
    enterSearch();
    var total = 0;
    for(var s=0;s<spaces.length;s++){
      var sp = spaces[s];
      var links = sp.querySelectorAll('a.link, a.tile');
      var n = 0;
      for(var l=0;l<links.length;l++){
        var hit = links[l].getAttribute('data-s').indexOf(term) !== -1;
        links[l].classList.toggle('miss', !hit);
        if(hit) n++;
      }
      var dets = sp.querySelectorAll('details');
      for(var dd=0;dd<dets.length;dd++)
        dets[dd].classList.toggle('empty', !dets[dd].querySelector('a.link:not(.miss), a.tile:not(.miss)'));
      var groups = sp.querySelectorAll('.group');
      for(var g=0;g<groups.length;g++)
        groups[g].classList.toggle('empty', !groups[g].querySelector('a.link:not(.miss), a.tile:not(.miss)'));
      sp.classList.toggle('empty', n===0);
      total += n;
    }
    count.textContent = total + (total===1 ? ' result' : ' results');
  });

  q.addEventListener('keydown', function(e){ if(e.key==='Escape'){ q.value=''; exitSearch(); count.textContent=''; } });

  var saved=null; try{ saved=localStorage.getItem('arc-space'); }catch(e){}
  var has=false; for(var z=0;z<spaces.length;z++){ if(spaces[z].id===saved){ has=true; break; } }
  select(has ? saved : (spaces[0] ? spaces[0].id : ''));
})();
`;
