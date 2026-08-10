import { create } from "zustand";
import type { Layer, Page, ToolId } from "@/lib/types";

const HISTORY_LIMIT = 50;

interface EditorState {
  page: Page | null;
  layers: Layer[];
  selectedId: string | null;
  tool: ToolId;
  zoom: number;
  saving: boolean;
  lastSavedAt: number | null;

  past: Layer[][];
  future: Layer[][];

  loadPage: (page: Page, layers: Layer[]) => void;
  setTool: (tool: ToolId) => void;
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

export const useEditor = create<EditorState>((set, get) => ({
  page: null,
  layers: [],
  selectedId: null,
  tool: "select",
  zoom: 1,
  saving: false,
  lastSavedAt: null,
  past: [],
  future: [],

  loadPage: (page, layers) =>
    set({ page, layers, selectedId: null, past: [], future: [] }),

  setTool: (tool) => set({ tool }),
  setZoom: (zoom) => set({ zoom }),
  select: (selectedId) => set({ selectedId }),
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
