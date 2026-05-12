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
