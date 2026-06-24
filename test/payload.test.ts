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

const split = (children: readonly BookmarkNode[]): BookmarkNode => ({
  kind: "split",
  orientation: "horizontal",
  children,
});

test("flattenLeaves: recurses split panes so the injector keeps both tabs", () => {
  const tree: readonly BookmarkNode[] = [
    leaf("A", "https://a"),
    split([leaf("L", "https://left"), leaf("R", "https://right")]),
    leaf("D", "https://d"),
  ];
  deepStrictEqual(flattenLeaves(tree), [
    { title: "A", url: "https://a" },
    { title: "L", url: "https://left" },
    { title: "R", url: "https://right" },
    { title: "D", url: "https://d" },
  ]);
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
