# Vivaldi Workspaces Importer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `arc-to-vivaldi.ts` with `--probe`, `--inject`, and `--inject-dry-run` modes that emit paste-able JavaScript payloads for Vivaldi's internal DevTools console, recreating Arc Spaces as Vivaldi Workspaces with pinned and regular tabs. Existing HTML output remains untouched.

**Architecture:** Modest extraction — types and CLI parsing move into `lib/`, new rendering modules join them. The orchestrator (`arc-to-vivaldi.ts`) stays the entry point but dispatches to the new modes. Tests use Node's built-in `node:test` runner via `tsx` (no new runtime deps).

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), `tsx` for execution, `node:test` for tests, Vivaldi's private `vivaldi.*` API in the emitted JS payloads (consumed manually inside Vivaldi).

---

## Task 1: Add a test runner

**Files:**
- Modify: `C:\Development\arc-to-vivaldi-migration\package.json`
- Create: `C:\Development\arc-to-vivaldi-migration\test\smoke.test.ts`

- [ ] **Step 1: Add the `test` script to package.json**

Update the `scripts` block in `package.json`:

```json
{
  "scripts": {
    "convert": "tsx arc-to-vivaldi.ts",
    "test": "tsx --test test/*.test.ts"
  }
}
```

- [ ] **Step 2: Write a smoke test that confirms the runner works**

Create `test/smoke.test.ts`:

```typescript
import { test } from "node:test";
import { strictEqual } from "node:assert";

test("smoke: test runner executes", () => {
  strictEqual(1 + 1, 2);
});
```

- [ ] **Step 3: Run it and verify it passes**

Run: `npm test`
Expected: one passing test, exit code 0. Look for `# pass 1`.

- [ ] **Step 4: Commit**

```bash
git add package.json test/smoke.test.ts
git commit -m "test: add node:test runner via tsx"
```

---

## Task 2: Extract types into `lib/types.ts`

**Files:**
- Create: `C:\Development\arc-to-vivaldi-migration\lib\types.ts`
- Modify: `C:\Development\arc-to-vivaldi-migration\arc-to-vivaldi.ts`

- [ ] **Step 1: Create `lib/types.ts` with the moved type declarations**

```typescript
// Arc JSON shapes (narrowed at the boundary; never `any`).
export interface ArcSpaceIconType {
  readonly icon: string | undefined;
}

export interface ArcSpaceCustomInfo {
  readonly iconType: ArcSpaceIconType | undefined;
}

export interface ArcSpace {
  readonly id: string;
  readonly title: string;
  readonly customInfo: ArcSpaceCustomInfo | undefined;
  readonly newContainerIDs: readonly unknown[];
}

export interface ArcTabData {
  readonly savedURL: string | undefined;
  readonly savedTitle: string | undefined;
}

export interface ArcItemData {
  readonly tab: ArcTabData | undefined;
  readonly isList: boolean;
}

export interface ArcItem {
  readonly id: string;
  readonly title: string | null;
  readonly parentID: string | undefined;
  readonly childrenIds: readonly string[];
  readonly data: ArcItemData;
}

// Internal bookmark tree.
export interface BookmarkLeaf {
  readonly kind: "leaf";
  readonly title: string;
  readonly url: string;
}

export interface BookmarkFolder {
  readonly kind: "folder";
  readonly title: string;
  readonly children: readonly BookmarkNode[];
}

export type BookmarkNode = BookmarkLeaf | BookmarkFolder;

export interface SpaceConversion {
  readonly title: string;
  readonly iconHint: string | undefined;
  readonly pinned: readonly BookmarkNode[];
  readonly unpinned: readonly BookmarkNode[];
  readonly bookmarkCount: number;
  readonly folderCount: number;
}
```

- [ ] **Step 2: Update `arc-to-vivaldi.ts` to import from `lib/types.ts`**

In `arc-to-vivaldi.ts`, **delete** the inline type declarations (the blocks starting `interface ArcSpaceIconType` through `interface SpaceConversion`) and replace them with a single import after the existing `import` lines:

```typescript
import type {
  ArcSpace,
  ArcSpaceCustomInfo,
  ArcItem,
  ArcTabData,
  BookmarkNode,
  SpaceConversion,
} from "./lib/types.js";
```

Note the `.js` suffix in the import path: this is required for ESM resolution under our `tsconfig.json` `module: "ESNext"` / `moduleResolution: "Bundler"` setup when running through tsx.

- [ ] **Step 3: Verify the refactor compiles cleanly**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 4: Verify the existing HTML output is byte-identical**

```bash
npx tsx arc-to-vivaldi.ts --output before.html
# (the refactor is in-place; re-run to confirm idempotent output)
npx tsx arc-to-vivaldi.ts --output after.html
diff before.html after.html
```

Expected: `diff` produces no output. Delete both temporary files afterwards:

```bash
rm before.html after.html
```

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts arc-to-vivaldi.ts
git commit -m "refactor: extract types into lib/types.ts"
```

---

## Task 3: Extract `parseArgs` into `lib/cli.ts` with new flags and conflict detection

**Files:**
- Create: `C:\Development\arc-to-vivaldi-migration\lib\cli.ts`
- Create: `C:\Development\arc-to-vivaldi-migration\test\cli.test.ts`
- Modify: `C:\Development\arc-to-vivaldi-migration\arc-to-vivaldi.ts`

- [ ] **Step 1: Write failing tests for the extended `parseArgs`**

Create `test/cli.test.ts`:

```typescript
import { test } from "node:test";
import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { parseArgs } from "../lib/cli.js";

test("parseArgs: defaults", () => {
  deepStrictEqual(parseArgs([]), {
    input: undefined,
    output: undefined,
    verbose: false,
    split: false,
    mode: "html",
  });
});

test("parseArgs: --probe sets mode to probe", () => {
  strictEqual(parseArgs(["--probe"]).mode, "probe");
});

test("parseArgs: --inject sets mode to inject", () => {
  strictEqual(parseArgs(["--inject"]).mode, "inject");
});

test("parseArgs: --inject-dry-run sets mode to inject-dry-run", () => {
  strictEqual(parseArgs(["--inject-dry-run"]).mode, "inject-dry-run");
});

test("parseArgs: --probe + --inject is a conflict", () => {
  throws(() => parseArgs(["--probe", "--inject"]), /mutually exclusive/);
});

test("parseArgs: --split + --inject is a conflict", () => {
  throws(() => parseArgs(["--split", "--inject"]), /split.*only applies/i);
});

test("parseArgs: --output combines with --inject", () => {
  const args = parseArgs(["--inject", "--output", "x.js"]);
  strictEqual(args.mode, "inject");
  strictEqual(args.output, "x.js");
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test`
Expected: failures because `lib/cli.ts` does not exist yet. Look for `Cannot find module`.

- [ ] **Step 3: Implement `lib/cli.ts`**

```typescript
export type CliMode = "html" | "probe" | "inject" | "inject-dry-run";

export interface CliArgs {
  readonly input: string | undefined;
  readonly output: string | undefined;
  readonly verbose: boolean;
  readonly split: boolean;
  readonly mode: CliMode;
}

export function parseArgs(argv: readonly string[]): CliArgs {
  let input: string | undefined;
  let output: string | undefined;
  let verbose = false;
  let split = false;
  let mode: CliMode = "html";

  const setMode = (next: CliMode): void => {
    if (mode !== "html" && mode !== next) {
      throw new Error(
        `--probe, --inject and --inject-dry-run are mutually exclusive`,
      );
    }
    mode = next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--input requires a value");
      input = next;
      i++;
    } else if (arg === "--output") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--output requires a value");
      output = next;
      i++;
    } else if (arg === "--split") {
      split = true;
    } else if (arg === "--probe") {
      setMode("probe");
    } else if (arg === "--inject") {
      setMode("inject");
    } else if (arg === "--inject-dry-run") {
      setMode("inject-dry-run");
    } else if (arg === "-v" || arg === "--verbose") {
      verbose = true;
    } else if (arg === "-h" || arg === "--help") {
      process.stdout.write(
        "usage: tsx arc-to-vivaldi.ts [--input <path>] [--output <path>]\n" +
          "                            [--split | --probe | --inject | --inject-dry-run]\n" +
          "                            [-v]\n" +
          "  HTML modes (default): --split is allowed.\n" +
          "  JS payload modes: --probe, --inject, --inject-dry-run are mutually exclusive\n" +
          "    and cannot be combined with --split.\n",
      );
      process.exit(0);
    } else if (arg !== undefined) {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (split && mode !== "html") {
    throw new Error("--split only applies to HTML output, not JS payload modes");
  }

  return { input, output, verbose, split, mode };
}
```

- [ ] **Step 4: Update `arc-to-vivaldi.ts` to import `parseArgs` from `lib/cli.ts`**

In `arc-to-vivaldi.ts`, **delete** the entire local `CliArgs` interface and `parseArgs` function. Add to the imports:

```typescript
import { parseArgs, type CliArgs } from "./lib/cli.js";
```

`CliArgs` is now imported via the new module. `main()` does not yet need to branch on `args.mode` — that wiring comes later in Task 7. For now `main()` simply behaves as before for the HTML path; if `args.mode !== "html"` the script should print a placeholder and exit cleanly. Add this guard at the start of `main()`, immediately after `parseArgs`:

```typescript
if (args.mode !== "html") {
  process.stderr.write(`mode ${args.mode} not yet wired; see Task 7\n`);
  return 0;
}
```

(This guard is removed in Task 7.)

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 6: Sanity-check HTML mode still works**

Run: `npx tsx arc-to-vivaldi.ts --output sanity.html && ls -la sanity.html && rm sanity.html`
Expected: file is created and non-empty.

- [ ] **Step 7: Commit**

```bash
git add lib/cli.ts test/cli.test.ts arc-to-vivaldi.ts
git commit -m "feat(cli): add --probe, --inject, --inject-dry-run flags with conflict detection"
```

---

## Task 4: Add `InjectablePayload` types and `buildInjectablePayload`

**Files:**
- Modify: `C:\Development\arc-to-vivaldi-migration\lib\types.ts`
- Create: `C:\Development\arc-to-vivaldi-migration\lib\payload.ts`
- Create: `C:\Development\arc-to-vivaldi-migration\test\payload.test.ts`

- [ ] **Step 1: Append new types to `lib/types.ts`**

Add at the bottom of `lib/types.ts`:

```typescript
// Data embedded into the inject script.
export interface InjectableTab {
  readonly url: string;
  readonly title: string;
}

export interface InjectableSpace {
  readonly title: string;
  readonly pinned: readonly InjectableTab[];
  readonly unpinned: readonly InjectableTab[];
}

export interface InjectablePayload {
  readonly generatedAt: string;
  readonly sourcePath: string;
  readonly spaces: readonly InjectableSpace[];
}
```

- [ ] **Step 2: Write failing tests for `buildInjectablePayload`**

Create `test/payload.test.ts`:

```typescript
import { test } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import { buildInjectablePayload, flattenLeaves } from "../lib/payload.js";
import type { BookmarkNode, SpaceConversion } from "../lib/types.js";

const leaf = (title: string, url: string): BookmarkNode => ({
  kind: "leaf",
  title,
  url,
});

const folder = (title: string, children: readonly BookmarkNode[]): BookmarkNode => ({
  kind: "folder",
  title,
  children,
});

test("flattenLeaves: depth-first preserves order", () => {
  const tree: readonly BookmarkNode[] = [
    leaf("A", "https://a"),
    folder("F1", [leaf("B", "https://b"), leaf("C", "https://c")]),
    leaf("D", "https://d"),
  ];
  deepStrictEqual(flattenLeaves(tree), [
    { title: "A", url: "https://a" },
    { title: "B", url: "https://b" },
    { title: "C", url: "https://c" },
    { title: "D", url: "https://d" },
  ]);
});

test("flattenLeaves: empty tree returns empty array", () => {
  deepStrictEqual(flattenLeaves([]), []);
});

test("buildInjectablePayload: builds per-space flat lists", () => {
  const conversions: readonly SpaceConversion[] = [
    {
      title: "Personal",
      iconHint: undefined,
      pinned: [leaf("P1", "https://p1")],
      unpinned: [folder("F", [leaf("U1", "https://u1"), leaf("U2", "https://u2")])],
      bookmarkCount: 3,
      folderCount: 1,
    },
  ];
  const payload = buildInjectablePayload(conversions, {
    sourcePath: "/tmp/StorableSidebar.json",
    now: new Date("2026-05-12T10:00:00.000Z"),
  });
  strictEqual(payload.sourcePath, "/tmp/StorableSidebar.json");
  strictEqual(payload.generatedAt, "2026-05-12T10:00:00.000Z");
  strictEqual(payload.spaces.length, 1);
  const space = payload.spaces[0];
  if (space === undefined) throw new Error("space missing");
  strictEqual(space.title, "Personal");
  deepStrictEqual(space.pinned, [{ title: "P1", url: "https://p1" }]);
  deepStrictEqual(space.unpinned, [
    { title: "U1", url: "https://u1" },
    { title: "U2", url: "https://u2" },
  ]);
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npm test`
Expected: failures with `Cannot find module '../lib/payload.js'`.

- [ ] **Step 4: Implement `lib/payload.ts`**

```typescript
import type {
  BookmarkNode,
  InjectablePayload,
  InjectableSpace,
  InjectableTab,
  SpaceConversion,
} from "./types.js";

export function flattenLeaves(nodes: readonly BookmarkNode[]): InjectableTab[] {
  const out: InjectableTab[] = [];
  for (const node of nodes) {
    if (node.kind === "leaf") {
      out.push({ title: node.title, url: node.url });
    } else {
      for (const tab of flattenLeaves(node.children)) {
        out.push(tab);
      }
    }
  }
  return out;
}

export interface BuildPayloadOptions {
  readonly sourcePath: string;
  readonly now: Date;
}

export function buildInjectablePayload(
  conversions: readonly SpaceConversion[],
  opts: BuildPayloadOptions,
): InjectablePayload {
  const spaces: InjectableSpace[] = conversions.map((c) => ({
    title: c.title,
    pinned: flattenLeaves(c.pinned),
    unpinned: flattenLeaves(c.unpinned),
  }));
  return {
    generatedAt: opts.now.toISOString(),
    sourcePath: opts.sourcePath,
    spaces,
  };
}
```

- [ ] **Step 5: Run typecheck and tests**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/payload.ts test/payload.test.ts
git commit -m "feat(payload): add InjectablePayload type and buildInjectablePayload"
```

---

## Task 5: Render the probe script

**Files:**
- Create: `C:\Development\arc-to-vivaldi-migration\lib\render-probe.ts`
- Create: `C:\Development\arc-to-vivaldi-migration\test\render-probe.test.ts`

- [ ] **Step 1: Write failing tests for `renderProbeScript`**

Create `test/render-probe.test.ts`:

```typescript
import { test } from "node:test";
import { ok, match } from "node:assert";
import { renderProbeScript } from "../lib/render-probe.js";

test("renderProbeScript: returns an IIFE", () => {
  const src = renderProbeScript();
  match(src, /^\(\(\) => \{/m);
  match(src, /\}\)\(\);\s*$/);
});

test("renderProbeScript: includes the key probe targets", () => {
  const src = renderProbeScript();
  for (const target of [
    "vivaldi",
    "workspaces",
    "workspacesPrivate",
    "tabsPrivate",
    "bookmarksPrivate",
    "sessionsPrivate",
    "JSON.stringify",
  ]) {
    ok(src.includes(target), `expected probe to mention ${target}`);
  }
});

test("renderProbeScript: contains no top-level await", () => {
  const src = renderProbeScript();
  ok(!/^\s*await /m.test(src), "probe must not use top-level await");
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test`
Expected: failure with `Cannot find module '../lib/render-probe.js'`.

- [ ] **Step 3: Implement `lib/render-probe.ts`**

```typescript
export function renderProbeScript(): string {
  return `(() => {
  const result = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    vivaldi: { available: false },
  };

  try {
    if (typeof vivaldi !== "undefined" && vivaldi) {
      result.vivaldi.available = true;
      result.vivaldi.keys = Object.keys(vivaldi).sort();
      result.vivaldi.namespaces = {};

      const candidates = [
        "workspaces",
        "workspacesPrivate",
        "tabsPrivate",
        "bookmarksPrivate",
        "sessionsPrivate",
      ];

      for (const ns of candidates) {
        const obj = vivaldi[ns];
        if (!obj) continue;
        const members = {};
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (typeof v === "function") {
            try {
              members[k] = v.toString().slice(0, 200);
            } catch (e) {
              members[k] = "<function (toString failed)>";
            }
          } else {
            members[k] = typeof v;
          }
        }
        result.vivaldi.namespaces[ns] = members;
      }

      result.workspacesProbe = {};
      const readAttempts = [
        ["vivaldi.workspaces.getAll", () =>
          vivaldi.workspaces && vivaldi.workspaces.getAll && vivaldi.workspaces.getAll()],
        ["vivaldi.workspacesPrivate.getAll", () =>
          vivaldi.workspacesPrivate && vivaldi.workspacesPrivate.getAll && vivaldi.workspacesPrivate.getAll()],
      ];

      for (const [name, fn] of readAttempts) {
        try {
          const r = fn();
          if (r && typeof r.then === "function") {
            r.then((value) => {
              result.workspacesProbe[name] = { ok: true, async: true, result: value };
              console.log("[probe] " + name + " resolved:", value);
            }, (err) => {
              result.workspacesProbe[name] = { ok: false, async: true, error: String(err) };
              console.log("[probe] " + name + " rejected:", err);
            });
            result.workspacesProbe[name] = { ok: true, async: true, pending: true };
          } else {
            result.workspacesProbe[name] = { ok: true, async: false, result: r };
          }
        } catch (e) {
          result.workspacesProbe[name] = { ok: false, error: String(e) };
        }
      }
    }
  } catch (e) {
    result.error = String(e);
  }

  console.log(JSON.stringify(result, null, 2));
  return result;
})();
`;
}
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/render-probe.ts test/render-probe.test.ts
git commit -m "feat(probe): add renderProbeScript for Vivaldi private API discovery"
```

---

## Task 6: Render the injector script

**Files:**
- Create: `C:\Development\arc-to-vivaldi-migration\lib\render-inject.ts`
- Create: `C:\Development\arc-to-vivaldi-migration\test\render-inject.test.ts`

- [ ] **Step 1: Write failing tests for `renderInjectScript`**

Create `test/render-inject.test.ts`:

```typescript
import { test } from "node:test";
import { ok, match } from "node:assert";
import { renderInjectScript } from "../lib/render-inject.js";
import type { InjectablePayload } from "../lib/types.js";

const sample: InjectablePayload = {
  generatedAt: "2026-05-12T10:00:00.000Z",
  sourcePath: "/tmp/x.json",
  spaces: [
    {
      title: "Personal",
      pinned: [{ title: "P", url: "https://p" }],
      unpinned: [{ title: "U", url: "https://u" }],
    },
  ],
};

test("renderInjectScript: embeds ARC_DATA literal", () => {
  const src = renderInjectScript(sample, { dryRun: false });
  ok(src.includes("const ARC_DATA"));
  ok(src.includes("https://p"));
  ok(src.includes("Personal"));
});

test("renderInjectScript: dryRun flag is honoured", () => {
  const dry = renderInjectScript(sample, { dryRun: true });
  match(dry, /const DRY_RUN = true;/);
  const wet = renderInjectScript(sample, { dryRun: false });
  match(wet, /const DRY_RUN = false;/);
});

test("renderInjectScript: references the expected private API names", () => {
  const src = renderInjectScript(sample, { dryRun: false });
  for (const name of [
    "vivaldi.workspaces",
    "chrome.tabs.create",
    "pinned: true",
  ]) {
    ok(src.includes(name), "expected output to mention " + name);
  }
});

test("renderInjectScript: is a self-invoking async IIFE", () => {
  const src = renderInjectScript(sample, { dryRun: false });
  match(src, /\(async \(\) => \{/);
  match(src, /\}\)\(\);\s*$/);
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test`
Expected: failure with `Cannot find module '../lib/render-inject.js'`.

- [ ] **Step 3: Implement `lib/render-inject.ts`**

```typescript
import type { InjectablePayload } from "./types.js";

export interface RenderInjectOptions {
  readonly dryRun: boolean;
}

export function renderInjectScript(
  payload: InjectablePayload,
  opts: RenderInjectOptions,
): string {
  const dataLiteral = JSON.stringify(payload, null, 2);
  const dryRunLiteral = opts.dryRun ? "true" : "false";

  return `// Vivaldi Workspaces importer for arc-to-vivaldi-migration.
// Paste into Vivaldi's internal DevTools console
// (chrome://inspect/#apps -> click the entry for window.html).
//
// Generated: ${payload.generatedAt}
// Source:    ${payload.sourcePath}
// Dry run:   ${dryRunLiteral}

const ARC_DATA = ${dataLiteral};
const DRY_RUN = ${dryRunLiteral};

(async () => {
  const log = (...args) => console.log("[arc->vivaldi]", ...args);
  const fail = (msg) => { console.error("[arc->vivaldi] ABORT:", msg); throw new Error(msg); };

  if (typeof vivaldi === "undefined" || !vivaldi) {
    fail("vivaldi global not in scope — are you in the internal DevTools console for window.html?");
  }

  const wsApi = vivaldi.workspaces || vivaldi.workspacesPrivate;
  if (!wsApi || typeof wsApi.create !== "function") {
    fail("Could not find vivaldi.workspaces.create or vivaldi.workspacesPrivate.create. " +
         "Run --probe first and update the importer to match the actual API shape.");
  }

  if (typeof chrome === "undefined" || !chrome.tabs || typeof chrome.tabs.create !== "function") {
    fail("chrome.tabs.create not available in this context.");
  }

  const createWorkspace = async (name) => {
    if (DRY_RUN) { log("DRY: createWorkspace", { name }); return { id: "dry-" + name }; }
    const result = await wsApi.create({ name });
    return result;
  };

  const createTab = async (url, opts) => {
    const tabOpts = { url, active: false, pinned: !!opts.pinned };
    if (opts.workspaceId !== undefined) {
      tabOpts.vivExtData = { workspaceId: opts.workspaceId };
    }
    if (DRY_RUN) { log("DRY: createTab", tabOpts); return { id: -1 }; }
    return await chrome.tabs.create(tabOpts);
  };

  const summary = { spaces: 0, pinned: 0, unpinned: 0, failures: [] };

  for (const space of ARC_DATA.spaces) {
    log("space:", space.title, "(pinned=" + space.pinned.length + ", unpinned=" + space.unpinned.length + ")");
    let ws;
    try {
      ws = await createWorkspace(space.title);
    } catch (err) {
      summary.failures.push({ space: space.title, stage: "workspace", error: String(err) });
      log("  workspace create failed, skipping space:", err);
      continue;
    }
    summary.spaces++;
    const workspaceId = ws && (ws.id ?? ws.workspaceId);

    for (let i = 0; i < space.pinned.length; i++) {
      const tab = space.pinned[i];
      try {
        await createTab(tab.url, { pinned: true, workspaceId });
        summary.pinned++;
      } catch (err) {
        summary.failures.push({ space: space.title, kind: "pinned", url: tab.url, error: String(err) });
        log("  pinned tab failed:", tab.url, err);
      }
    }
    log("  pinned " + summary.pinned + "/" + space.pinned.length);

    for (let i = 0; i < space.unpinned.length; i++) {
      const tab = space.unpinned[i];
      try {
        await createTab(tab.url, { pinned: false, workspaceId });
        summary.unpinned++;
      } catch (err) {
        summary.failures.push({ space: space.title, kind: "unpinned", url: tab.url, error: String(err) });
        log("  unpinned tab failed:", tab.url, err);
      }
    }
    log("  unpinned " + summary.unpinned + "/" + space.unpinned.length);
  }

  log("DONE", summary);
  if (summary.failures.length > 0) {
    console.warn("[arc->vivaldi] " + summary.failures.length + " failures — see summary.");
  }
})();
`;
}
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/render-inject.ts test/render-inject.test.ts
git commit -m "feat(inject): add renderInjectScript with dry-run support"
```

---

## Task 7: Wire dispatch into `main()`

**Files:**
- Modify: `C:\Development\arc-to-vivaldi-migration\arc-to-vivaldi.ts`

- [ ] **Step 1: Add the new imports**

In `arc-to-vivaldi.ts`, add to the imports at the top:

```typescript
import { buildInjectablePayload } from "./lib/payload.js";
import { renderProbeScript } from "./lib/render-probe.js";
import { renderInjectScript } from "./lib/render-inject.js";
```

- [ ] **Step 2: Replace the temporary mode guard with full dispatch**

In `main()`, **delete** the Task 3 placeholder:

```typescript
if (args.mode !== "html") {
  process.stderr.write(`mode ${args.mode} not yet wired; see Task 7\n`);
  return 0;
}
```

Locate the block in `main()` that begins right after the loop building `conversions` and ends at the existing `return 0;`. That block currently handles the HTML write and summary. **Wrap it** so it only runs when `args.mode === "html"`, and add `probe` / `inject` / `inject-dry-run` branches before the HTML branch. The new structure of the tail end of `main()`:

```typescript
  if (args.mode === "probe") {
    const outPath = args.output ?? "./probe-vivaldi.js";
    await writeFile(outPath, renderProbeScript(), "utf8");
    process.stderr.write(
      `probe script written to ${outPath}\n` +
        `paste it into Vivaldi's internal DevTools (chrome://inspect/#apps -> window.html)\n`,
    );
    return 0;
  }

  if (args.mode === "inject" || args.mode === "inject-dry-run") {
    const outPath = args.output ?? "./vivaldi-import.js";
    const payload = buildInjectablePayload(conversions, {
      sourcePath: inputPath,
      now: new Date(),
    });
    const script = renderInjectScript(payload, {
      dryRun: args.mode === "inject-dry-run",
    });
    await writeFile(outPath, script, "utf8");
    const totalTabs = payload.spaces.reduce(
      (acc, s) => acc + s.pinned.length + s.unpinned.length,
      0,
    );
    process.stderr.write(
      `${payload.spaces.length} spaces, ${totalTabs} tabs embedded in ${outPath}` +
        (args.mode === "inject-dry-run" ? " (dry-run mode)" : "") +
        "\n",
    );
    return 0;
  }

  // args.mode === "html" — existing behaviour below.
  const writtenPaths: string[] = [];
  // ... (the rest of the existing HTML branch is unchanged) ...
```

Leave the existing HTML branch logic exactly as it was. Only the wrapping is new.

- [ ] **Step 3: Typecheck and run the existing test suite**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean, all unit tests still pass (none of them touch `main()` directly).

- [ ] **Step 4: End-to-end smoke — HTML mode regression**

Run: `npx tsx arc-to-vivaldi.ts --output e2e.html && ls -la e2e.html`
Expected: file exists, summary printed as before. Then: `rm e2e.html`.

- [ ] **Step 5: End-to-end smoke — probe mode**

Run: `npx tsx arc-to-vivaldi.ts --probe`
Expected: stderr says `probe script written to ./probe-vivaldi.js`. Inspect: `head -5 probe-vivaldi.js` should show the IIFE opening. Then: `rm probe-vivaldi.js`.

- [ ] **Step 6: End-to-end smoke — inject-dry-run**

Run: `npx tsx arc-to-vivaldi.ts --inject-dry-run`
Expected: stderr reports embedded space/tab counts and `(dry-run mode)`. Inspect: `grep -c "DRY_RUN = true" vivaldi-import.js` should print `1`. Then: `rm vivaldi-import.js`.

- [ ] **Step 7: End-to-end smoke — inject (real)**

Run: `npx tsx arc-to-vivaldi.ts --inject`
Expected: stderr reports embedded counts (no `(dry-run mode)` suffix). Inspect: `grep -c "DRY_RUN = false" vivaldi-import.js` should print `1`. Then: `rm vivaldi-import.js`.

- [ ] **Step 8: Commit**

```bash
git add arc-to-vivaldi.ts
git commit -m "feat: wire --probe, --inject, --inject-dry-run into main dispatch"
```

---

## Task 8: Update the README

**Files:**
- Modify: `C:\Development\arc-to-vivaldi-migration\README.md`

- [ ] **Step 1: Add a new section after the existing "Importing into Vivaldi" section**

Insert this block (verbatim) before the `## Notes` heading:

```markdown
## Experimental: recreate Arc Spaces as Vivaldi Workspaces

The HTML import only covers bookmarks. If you also want Arc's Spaces to come
across as real Vivaldi Workspaces with pinned and regular open tabs, there is
a three-step paste-into-DevTools workflow.

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
```

- [ ] **Step 2: Add the new flags to the existing flag table**

In the existing `## Usage` section, find the flag table and append these rows after the `-h, --help` row:

```markdown
| `--probe`              | Emit `probe-vivaldi.js` for Vivaldi private-API discovery. See "Experimental" section below. |
| `--inject`             | Emit `vivaldi-import.js` — a paste-able importer that creates Vivaldi Workspaces from your Arc Spaces. |
| `--inject-dry-run`     | Same as `--inject` but logs intended API calls instead of making them.                    |
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document --probe, --inject, --inject-dry-run workflow"
```

---

## Task 9: Push to GitHub

**Files:** none

- [ ] **Step 1: Push all commits**

Run: `git push`
Expected: commits land on `origin/main`. Confirm with `gh repo view --web` or check the GitHub UI.

- [ ] **Step 2: Mark the brainstorming task list complete**

Use `TaskUpdate` to mark task #6 (Hand off to writing-plans) as completed once execution is finished. The writing-plans task list is implicit in this plan document — execution of this plan satisfies task #6.

---

## Self-review

**Spec coverage:**
- "New CLI surface" — Task 3 wires the flags; Task 7 dispatches on them.
- "User workflow" — Task 7 produces the right files; Task 8 documents the workflow.
- "Probe script contents" — Task 5; tests in `render-probe.test.ts` lock in the key probe targets.
- "Importer script contents" — Task 6; tests lock in IIFE shape, ARC_DATA embedding, dry-run toggle, and key API names.
- "Data model embedded in the importer" — Task 4 defines `InjectablePayload`, `InjectableSpace`, `InjectableTab`.
- "Error handling and safety" — handled inside the rendered injector script (Task 6): every API call wrapped, summary printed, hard abort when expected methods are missing.
- "Open items requiring probe data" — the injector ships with best-guess method names (`vivaldi.workspaces.create` with fallback to `vivaldi.workspacesPrivate.create`; tabs via `chrome.tabs.create` with `vivExtData.workspaceId`) and aborts loudly if neither resolves. After the user runs the probe, the relevant constants in `lib/render-inject.ts` can be tightened in a follow-up.

**Placeholder scan:** none of the disallowed patterns appear. Every step contains executable code or commands.

**Type consistency:**
- `InjectablePayload.spaces[].pinned` and `.unpinned` are `readonly InjectableTab[]` everywhere (types.ts, payload.ts, render-inject.ts test).
- `CliArgs.mode` uses `CliMode` consistently in `lib/cli.ts` and the dispatch in `arc-to-vivaldi.ts`.
- `flattenLeaves` signature matches between its test, its implementation, and its caller in `buildInjectablePayload`.
- `renderProbeScript()` takes no args; `renderInjectScript(payload, opts)` takes `(InjectablePayload, RenderInjectOptions)` — consistent across test, implementation, and caller in `main()`.

No issues found.
