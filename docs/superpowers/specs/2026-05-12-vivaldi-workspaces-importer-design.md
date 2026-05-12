# Vivaldi Workspaces auto-importer

- **Date:** 2026-05-12
- **Status:** Approved (design)
- **Scope:** Extension to the existing `arc-to-vivaldi.ts` converter.

## Context

The current `arc-to-vivaldi.ts` converts Arc's `StorableSidebar.json` into a
Netscape-format bookmarks HTML file. Vivaldi imports that file as a nested
bookmark folder per Space — which preserves every URL and the full folder
hierarchy, but loses Arc's pinned/unpinned distinction and does not recreate
Arc's Spaces as Vivaldi Workspaces with actual open tabs.

Vivaldi's **public** extension API does not expose Workspace
creation — this is documented on Vivaldi's forum as a deliberate limitation:
extensions cannot add tab-bar UI or hide tabs. Workspaces are surfaced only
through a **private** API (`vivaldi.workspaces`, `vivaldi.tabsPrivate`, etc.)
that is accessible from contexts running inside Vivaldi's own UI — primarily
the internal DevTools console reached via `chrome://inspect/#apps` →
`window.html`.

The realistic path to programmatic Workspace creation is therefore to emit a
self-contained JavaScript payload that the user pastes once into Vivaldi's
internal DevTools console, where the private API is in scope.

## Goal

Extend `arc-to-vivaldi.ts` so that, in addition to the existing HTML output, it
can emit a paste-able JavaScript payload that, when run inside Vivaldi's
internal DevTools console, creates one Workspace per Arc Space and populates
each with the corresponding pinned and unpinned tabs.

## Non-goals

- Replacing or removing any existing HTML output mode. All current behaviour
  must remain bit-identical.
- Editing Vivaldi's profile state files (`Bookmarks`, `Preferences`, `Current
  Session`) directly. SNSS session files are binary and undocumented;
  out of scope for this iteration.
- Importing tabs into Vivaldi Tab Stacks (groups). Unpinned tabs land flat in
  their Workspace; the user reorganises them in-browser.
- Mapping Arc Space icons to Vivaldi Workspace icons. Arc's `iconType.icon`
  uses an SF-Symbol-style vocabulary unlikely to match Vivaldi's icon set;
  deferred to a follow-up if desired.
- Touching the `Bookmarks` JSON file. The HTML import path remains the
  bookmark migration path.

## CLI additions

Three new flags, mutually exclusive with each other but compatible with
`--input` and `--output`:

| Flag | Default output filename | Effect |
| --- | --- | --- |
| `--probe` | `probe-vivaldi.js` | Emits a small diagnostic script for the user to paste into Vivaldi's DevTools. It prints the shape of the relevant private API so the importer template can be calibrated. |
| `--inject` | `vivaldi-import.js` | Emits a self-contained importer script with the converted Arc data embedded as a JSON literal and the import logic next to it. |
| `--inject-dry-run` | `vivaldi-import.js` | Same file shape as `--inject`, but the embedded importer logs every API call it would make and performs none of them. |

`--output` overrides the default filename. Existing flags (`--input`,
`--split`, `-v`/`--verbose`, `-h`/`--help`) are unchanged.

It is a CLI error to combine `--probe` with `--inject` or `--inject-dry-run`,
or to combine `--split` with any of the inject/probe modes (splitting only
applies to HTML output).

## User workflow

1. **Reconnaissance:** run `npx tsx arc-to-vivaldi.ts --probe`. Paste
   `probe-vivaldi.js` into Vivaldi's internal DevTools console (open via
   `chrome://inspect/#apps`, click the entry for `window.html`). Copy the
   resulting JSON output back to the maintainer; use it to confirm or
   correct the API method names the importer assumes.
2. **Dry run:** run `npx tsx arc-to-vivaldi.ts --inject-dry-run`. Paste
   `vivaldi-import.js` into the same DevTools console. The script logs every
   intended Workspace creation and tab creation without performing any
   side-effects. Eyeball for sanity.
3. **Real run:** run `npx tsx arc-to-vivaldi.ts --inject`. Paste the
   resulting file into the DevTools console. The importer creates Workspaces
   and tabs and prints a progress summary.

The HTML modes remain available at any time as a fallback.

## Probe script contents

A single IIFE that:

1. Records `navigator.userAgent` and any Vivaldi-version global it can find.
2. Records `typeof vivaldi`, then `Object.keys(vivaldi)` if it exists.
3. For each of `vivaldi.workspaces`, `vivaldi.tabsPrivate`,
   `vivaldi.bookmarksPrivate`, `vivaldi.sessionsPrivate` (and any other
   plausible candidates), records `Object.keys(...)` plus, for each function
   property, the first 200 characters of `fn.toString()` (which exposes the
   parameter list).
4. Attempts a single, safe, **read-only** call to list existing Workspaces
   (best-guess method names; failures captured, not thrown).
5. Prints a single JSON blob to the DevTools console via
   `console.log(JSON.stringify(payload, null, 2))`.

The probe script must:

- Never throw out of the IIFE; all uncertain calls wrapped in `try`/`catch`,
  errors recorded in the payload as `{ error: string }`.
- Make no write calls of any kind.
- Be small enough to skim (target: under 100 lines, including comments).

## Importer script contents

A single IIFE that, when pasted into Vivaldi's DevTools console:

1. Reads an embedded `const ARC_DATA = { ... }` literal containing the
   converted Arc data (see Data model below).
2. Reads an embedded `const DRY_RUN = true|false;` constant set by the CLI
   flag at generation time.
3. For each Arc Space:
   1. Creates a Vivaldi Workspace named after the Space title (calling the
      method confirmed by the probe).
   2. Sequentially creates one pinned tab per Arc-Pinned leaf, in Arc's
      original order, assigning each tab to the new Workspace.
   3. Sequentially creates one regular tab per Arc-Unpinned leaf, in Arc's
      original order, assigning each tab to the same Workspace. Folder
      nesting in the Unpinned tree is flattened: every leaf becomes a tab,
      every folder is discarded.
4. Awaits each tab-creation promise before issuing the next, to avoid
   issuing hundreds of concurrent calls.
5. Prints progress as it goes:
   `[Personal] workspace created, pinned 162/162, tabs 30/30 — done`.
6. Prints a final summary listing per-Space counts and any failures.

In dry-run mode, no API calls are issued; each step logs the intended call
and its arguments instead.

## Data model embedded in the importer

The CLI builds an in-memory representation already; the importer file embeds
the relevant subset as JSON:

**Implementation note (2026-05-12):** during implementation, `dryRun` was
moved out of the embedded JSON payload and is now emitted as a top-level
`const DRY_RUN = true|false;` constant in the rendered importer JS. It is a
generation-time flag, not data, and embedding it in `ARC_DATA` would have
mixed two different concerns at the same level. The data-model snippet below
reflects what is actually embedded.

```ts
interface InjectablePayload {
  readonly generatedAt: string;          // ISO timestamp
  readonly sourcePath: string;           // input file path (for traceability)
  readonly spaces: readonly InjectableSpace[];
}

interface InjectableSpace {
  readonly title: string;                // Workspace name
  readonly pinned: readonly InjectableTab[];
  readonly unpinned: readonly InjectableTab[];
}

interface InjectableTab {
  readonly url: string;
  readonly title: string;
}
```

The unpinned tree is flattened into `InjectableSpace.unpinned` in
depth-first, Arc-original order. Folder titles are discarded for the inject
path (they remain in the HTML output).

Leaves with no URL are dropped, matching the HTML path. The same warnings
emitted by the HTML path apply to the injector input.

## Error handling and safety

- **Idempotency.** Re-running `--inject` creates **new** Workspaces with the
  same names rather than attempting to merge with existing ones. The user
  decides which to keep. Rationale: merging semantics are ill-defined without
  a stable Workspace identifier from Arc.
- **Per-call failures.** A failing `workspaces.create` aborts that Space and
  records the failure in the summary; other Spaces still run. A failing
  `tabs.create` is logged and skipped; the remaining tabs in that Space
  continue.
- **API mismatch.** If the importer cannot find an expected method
  (e.g. `vivaldi.workspaces.create`), it aborts before any side-effects with a
  clear message naming the missing method and pointing the user back at the
  probe.
- **No silent partial success.** The final summary lists every Space and
  every tab that failed, even when the overall script "succeeded".
- **CLI-side hard failures.** Missing input, JSON parse errors, and
  conflicting flags exit non-zero, matching the existing behaviour.

## Open items requiring probe data

These will be locked down after the user runs the probe and pastes the
output:

1. Exact name of the Workspace-creation method (`vivaldi.workspaces.create`
   vs `vivaldi.workspacesPrivate.create` vs something else entirely).
2. The shape of the create call's argument object (does it want
   `{ name, id, ... }`? An icon enum? A color?).
3. How tabs are assigned to a Workspace at creation time — via
   `chrome.tabs.create({ ..., vivExtData: { workspaceId } })`, via a
   private `tabsPrivate.create`, or via a post-create assignment call.
4. Whether pinning is a `chrome.tabs.update({ pinned: true })` after create,
   or a `pinned: true` in the create payload, or a separate private call.

The importer template ships with reasonable defaults for each, clearly
marked, and is regenerated against probe findings before the real run.

## Out of scope (future possible work)

- Mapping Arc Space icons to Vivaldi Workspace icons.
- Optional Tab Stack grouping of unpinned tabs (e.g. one stack per Arc
  folder title).
- A Vivaldi UI mod variant that auto-imports on Vivaldi startup instead of
  requiring a manual DevTools paste.
- A `--undo` companion that removes the most recently created Workspaces.
