export type Rect = { x: number; y: number; width: number; height: number };
export type Camera = { scale: number; centerX: number; centerY: number };
export type SourceFile = { id: string; name: string; content: string };
export type Binding = {
  id: string;
  name: string;
  color: string;
  code: { file: string; startLine: number; endLine: number };
  svgRegion: Rect;
  note: string;
  annotation?: { x: number; y: number };
};
export type UIState = {
  activeFileId: string;
  split: number;
  theme: "dark" | "light";
  showCode: boolean;
  camera: Camera | null;
  selectedBindingId: string | null;
  editorViews: Record<
    string,
    { anchor: number; head: number; scrollTop: number; scrollLeft: number }
  >;
  portraitTab: "code" | "svg";
};
export type Project = {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  files: SourceFile[];
  svg: { name: string; content: string } | null;
  bindings: Binding[];
  ui: UIState;
};
export type ProjectSummary = Pick<
  Project,
  "id" | "name" | "revision" | "updatedAt"
> & { fileCount: number; bindingCount: number };
export type CodeSelection = {
  file: string;
  startLine: number;
  endLine: number;
};
export const COLORS = [
  "#8978ff",
  "#22bda3",
  "#eea34a",
  "#4c9cf3",
  "#e576b3",
  "#ef7872",
];
export const defaultUI = (): UIState => ({
  activeFileId: "",
  split: 46,
  theme: "dark",
  showCode: false,
  camera: null,
  selectedBindingId: null,
  editorViews: {},
  portraitTab: "code",
});
