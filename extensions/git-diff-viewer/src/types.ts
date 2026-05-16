import type { FileDiffMetadata } from "@pierre/diffs";

export type DiffScope = "last-run" | "all" | "staged";
export type DiffMode = "inline" | "zed" | "summary";

export type FileStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export type ChangedFile = {
  path: string;
  oldPath?: string;
  status: FileStatus;
};

export type FileSnapshot = {
  path: string;
  oldContent: string;
  newContent: string;
  existedBefore: boolean;
  existedAfter: boolean;
};

export type PierreAppearance = "dark" | "light";

export type HastTextNode = {
  type: "text";
  value: string;
};

export type HastElementNode = {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

export type HastNode = HastTextNode | HastElementNode;

export type HighlightedDiffCode = {
  deletionLines: Array<HastNode | undefined>;
  additionLines: Array<HastNode | undefined>;
};

export type HighlightedDiffSet = Record<PierreAppearance, HighlightedDiffCode>;

export type DiffSpan = {
  text: string;
  fg?: string;
  bg?: string;
};

export type DiffRow =
  | {
      kind: "collapsed" | "metadata";
      text: string;
      fg: string;
      bg: string;
    }
  | {
      kind: "line";
      lineType: "context" | "addition" | "deletion";
      lineNumber?: number;
      spans: DiffSpan[];
      rowFg: string;
      rowBg: string;
      lineNumberFg: string;
    };

export type PierreDiffPayload = {
  snapshot: FileSnapshot;
  metadata: FileDiffMetadata;
  highlighted: HighlightedDiffSet;
};

export type DiffViewerDetails = {
  gitDiffViewer?: PierreDiffPayload;
};
