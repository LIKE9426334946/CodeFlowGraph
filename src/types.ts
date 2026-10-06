export type TextFile = { name: string; content: string };
export type Content = {
  id: string;
  folderId: string;
  name: string;
  locked: boolean;
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
  schemaVersion: 5;
  revision: number;
  activeFolderId: string | null;
  activeImageId: string | null;
  folders: Folder[];
  images: ImageSummary[];
  updatedAt: string;
};
export type Folder = {
  id: string;
  name: string;
  description: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type FolderInput = Pick<Folder, "name" | "description">;
export type SvgLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
};
export type Rect = { x: number; y: number; width: number; height: number };
export type Camera = { scale: number; centerX: number; centerY: number };
