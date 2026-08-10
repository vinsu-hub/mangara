import { create } from "zustand";
import type { Geometry, Layer, PanelShape, Page, ToolId } from "@/lib/types";
import { mergeGeometry, splitGeometry } from "@/lib/layouts";

const HISTORY_LIMIT = 50;

interface EditorState {
  page: Page | null;
  layers: Layer[];
  selectedId: string | null;
  /** Multi-selection, needed by Merge. Mirrors the fabric active selection. */
  selectedIds: string[];
  tool: ToolId;
  /** Which panel shape the Panel tool draws. */
  shapeMode: PanelShape;
  zoom: number;
  saving: boolean;
  lastSavedAt: number | null;

  past: Layer[][];
  future: Layer[][];

  loadPage: (page: Page, layers: Layer[]) => void;
  setTool: (tool: ToolId) => void;
  setShapeMode: (shape: PanelShape) => void;
  selectMany: (ids: string[]) => void;
  setZoom: (zoom: number) => void;
  select: (id: string | null) => void;
  setSaving: (saving: boolean) => void;
  markSaved: () => void;

  addLayer: (layer: Layer) => void;
  /**
   * `transient` updates (live dragging) deliberately skip the history stack —
   * otherwise a single drag would push dozens of undo entries. The caller
   * commits one history entry when the interaction ends.
   */
  updateLayer: (id: string, patch: Partial<Layer>, transient?: boolean) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => Layer | null;

  splitLayer: (id: string, axis: "horizontal" | "vertical") => void;
  mergeLayers: (ids: string[]) => void;
  applyLayout: (geometries: Geometry[], replace: boolean) => void;

  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const clone = (layers: Layer[]): Layer[] =>
  layers.map((l) => ({
    ...l,
    geometry: { ...l.geometry },
    style: { ...l.style },
  }));


const baseLayer = (
  pageId: string,
  geometry: Geometry,
  zIndex: number
): Layer => ({
  id: crypto.randomUUID(),
  page_id: pageId,
  kind: "panel",
  geometry,
  style: { fill: "#e9e9ee", stroke: "#111111", strokeWidth: 2 },
  content: null,
  z_index: zIndex,
  image_url: null,
  prompt: null,
  generation_status: "idle",
  review_status: "pending",
  last_provider: null,
});

export const useEditor = create<EditorState>((set, get) => ({
  page: null,
  layers: [],
  selectedId: null,
  selectedIds: [],
  tool: "select",
  shapeMode: "rectangle",
  zoom: 1,
  saving: false,
  lastSavedAt: null,
  past: [],
  future: [],

  loadPage: (page, layers) =>
    set({ page, layers, selectedId: null, selectedIds: [], past: [], future: [] }),

  setTool: (tool) => set({ tool }),
  setShapeMode: (shapeMode) => set({ shapeMode }),
  selectMany: (selectedIds) =>
    set({ selectedIds, selectedId: selectedIds[0] ?? null }),
  setZoom: (zoom) => set({ zoom }),
  select: (selectedId) =>
    set({ selectedId, selectedIds: selectedId ? [selectedId] : [] }),
  setSaving: (saving) => set({ saving }),
  markSaved: () => set({ saving: false, lastSavedAt: Date.now() }),

  addLayer: (layer) =>
    set((s) => ({
      past: [...s.past, clone(s.layers)].slice(-HISTORY_LIMIT),
      future: [],
      layers: [...s.layers, layer],
      selectedId: layer.id,
    })),

  updateLayer: (id, patch, transient = false) =>
    set((s) => ({
      past: transient
        ? s.past
        : [...s.past, clone(s.layers)].slice(-HISTORY_LIMIT),
      future: transient ? s.future : [],
      layers: s.layers.map((l) =>
        l.id === id
          ? {
              ...l,
              ...patch,
              geometry: patch.geometry
                ? { ...l.geometry, ...patch.geometry }
                : l.geometry,
              style: patch.style ? { ...l.style, ...patch.style } : l.style,
            }
          : l
      ),
    })),

  removeLayer: (id) =>
    set((s) => ({
      past: [...s.past, clone(s.layers)].slice(-HISTORY_LIMIT),
      future: [],
      layers: s.layers.filter((l) => l.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  duplicateLayer: (id) => {
    const src = get().layers.find((l) => l.id === id);
    if (!src) return null;
    const copy: Layer = {
      ...src,
      id: crypto.randomUUID(),
      geometry: {
        ...src.geometry,
        x: src.geometry.x + 24,
        y: src.geometry.y + 24,
      },
      style: { ...src.style },
      z_index: Math.max(0, ...get().layers.map((l) => l.z_index)) + 1,
    };
    get().addLayer(copy);
    return copy;
  },

  splitLayer: (id, axis) =>
    set((s) => {
      const src = s.layers.find((l) => l.id === id);
      if (!src) return s;
      const [a, b] = splitGeometry(src.geometry, axis);
      const maxZ = Math.max(0, ...s.layers.map((l) => l.z_index));
      // The original keeps its content and takes the first half; the second
      // half is a fresh empty panel.
      return {
        past: [...s.past, clone(s.layers)].slice(-HISTORY_LIMIT),
        future: [],
        layers: [
          ...s.layers.map((l) => (l.id === id ? { ...l, geometry: a } : l)),
          baseLayer(src.page_id, b, maxZ + 1),
        ],
      };
    }),

  mergeLayers: (ids) =>
    set((s) => {
      const chosen = s.layers.filter((l) => ids.includes(l.id));
      if (chosen.length < 2) return s;
      // Keep the first panel — along with any prompt or generated image it
      // already has — and grow it to cover the whole selection.
      const [keep, ...rest] = chosen;
      const restIds = new Set(rest.map((l) => l.id));
      return {
        past: [...s.past, clone(s.layers)].slice(-HISTORY_LIMIT),
        future: [],
        selectedId: keep.id,
        selectedIds: [keep.id],
        layers: s.layers
          .filter((l) => !restIds.has(l.id))
          .map((l) => (l.id === keep.id ? { ...l, geometry: mergeGeometry(chosen) } : l)),
      };
    }),

  applyLayout: (geometries, replace) =>
    set((s) => {
      if (!s.page) return s;
      const kept = replace ? s.layers.filter((l) => l.kind !== "panel") : s.layers;
      let z = Math.max(0, ...kept.map((l) => l.z_index));
      const created = geometries.map((g) => baseLayer(s.page!.id, g, ++z));
      return {
        past: [...s.past, clone(s.layers)].slice(-HISTORY_LIMIT),
        future: [],
        selectedId: null,
        selectedIds: [],
        layers: [...kept, ...created],
      };
    }),

  commit: () =>
    set((s) => ({
      past: [...s.past, clone(s.layers)].slice(-HISTORY_LIMIT),
      future: [],
    })),

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return {
        past: s.past.slice(0, -1),
        future: [clone(s.layers), ...s.future].slice(0, HISTORY_LIMIT),
        layers: prev,
        selectedId: null,
      };
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0];
      if (!next) return s;
      return {
        past: [...s.past, clone(s.layers)].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        layers: next,
        selectedId: null,
      };
    }),

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
