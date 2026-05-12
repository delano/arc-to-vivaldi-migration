# arc-to-vivaldi-migration

A single-file TypeScript converter that turns Arc Browser's `StorableSidebar.json`
into a Netscape-format HTML bookmarks file, ready to import into Vivaldi (or
any other browser that accepts the standard bookmark HTML format).

Arc shut down its development; this is the escape hatch for everyone whose
sidebar is full of years of carefully curated tabs.

## What it does

- Reads Arc's sidebar JSON and reconstructs the tree (Spaces → Pinned/Unpinned
  → folders → bookmarks).
- Emits a Netscape-format bookmarks HTML file.
- Optionally splits the output: one file per Space, so you can import each
  Space into a different folder or profile.

## Requirements

- Node.js 18 or newer.
- The path to your `StorableSidebar.json`. On Windows the script will find it
  automatically; on macOS pass `--input` explicitly.

Typical locations:

| OS      | Path                                                                                       |
| ------- | ------------------------------------------------------------------------------------------ |
| Windows | `%LOCALAPPDATA%\Packages\TheBrowserCompany.Arc_<hash>\LocalCache\Local\Arc\StorableSidebar.json` |
| macOS   | `~/Library/Application Support/Arc/StorableSidebar.json`                                   |

## Install

```bash
git clone https://github.com/spapaseit/arc-to-vivaldi-migration.git
cd arc-to-vivaldi-migration
npm install
```

## Usage

```bash
# Auto-discover input on Windows, write ./arc-bookmarks.html
npx tsx arc-to-vivaldi.ts

# Explicit paths
npx tsx arc-to-vivaldi.ts --input ./StorableSidebar.json --output ./bookmarks.html

# One HTML file per Space, written into ./out/
npx tsx arc-to-vivaldi.ts --split --output ./out

# Verbose — per-Space counts
npx tsx arc-to-vivaldi.ts -v
```

Flags:

| Flag              | Description                                                              |
| ----------------- | ------------------------------------------------------------------------ |
| `--input <path>`  | Path to `StorableSidebar.json`. Defaults to Windows auto-discovery.       |
| `--output <path>` | Output file (combined mode) or directory (with `--split`).                |
| `--split`         | One file per Space, named `arc-<slug>.html`.                              |
| `-v`, `--verbose` | Print a per-Space breakdown.                                              |
| `-h`, `--help`    | Print usage.                                                              |
| `--probe`              | Emit `probe-vivaldi.js` for Vivaldi private-API discovery. See "Experimental" section below. |
| `--inject`             | Emit `vivaldi-import.js` — a paste-able importer that creates Vivaldi Workspaces from your Arc Spaces. |
| `--inject-dry-run`     | Same as `--inject` but logs intended API calls instead of making them.                    |

## Importing into Vivaldi

`Vivaldi menu → File → Import Bookmarks and Settings…` → choose **Bookmarks
HTML File** and point it at the generated file. Each Space becomes a top-level
folder containing `Pinned` and `Unpinned` subfolders, mirroring Arc's layout.

## Experimental: recreate Arc Spaces as Vivaldi Workspaces

The HTML import only covers bookmarks. If you also want Arc's Spaces to come
across as real Vivaldi Workspaces with pinned and regular open tabs, there is
a two-phase paste-into-DevTools workflow.

> Caveat: Vivaldi's Workspaces are not exposed through the public extension
> API. This path uses the private `vivaldi.*` API surface available only
> inside Vivaldi's own UI context. It can break across Vivaldi versions.
> Your HTML bookmarks are unaffected either way.

**1. Probe Vivaldi's private API.**

```bash
npx tsx arc-to-vivaldi.ts --probe
```

Open Vivaldi → `chrome://inspect/#apps` → click `inspect` next to `window.html`.
In the DevTools console that opens, paste the contents of `probe-vivaldi.js`.
A JSON blob is printed describing the actual API surface — useful if a
future Vivaldi version moves things around and the importer needs adjusting.

**2. Dry-run the importer.**

```bash
npx tsx arc-to-vivaldi.ts --inject-dry-run
```

Paste `vivaldi-import.js` into the same DevTools console. It logs every
Workspace and tab it *would* create, without making any changes.

**3. Run for real.**

```bash
npx tsx arc-to-vivaldi.ts --inject
```

Paste the new `vivaldi-import.js`. The script creates one Workspace per Arc
Space, populates it with your Arc-pinned tabs as pinned tabs and your
Arc-unpinned tabs as regular tabs (flat — folder structure inside the
Unpinned column is dropped, since Vivaldi tabs do not nest).

Mapping summary:

| Arc | Vivaldi |
| --- | --- |
| Space | Workspace |
| Pinned column | Pinned tabs in the Workspace |
| Unpinned column (flattened) | Regular tabs in the Workspace |
| Folder hierarchy inside columns | Lost (still preserved in the HTML import) |

## Notes

- Arc doesn't need to be closed to run this — the file is read-only and Arc
  writes atomically — but for the final import, quit Arc first so any in-memory
  state is flushed to disk.
- HTML entities in titles (`&`, `<`, `>`, `"`) are escaped.
- Tab titles fall back to Arc's `savedTitle` and then to the URL itself if the
  primary `title` field is null (Arc often leaves it null after a session
  restore).
- Items with neither a URL nor any children are dropped silently. Hard parse
  errors (file missing, invalid JSON) exit non-zero; soft issues (dangling
  references, malformed entries) emit a `warn:` line on stderr and continue.

## How it works (briefly)

`sidebar.containers[1].spaces` and `.items` are flat alternating arrays of
`[UUID, object, UUID, object, ...]`. The script pairs them into maps, then for
each Space follows `newContainerIDs` to find the pinned and unpinned root item
IDs, walks each subtree, and renders the result as nested `<DL>`/`<DT>`/`<H3>`
/`<A>` elements per the Netscape format.
