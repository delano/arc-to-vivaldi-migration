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

  const createTab = async (url, tabOpts) => {
    const chromeOpts = { url, active: false, pinned: !!tabOpts.pinned };
    if (tabOpts.workspaceId !== undefined) {
      chromeOpts.vivExtData = { workspaceId: tabOpts.workspaceId };
    }
    if (DRY_RUN) { log("DRY: createTab", chromeOpts); return { id: -1 }; }
    return await chrome.tabs.create(chromeOpts);
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

    const pinnedBefore = summary.pinned;
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
    log("  pinned " + (summary.pinned - pinnedBefore) + "/" + space.pinned.length);

    const unpinnedBefore = summary.unpinned;
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
    log("  unpinned " + (summary.unpinned - unpinnedBefore) + "/" + space.unpinned.length);
  }

  log("DONE", summary);
  if (summary.failures.length > 0) {
    console.warn("[arc->vivaldi] " + summary.failures.length + " failures — see summary.");
  }
})();
`;
}
