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
