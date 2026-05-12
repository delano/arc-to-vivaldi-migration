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
