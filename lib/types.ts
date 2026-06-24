// Arc JSON shapes (narrowed at the boundary; never `any`).
export interface ArcSpaceIconType {
  // SF Symbol name (e.g. "terminal"); not renderable in a browser.
  readonly icon: string | undefined;
  // Actual emoji glyph (e.g. "🏡"); renderable directly.
  readonly emoji: string | undefined;
}

export interface ArcSpaceCustomInfo {
  readonly iconType: ArcSpaceIconType | undefined;
}

export interface ArcSpace {
  readonly id: string;
  readonly title: string;
  readonly customInfo: ArcSpaceCustomInfo | undefined;
  readonly newContainerIDs: readonly unknown[];
  // Derived at the boundary from customInfo.windowTheme: 0, 1, or 2 sRGB hex
  // stops describing the Space's accent. Empty when Arc stored no theme.
  readonly accent: readonly string[];
  // Canonical key for the Chromium profile backing this Space, used to look up
  // the per-profile "top apps" Favorites grid. "default" or "<machineID>/<dir>".
  readonly profileKey: string | undefined;
}

export interface ArcTabData {
  readonly savedURL: string | undefined;
  readonly savedTitle: string | undefined;
}

export type SplitOrientation = "horizontal" | "vertical";

export interface ArcItemData {
  readonly tab: ArcTabData | undefined;
  readonly isList: boolean;
  // Arc "split view" item: a container whose children are the side-by-side (or
  // stacked) panes. Distinguished by a `data.splitView` key.
  readonly splitOrientation: SplitOrientation | undefined;
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

// An Arc split view: two-or-more panes shown together. Preserved as its own kind
// so the standalone page can render the panes side by side; the flat Netscape
// HTML and JS-injector paths just recurse into its panes like a folder.
export interface BookmarkSplit {
  readonly kind: "split";
  readonly orientation: SplitOrientation;
  readonly children: readonly BookmarkNode[];
}

export type BookmarkNode = BookmarkLeaf | BookmarkFolder | BookmarkSplit;

export interface SpaceConversion {
  readonly title: string;
  readonly iconHint: string | undefined;
  readonly pinned: readonly BookmarkNode[];
  readonly unpinned: readonly BookmarkNode[];
  readonly bookmarkCount: number;
  readonly folderCount: number;
  // Optional presentation hints consumed only by the standalone page renderer
  // (--page). Absent for the Netscape HTML and JS-injector paths.
  readonly emoji?: string;
  readonly accent?: readonly string[];
  // Arc's per-profile "top apps" Favorites grid (the icon row above the pinned
  // list). Profile-shared: Spaces on the same Arc profile carry the same grid.
  readonly favorites?: readonly BookmarkNode[];
}

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
