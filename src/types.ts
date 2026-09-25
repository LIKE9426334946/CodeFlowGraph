export type TextFile = { name: string; content: string };
export type Content = {
  schemaVersion: 2;
  revision: number;
  updatedAt: string;
  code: TextFile;
  svg: TextFile | null;
};
export type DisplayMode = "split" | "code" | "svg";
export type Rect = { x: number; y: number; width: number; height: number };
export type Camera = { scale: number; centerX: number; centerY: number };
