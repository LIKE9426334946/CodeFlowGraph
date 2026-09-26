export type TextFile = { name: string; content: string };
export type Content = {
  schemaVersion: 3;
  revision: number;
  updatedAt: string;
  svg: TextFile | null;
  labels: SvgLabel[];
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
