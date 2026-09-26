export type TextFile = { name: string; content: string };
export type Content = {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  svg: TextFile;
  labels: SvgLabel[];
};
export type ImageSummary = Omit<Content, "svg" | "labels"> & {
  labelCount: number;
};
export type Gallery = {
  schemaVersion: 4;
  revision: number;
  activeImageId: string | null;
  images: ImageSummary[];
  updatedAt: string;
};
export type SvgLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
};
export type Rect = { x: number; y: number; width: number; height: number };
export type Camera = { scale: number; centerX: number; centerY: number };
