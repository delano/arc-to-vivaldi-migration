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

## Importing into Vivaldi

`Vivaldi menu → File → Import Bookmarks and Settings…` → choose **Bookmarks
HTML File** and point it at the generated file. Each Space becomes a top-level
folder containing `Pinned` and `Unpinned` subfolders, mirroring Arc's layout.

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
