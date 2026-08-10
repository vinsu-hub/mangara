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

export type PanelShape = "rectangle" | "polygon" | "freeform" | "ellipse";

export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  shape: PanelShape;
  /**
   * Vertices for polygon/freeform panels, relative to the panel's own
   * top-left corner. Stored inside the existing `geometry` jsonb column, so
   * non-rectangular panels need no migration.
   */
  points?: { x: number; y: number }[];
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

// ------------------------------------------------------------ story board ---

export type SceneTag =
  | "establishing"
  | "rising_action"
  | "climax"
  | "falling_action"
  | "resolution";

export type SceneStatus = "not_started" | "in_progress" | "complete";

export interface Scene {
  id: string;
  chapter_id: string;
  title: string;
  synopsis: string | null;
  purpose: string | null;
  tag: SceneTag;
  order_index: number;
  page_start: number | null;
  page_end: number | null;
  status: SceneStatus;
  notes: string | null;
  thumbnail_url: string | null;
}

export interface Beat {
  id: string;
  scene_id: string;
  body: string;
  order_index: number;
}

// -------------------------------------------------------- character ref ---

export interface ConsistencyLock {
  face?: number;
  hair?: number;
  clothing?: number;
  weapon?: number;
  proportions?: number;
}

export type ReferenceKind = "turnaround" | "pose" | "expression";

export interface Character {
  id: string;
  project_id: string;
  name: string;
  role: string | null;
  description: string | null;
  notes: string | null;
  age: string | null;
  height: string | null;
  weapon: string | null;
  style: string | null;
  personality: string[];
  theme_colors: string[];
  hero_image_url: string | null;
  consistency_lock: ConsistencyLock;
}

export interface CharacterReference {
  id: string;
  character_id: string;
  image_url: string | null;
  kind: ReferenceKind;
  label: string | null;
}

export interface CharacterRelationship {
  id: string;
  from_character_id: string;
  to_character_id: string;
  label: string;
}
