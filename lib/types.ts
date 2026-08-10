export type LayerKind = "panel" | "text" | "bubble" | "sfx" | "shape";

export type ToolId =
  | "select"
  | "pan"
  | "panel"
  | "pen"
  | "shape"
  | "text"
  | "bubble"
  | "sfx";

export type GenerationStatus =
  | "idle"
  | "queued"
  | "generating"
  | "complete"
  | "failed";

export type ReviewStatus =
  | "pending"
  | "approved"
  | "needs_changes"
  | "send_back";

export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  shape: "rectangle" | "polygon" | "freeform" | "ellipse";
}

export interface LayerStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  rx?: number;
  fontSize?: number;
}

export interface Layer {
  id: string;
  page_id: string;
  kind: LayerKind;
  geometry: Geometry;
  style: LayerStyle;
  content: string | null;
  z_index: number;
  image_url: string | null;
  prompt: string | null;
  generation_status: GenerationStatus;
  review_status: ReviewStatus;
  last_provider: string | null;
}

export interface Page {
  id: string;
  chapter_id: string;
  order_index: number;
  width: number;
  height: number;
}

export interface Chapter {
  id: string;
  project_id: string;
  title: string;
  order_index: number;
}
