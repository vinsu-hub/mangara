"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  Canvas as FabricCanvas,
  Ellipse,
  FabricImage,
  Path,
  Pattern,
  Point,
  Polygon,
  Rect,
  InteractiveFabricObject,
  Textbox,
  type FabricObject,
  type TPointerEvent,
  type TPointerEventInfo,
} from "fabric";
import { useEditor } from "@/lib/store/editor";
import { Rulers } from "./rulers";
import {
  computeResizeSnap,
  computeSnap,
  type SnapLine,
} from "@/lib/snapping";
import type { Layer, LayerKind } from "@/lib/types";

const PAGE_BG = "#ffffff";

// Fabric v6+ defaults originX/originY to "center", which makes `left`/`top`
// the object's CENTRE. Every geometry value in this app — the Inspector, the
// stored panel rows, the drag maths — treats x/y as the top-left corner, so
// every object we create has to opt back into top-left origin. Without this a
// panel renders offset by half its size and the page backdrop sits centred on
// the origin with three quarters of it off-screen.
const TOP_LEFT = { originX: "left", originY: "top" } as const;
const DEFAULTS: Record<LayerKind, { fill: string; stroke: string }> = {
  panel: { fill: "#e9e9ee", stroke: "#111111" },
  shape: { fill: "#c9c9d4", stroke: "#111111" },
  text: { fill: "transparent", stroke: "transparent" },
  bubble: { fill: "#ffffff", stroke: "#111111" },
  sfx: { fill: "transparent", stroke: "transparent" },
};

// Crisper, smaller handles than fabric's pale default. Set once on the class
// rather than per object so every shape type picks them up.
Object.assign(InteractiveFabricObject.ownDefaults, {
  cornerStyle: "rect" as const,
  cornerSize: 9,
  cornerColor: "#ffffff",
  cornerStrokeColor: "#7c5cff",
  transparentCorners: false,
  borderColor: "#7c5cff",
  borderScaleFactor: 1.5,
  padding: 2,
});

/** Fabric object augmented with the id of the layer it represents. */
type TaggedObject = FabricObject & { layerId?: string };

/** Fabric pointer events may be mouse or touch; normalise to client coords. */
function clientXY(e: TPointerEvent): { x: number; y: number } {
  if ("touches" in e) {
    const t = e.touches[0] ?? e.changedTouches[0];
    return { x: t?.clientX ?? 0, y: t?.clientY ?? 0 };
  }
  return { x: e.clientX, y: e.clientY };
}


/**
 * Commits a polygon/freeform outline as a panel layer. Points are stored
 * relative to the shape's own bounding box so the panel can be moved and
 * resized like any rectangular one.
 */
function commitOutline(
  pts: { x: number; y: number }[],
  shape: "polygon" | "freeform"
) {
  const st = useEditor.getState();
  if (pts.length < 3 || !st.page) return;

  const xs = pts.map((pt) => pt.x);
  const ys = pts.map((pt) => pt.y);
  const x = Math.round(Math.min(...xs));
  const y = Math.round(Math.min(...ys));
  const w = Math.round(Math.max(...xs) - x);
  const h = Math.round(Math.max(...ys) - y);
  if (w < 8 || h < 8) return;

  st.addLayer({
    id: crypto.randomUUID(),
    page_id: st.page.id,
    kind: "panel",
    geometry: {
      x,
      y,
      w,
      h,
      rotation: 0,
      shape,
      points: pts.map((pt) => ({ x: Math.round(pt.x - x), y: Math.round(pt.y - y) })),
    },
    style: { fill: "#e9e9ee", stroke: "#111111", strokeWidth: 2 },
    content: null,
    z_index: Math.max(0, ...st.layers.map((l) => l.z_index)) + 1,
    image_url: null,
    prompt: null,
    generation_status: "idle",
    review_status: "pending",
    last_provider: null,
  });
  st.setTool("select");
}


/**
 * Mirrors fabric's viewport transform into the store for the rulers.
 * Throttled to one write per frame — panning fires mousemove far faster than
 * the rulers can usefully repaint, and each write re-renders them.
 */
let viewportFrame = 0;
function syncViewport(fc: FabricCanvas) {
  if (viewportFrame) return;
  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = 0;
    const vpt = fc.viewportTransform;
    useEditor.getState().setViewport({ zoom: vpt[0], tx: vpt[4], ty: vpt[5] });
  });
}

/** Rounds a value to the nearest grid line. */
const snapTo = (v: number, size: number) => Math.round(v / size) * size;

/**
 * A repeating tile used as the grid's pattern fill. One patterned rect is far
 * cheaper than thousands of line objects on a 2048x2896 page, and it scales
 * with the viewport for free because it lives in scene space.
 */
function gridTile(size: number): HTMLCanvasElement {
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext("2d");
  if (ctx) {
    ctx.strokeStyle = "rgba(124,92,255,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, size);
    ctx.moveTo(0, 0.5);
    ctx.lineTo(size, 0.5);
    ctx.stroke();
  }
  return tile;
}

export function EditorCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLCanvasElement>(null);
  const fcRef = useRef<FabricCanvas | null>(null);
  const objects = useRef(new Map<string, TaggedObject>());
  const pageRect = useRef<Rect | null>(null);
  const gridRect = useRef<Rect | null>(null);

  // Fabric event handlers are registered once, so they'd otherwise close over
  // the first render's state. Refs keep them reading current values.
  const toolRef = useRef(useEditor.getState().tool);
  const draft = useRef<{ obj: Rect | Ellipse; x: number; y: number } | null>(null);
  const shapeRef = useRef(useEditor.getState().shapeMode);
  // Polygon is click-to-place, so it spans many events and needs its own state.
  const poly = useRef<{ pts: { x: number; y: number }[]; preview: Polygon | null } | null>(null);
  const freehand = useRef<{ pts: { x: number; y: number }[]; preview: Path | null } | null>(null);
  const panning = useRef<{ x: number; y: number } | null>(null);
  const suppress = useRef(false);
  /** Lines to draw for the in-progress snap; cleared when the drag ends. */
  const snapLines = useRef<SnapLine[]>([]);
  /**
   * The layer currently being dragged. The store→fabric sync skips it, so the
   * editor stops writing over the very object under the cursor every frame.
   */
  const transforming = useRef<string | null>(null);

  const page = useEditor((s) => s.page);
  const layers = useEditor((s) => s.layers);
  const selectedId = useEditor((s) => s.selectedId);
  const tool = useEditor((s) => s.tool);
  const shapeMode = useEditor((s) => s.shapeMode);
  const zoom = useEditor((s) => s.zoom);
  const gridEnabled = useEditor((s) => s.gridEnabled);
  const gridSize = useEditor((s) => s.gridSize);
  const rulerEnabled = useEditor((s) => s.rulerEnabled);
  const guides = useEditor((s) => s.guides);

  useEffect(() => {
    shapeRef.current = shapeMode;
  }, [shapeMode]);

  useEffect(() => {
    toolRef.current = tool;
    const fc = fcRef.current;
    if (!fc) return;
    const interactive = tool === "select";
    fc.selection = interactive;
    fc.defaultCursor = tool === "pan" ? "grab" : "default";
    fc.forEachObject((o) => {
      const t = o as TaggedObject;
      if (!t.layerId) return;
      t.selectable = interactive;
      t.evented = interactive;
    });
    if (!interactive) {
      // Drop fabric's active object so drawing isn't blocked, but keep the
      // store's selection: the Panel sub-toolbar's Split/Merge act on the
      // selected panel, and clearing it here would make them permanently
      // unusable — you can only select with the Select tool.
      suppress.current = true;
      fc.discardActiveObject();
      suppress.current = false;
    }
    fc.requestRenderAll();
  }, [tool]);

  const fitToScreen = useCallback(() => {
    const fc = fcRef.current;
    const wrap = wrapRef.current;
    const pg = useEditor.getState().page;
    if (!fc || !wrap || !pg) return;
    const pad = 48;
    const scale = Math.min(
      (wrap.clientWidth - pad) / pg.width,
      (wrap.clientHeight - pad) / pg.height
    );
    const z = Math.max(0.05, scale);
    // Set zoom and translation in one shot. Mutating `viewportTransform` in
    // place after `setZoom` doesn't stick — setZoom recomputes the matrix, so
    // the assignment is silently discarded and the page renders at 0,0.
    fc.setViewportTransform([
      z,
      0,
      0,
      z,
      (wrap.clientWidth - pg.width * z) / 2,
      (wrap.clientHeight - pg.height * z) / 2,
    ]);
    fc.requestRenderAll();
    useEditor.getState().setZoom(z);
    syncViewport(fc);
  }, []);

  // ---------------------------------------------------------------- init ---
  useEffect(() => {
    if (!elRef.current || !wrapRef.current) return;

    const fc = new FabricCanvas(elRef.current, {
      backgroundColor: "#1b1b1f",
      preserveObjectStacking: true,
      raiseSelectionOnHover: false,
    });
    fcRef.current = fc;

    const resize = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      // setDimensions rebuilds the backing store and drops the viewport
      // transform with it, so the fit has to be re-applied afterwards —
      // otherwise the page ends up parked in the corner at the wrong scale.
      fc.setDimensions({ width: wrap.clientWidth, height: wrap.clientHeight });
      fitToScreen();
      fc.requestRenderAll();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current);

    // -- selection ---------------------------------------------------------
    const onSelect = () => {
      if (suppress.current) return;
      // A multi-select yields an ActiveSelection; report every layer in it so
      // Merge has something to work with.
      const ids = fc
        .getActiveObjects()
        .map((o) => (o as TaggedObject).layerId)
        .filter((id): id is string => Boolean(id));
      useEditor.getState().selectMany(ids);
    };
    fc.on("selection:created", onSelect);
    fc.on("selection:updated", onSelect);
    fc.on("selection:cleared", () => {
      if (suppress.current) return;
      useEditor.getState().select(null);
    });

    // -- geometry writeback ------------------------------------------------
    const writeBack = (obj: TaggedObject, transient: boolean) => {
      if (!obj.layerId) return;
      useEditor.getState().updateLayer(
        obj.layerId,
        {
          geometry: {
            x: Math.round(obj.left ?? 0),
            y: Math.round(obj.top ?? 0),
            w: Math.round((obj.width ?? 0) * (obj.scaleX ?? 1)),
            h: Math.round((obj.height ?? 0) * (obj.scaleY ?? 1)),
            rotation: Math.round(obj.angle ?? 0),
          } as Layer["geometry"],
        },
        transient
      );
    };

    fc.on("object:moving", (e) => {
      const obj = e.target as TaggedObject;
      const st = useEditor.getState();
      transforming.current = obj.layerId ?? null;
      snapLines.current = [];

      if (st.snapEnabled) {
        obj.set({
          left: snapTo(obj.left ?? 0, st.gridSize),
          top: snapTo(obj.top ?? 0, st.gridSize),
        });
      }

      // Alignment runs after the grid so it can override it — an edge shared
      // with a real panel is a more deliberate target than a grid line.
      if (st.alignEnabled && st.page) {
        const geo = {
          ...(st.layers.find((l) => l.id === obj.layerId)?.geometry ??
            { rotation: 0, shape: "rectangle" as const }),
          x: obj.left ?? 0,
          y: obj.top ?? 0,
          w: (obj.width ?? 0) * (obj.scaleX ?? 1),
          h: (obj.height ?? 0) * (obj.scaleY ?? 1),
        };
        const { dx, dy, lines } = computeSnap(
          geo,
          st.layers.filter((l) => l.id !== obj.layerId),
          st.page,
          st.guides,
          fc.getZoom()
        );
        if (dx || dy) obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy });
        snapLines.current = lines;
      }

      obj.setCoords();
      writeBack(obj, true);
    });
    fc.on("object:scaling", (e) => {
      const obj = e.target as TaggedObject;
      const st = useEditor.getState();
      transforming.current = obj.layerId ?? null;
      snapLines.current = [];

      let w = (obj.width ?? 0) * (obj.scaleX ?? 1);
      let h = (obj.height ?? 0) * (obj.scaleY ?? 1);

      if (st.snapEnabled) {
        w = Math.max(st.gridSize, snapTo(w, st.gridSize));
        h = Math.max(st.gridSize, snapTo(h, st.gridSize));
      }

      if (st.alignEnabled && st.page) {
        const snapped = computeResizeSnap(
          {
            x: obj.left ?? 0,
            y: obj.top ?? 0,
            w,
            h,
            rotation: 0,
            shape: "rectangle",
          },
          st.layers.filter((l) => l.id !== obj.layerId),
          st.page,
          st.guides,
          fc.getZoom()
        );
        w = snapped.w;
        h = snapped.h;
        snapLines.current = snapped.lines;
      }

      obj.set({ width: w, height: h, scaleX: 1, scaleY: 1 });
      obj.setCoords();
      writeBack(obj, true);
    });
    fc.on("object:rotating", (e) => writeBack(e.target as TaggedObject, true));
    fc.on("object:modified", (e) => {
      const obj = e.target as TaggedObject;
      if (!obj) return;
      // Bake scale into width/height so repeated resizes don't compound.
      if ((obj.scaleX ?? 1) !== 1 || (obj.scaleY ?? 1) !== 1) {
        obj.set({
          width: (obj.width ?? 0) * (obj.scaleX ?? 1),
          height: (obj.height ?? 0) * (obj.scaleY ?? 1),
          scaleX: 1,
          scaleY: 1,
        });
      }
      writeBack(obj, true);
      useEditor.getState().commit();
      transforming.current = null;
      snapLines.current = [];
      fc.requestRenderAll();
    });

    // -- draw / pan --------------------------------------------------------
    fc.on("mouse:down", (opt: TPointerEventInfo) => {
      const t = toolRef.current;
      const p = fc.getScenePoint(opt.e);

      if (t === "pan") {
        panning.current = clientXY(opt.e);
        fc.defaultCursor = "grabbing";
        return;
      }
      if (t === "select") return;

      const snap = useEditor.getState();
      if (snap.snapEnabled) {
        p.x = snapTo(p.x, snap.gridSize);
        p.y = snapTo(p.y, snap.gridSize);
      }

      // Non-rectangular panels take their own interaction paths.
      if (t === "panel" && shapeRef.current === "polygon") {
        const pts = [...(poly.current?.pts ?? []), { x: p.x, y: p.y }];
        if (poly.current?.preview) fc.remove(poly.current.preview);
        const preview = new Polygon(pts, {
          ...TOP_LEFT,
          fill: "rgba(233,233,238,0.5)",
          stroke: "#7c5cff",
          strokeWidth: 2,
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        poly.current = { pts, preview };
        fc.add(preview);
        fc.requestRenderAll();
        return;
      }

      if (t === "panel" && shapeRef.current === "freeform") {
        freehand.current = { pts: [{ x: p.x, y: p.y }], preview: null };
        return;
      }

      const kind: LayerKind =
        t === "panel" ? "panel"
        : t === "bubble" ? "bubble"
        : t === "text" ? "text"
        : t === "sfx" ? "sfx"
        : "shape";

      const d = DEFAULTS[kind];
      const common = {
        ...TOP_LEFT,
        left: p.x,
        top: p.y,
        fill: d.fill,
        stroke: d.stroke,
        strokeWidth: 2,
        selectable: false,
        evented: false,
      };
      const obj =
        kind === "bubble"
          ? new Ellipse({ ...common, rx: 1, ry: 1 })
          : new Rect({ ...common, width: 1, height: 1 });

      draft.current = { obj, x: p.x, y: p.y };
      fc.add(obj);
    });

    fc.on("mouse:dblclick", () => {
      if (!poly.current) return;
      const { pts, preview } = poly.current;
      if (preview) fc.remove(preview);
      poly.current = null;
      commitOutline(pts, "polygon");
      fc.requestRenderAll();
    });

    fc.on("mouse:move", (opt: TPointerEventInfo) => {
      if (panning.current) {
        const c = clientXY(opt.e);
        const dx = c.x - panning.current.x;
        const dy = c.y - panning.current.y;
        panning.current = c;
        fc.relativePan(new Point(dx, dy));
        syncViewport(fc);
        return;
      }
      if (freehand.current) {
        const p = fc.getScenePoint(opt.e);
        const pts = freehand.current.pts;
        const last = pts[pts.length - 1];
        // Thin the samples — a raw mousemove trace stores far more points
        // than the outline needs and makes the saved geometry huge.
        if (Math.hypot(p.x - last.x, p.y - last.y) < 12) return;
        pts.push({ x: p.x, y: p.y });
        if (freehand.current.preview) fc.remove(freehand.current.preview);
        const path = new Path(
          `M ${pts.map((q) => `${q.x} ${q.y}`).join(" L ")} Z`,
          {
            ...TOP_LEFT,
            fill: "rgba(233,233,238,0.5)",
            stroke: "#7c5cff",
            strokeWidth: 2,
            selectable: false,
            evented: false,
            objectCaching: false,
          }
        );
        freehand.current.preview = path;
        fc.add(path);
        fc.requestRenderAll();
        return;
      }

      const d = draft.current;
      if (!d) return;
      const raw = fc.getScenePoint(opt.e);
      const { snapEnabled, gridSize } = useEditor.getState();
      const p = snapEnabled
        ? { x: snapTo(raw.x, gridSize), y: snapTo(raw.y, gridSize) }
        : raw;
      const w = Math.abs(p.x - d.x);
      const h = Math.abs(p.y - d.y);
      d.obj.set({
        left: Math.min(p.x, d.x),
        top: Math.min(p.y, d.y),
        ...(d.obj instanceof Ellipse
          ? { rx: w / 2, ry: h / 2, width: w, height: h }
          : { width: w, height: h }),
      });
      fc.requestRenderAll();
    });

    fc.on("mouse:up", () => {
      if (panning.current) {
        panning.current = null;
        fc.defaultCursor = toolRef.current === "pan" ? "grab" : "default";
        return;
      }
      if (freehand.current) {
        const { pts, preview } = freehand.current;
        if (preview) fc.remove(preview);
        freehand.current = null;
        commitOutline(pts, "freeform");
        fc.requestRenderAll();
        return;
      }

      const d = draft.current;
      draft.current = null;
      if (!d) return;

      const w = d.obj.width ?? 0;
      const h = d.obj.height ?? 0;
      fc.remove(d.obj);

      // Ignore stray clicks that didn't actually drag out a shape.
      if (w < 8 || h < 8) {
        fc.requestRenderAll();
        return;
      }

      const t = toolRef.current;
      const kind: LayerKind =
        t === "panel" ? "panel"
        : t === "bubble" ? "bubble"
        : t === "text" ? "text"
        : t === "sfx" ? "sfx"
        : "shape";

      const st = useEditor.getState();

      // Keep new layers on the page. Without this a drag that runs past the
      // edge silently creates geometry out in the void, where it can't be
      // seen at fit-to-screen and won't appear in an export.
      const pw = st.page?.width ?? Infinity;
      const ph = st.page?.height ?? Infinity;
      const x = Math.max(0, Math.min(Math.round(d.obj.left ?? 0), pw));
      const y = Math.max(0, Math.min(Math.round(d.obj.top ?? 0), ph));

      st.addLayer({
        id: crypto.randomUUID(),
        page_id: st.page?.id ?? "",
        kind,
        geometry: {
          x,
          y,
          w: Math.round(Math.min(w, pw - x)),
          h: Math.round(Math.min(h, ph - y)),
          rotation: 0,
          shape: kind === "bubble" ? "ellipse" : "rectangle",
        },
        style: { ...DEFAULTS[kind], strokeWidth: 2 },
        content: kind === "text" ? "Text" : kind === "sfx" ? "BOOM" : null,
        z_index: Math.max(0, ...st.layers.map((l) => l.z_index)) + 1,
        image_url: null,
        prompt: null,
        generation_status: "idle",
        review_status: "pending",
        last_provider: null,
      });
      st.setTool("select");
    });

    // -- guides + snap lines ----------------------------------------------
    // Drawn straight onto the context after fabric renders, in screen space,
    // so they stay a crisp 1px hairline at any zoom instead of scaling with
    // the scene the way a fabric object would.
    fc.on("after:render", () => {
      const st = useEditor.getState();
      const ctx = fc.getContext();
      const vpt = fc.viewportTransform;
      const toX = (x: number) => x * vpt[0] + vpt[4];
      const toY = (y: number) => y * vpt[3] + vpt[5];

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.lineWidth = 1;

      // Persistent ruler guides.
      ctx.strokeStyle = "#22d3ee";
      for (const y of st.guides.h) {
        const py = Math.round(toY(y)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(fc.getWidth(), py);
        ctx.stroke();
      }
      for (const x of st.guides.v) {
        const px = Math.round(toX(x)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, fc.getHeight());
        ctx.stroke();
      }

      // Transient alignment feedback for the drag in progress.
      for (const line of snapLines.current) {
        ctx.strokeStyle = line.kind === "guide" ? "#22d3ee" : "#ff3d8b";
        ctx.beginPath();
        if (line.axis === "x") {
          const px = Math.round(toX(line.at)) + 0.5;
          ctx.moveTo(px, toY(line.from));
          ctx.lineTo(px, toY(line.to));
        } else {
          const py = Math.round(toY(line.at)) + 0.5;
          ctx.moveTo(toX(line.from), py);
          ctx.lineTo(toX(line.to), py);
        }
        ctx.stroke();
      }

      ctx.restore();
    });

    // -- wheel zoom --------------------------------------------------------
    fc.on("mouse:wheel", (opt) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      let z = fc.getZoom() * 0.999 ** e.deltaY;
      z = Math.min(5, Math.max(0.05, z));
      fc.zoomToPoint(new Point(e.offsetX, e.offsetY), z);
      useEditor.getState().setZoom(z);
      syncViewport(fc);
    });

    return () => {
      ro.disconnect();
      fc.dispose();
      fcRef.current = null;
      objects.current.clear();
    };
  }, [fitToScreen]);

  // ------------------------------------------------------- page backdrop ---
  useEffect(() => {
    const fc = fcRef.current;
    if (!fc || !page) return;
    if (pageRect.current) fc.remove(pageRect.current);
    const r = new Rect({
      left: 0,
      top: 0,
      width: page.width,
      height: page.height,
      fill: PAGE_BG,
      selectable: false,
      evented: false,
      hoverCursor: "default",
      ...TOP_LEFT,
      // A full-page rect (2048x2896) blows past Fabric's offscreen cache size
      // limit, and the clamped cache gets painted back at the wrong scale —
      // the backdrop ends up as a quadrant in the corner while every other
      // object transforms correctly. It's a flat fill; caching buys nothing.
      objectCaching: false,
    });
    pageRect.current = r;
    fc.add(r);
    fc.sendObjectToBack(r);
    fitToScreen();
  }, [page, fitToScreen]);

  // -------------------------------------------------------------- grid ----
  useEffect(() => {
    const fc = fcRef.current;
    if (!fc) return;
    if (gridRect.current) {
      fc.remove(gridRect.current);
      gridRect.current = null;
    }
    const pg = useEditor.getState().page;
    if (!gridEnabled || !pg) {
      fc.requestRenderAll();
      return;
    }
    const r = new Rect({
      ...TOP_LEFT,
      left: 0,
      top: 0,
      width: pg.width,
      height: pg.height,
      fill: new Pattern({ source: gridTile(gridSize), repeat: "repeat" }),
      selectable: false,
      evented: false,
      hoverCursor: "default",
      objectCaching: false,
    });
    gridRect.current = r;
    fc.add(r);
    // Above the page backdrop, below every real layer.
    if (pageRect.current) {
      fc.sendObjectToBack(r);
      fc.sendObjectToBack(pageRect.current);
    }
    fc.requestRenderAll();
  }, [gridEnabled, gridSize, page]);

  // ------------------------------------------------- store → fabric sync ---
  useEffect(() => {
    const fc = fcRef.current;
    if (!fc) return;
    const seen = new Set<string>();
    const interactive = useEditor.getState().tool === "select";

    for (const layer of layers) {
      seen.add(layer.id);
      let obj = objects.current.get(layer.id);

      if (!obj) {
        const g = layer.geometry;
        const base = {
          ...TOP_LEFT,
          left: g.x,
          top: g.y,
          width: g.w,
          height: g.h,
          angle: g.rotation,
          fill: layer.style.fill ?? DEFAULTS[layer.kind].fill,
          stroke: layer.style.stroke ?? DEFAULTS[layer.kind].stroke,
          strokeWidth: layer.style.strokeWidth ?? 2,
        };
        const created: TaggedObject =
          layer.kind === "text" || layer.kind === "sfx"
            ? new Textbox(layer.content ?? "", {
                ...base,
                fill: layer.style.fill ?? "#111111",
                stroke: undefined,
                fontSize: layer.style.fontSize ?? (layer.kind === "sfx" ? 96 : 32),
                fontWeight: layer.kind === "sfx" ? "900" : "400",
                fontFamily: "Inter, sans-serif",
              })
            : layer.kind === "bubble"
              ? new Ellipse({ ...base, rx: g.w / 2, ry: g.h / 2 })
              : g.shape === "polygon" && g.points?.length
                ? new Polygon(
                    g.points.map((pt) => ({ x: pt.x + g.x, y: pt.y + g.y })),
                    { ...base, objectCaching: false }
                  )
                : g.shape === "freeform" && g.points?.length
                  ? new Path(
                      `M ${g.points
                        .map((pt) => `${pt.x + g.x} ${pt.y + g.y}`)
                        .join(" L ")} Z`,
                      { ...base, objectCaching: false }
                    )
                  : new Rect({ ...base, rx: layer.style.rx ?? 0 });

        created.layerId = layer.id;
        created.selectable = interactive;
        created.evented = interactive;
        objects.current.set(layer.id, created);
        fc.add(created);
        obj = created;
      } else if (layer.id === transforming.current) {
        // Fabric already has the authoritative position mid-gesture; writing
        // the store's copy back here would fight the cursor every frame.
        continue;
      } else {
        const g = layer.geometry;
        obj.set({
          left: g.x,
          top: g.y,
          angle: g.rotation,
          stroke: layer.style.stroke,
          strokeWidth: layer.style.strokeWidth ?? 2,
        });
        if (obj instanceof Textbox) {
          obj.set({
            width: g.w,
            text: layer.content ?? "",
            fontSize: layer.style.fontSize ?? 32,
            fill: layer.style.fill ?? "#111111",
          });
        } else if (obj instanceof Ellipse) {
          obj.set({ rx: g.w / 2, ry: g.h / 2, width: g.w, height: g.h });
        } else if (obj instanceof Polygon || obj instanceof Path) {
          // The outline itself is baked into the object's points; only its
          // placement is driven from the store.
          obj.set({ left: g.x, top: g.y });
        } else {
          obj.set({ width: g.w, height: g.h, rx: layer.style.rx ?? 0 });
        }
        obj.setCoords();
      }

      // Generated art is painted as a pattern fill so one layer stays one
      // fabric object — keeps selection/resize mapping trivial.
      const current = (obj as TaggedObject & { _imgUrl?: string })._imgUrl;
      if (layer.image_url && current !== layer.image_url) {
        (obj as TaggedObject & { _imgUrl?: string })._imgUrl = layer.image_url;
        const target = obj;
        FabricImage.fromURL(layer.image_url, { crossOrigin: "anonymous" })
          .then((img) => {
            const el = img.getElement() as HTMLImageElement;
            if (!el.width || !el.height) return;
            const g = layer.geometry;
            target.set({
              fill: new Pattern({
                source: el,
                repeat: "no-repeat",
                patternTransform: [g.w / el.width, 0, 0, g.h / el.height, 0, 0],
              }),
            });
            fc.requestRenderAll();
          })
          .catch(() => {
            /* leave the placeholder fill in place if the image fails */
          });
      } else if (!layer.image_url) {
        (obj as TaggedObject & { _imgUrl?: string })._imgUrl = undefined;
        if (obj.fill instanceof Pattern) {
          obj.set({ fill: layer.style.fill ?? DEFAULTS[layer.kind].fill });
        }
      }
    }

    for (const [id, obj] of objects.current) {
      if (!seen.has(id)) {
        fc.remove(obj);
        objects.current.delete(id);
      }
    }

    // z-order: page backdrop stays at the bottom.
    [...layers]
      .sort((a, b) => a.z_index - b.z_index)
      .forEach((l) => {
        const o = objects.current.get(l.id);
        if (o) fc.bringObjectToFront(o);
      });

    fc.requestRenderAll();
  }, [layers]);

  // Guides are painted in after:render, so a change needs a repaint.
  useEffect(() => {
    fcRef.current?.requestRenderAll();
  }, [guides]);

  // ------------------------------------------------ selection → fabric ----
  useEffect(() => {
    const fc = fcRef.current;
    if (!fc) return;
    suppress.current = true;
    if (!selectedId) {
      fc.discardActiveObject();
    } else {
      const obj = objects.current.get(selectedId);
      if (obj && obj !== fc.getActiveObject()) fc.setActiveObject(obj);
    }
    fc.requestRenderAll();
    suppress.current = false;
  }, [selectedId]);

  // ------------------------------------------------------- external zoom ---
  useEffect(() => {
    const fc = fcRef.current;
    if (!fc) return;
    if (Math.abs(fc.getZoom() - zoom) < 0.001) return;
    const c = fc.getCenterPoint();
    fc.zoomToPoint(c, zoom);
  }, [zoom]);

  // -------------------------------------------------------- keyboard ------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never hijack typing in a field or a contenteditable.
      if (
        target &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod) {
        switch (key) {
          case "z":
            e.preventDefault();
            if (e.shiftKey) st.redo();
            else st.undo();
            return;
          case "y":
            e.preventDefault();
            st.redo();
            return;
          case "c":
            e.preventDefault();
            st.copySelection();
            return;
          case "x":
            e.preventDefault();
            st.cutSelection();
            return;
          case "v":
            e.preventDefault();
            st.paste();
            return;
          case "d":
            e.preventDefault();
            if (st.selectedId) st.duplicateLayer(st.selectedId);
            return;
          case "a":
            e.preventDefault();
            st.selectAll();
            return;
          case "s":
            // Autosave already covers this; swallow it so the browser doesn't
            // pop its "save page" dialog mid-edit.
            e.preventDefault();
            return;
          case "g":
            e.preventDefault();
            st.toggleGrid();
            return;
          case "0":
            e.preventDefault();
            fitToScreen();
            return;
          case "=":
          case "+":
            e.preventDefault();
            st.setZoom(Math.min(5, st.zoom * 1.2));
            return;
          case "-":
            e.preventDefault();
            st.setZoom(Math.max(0.05, st.zoom / 1.2));
            return;
          default:
            return;
        }
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (!st.selectedIds.length) return;
        e.preventDefault();
        st.selectedIds.forEach((id) => st.removeLayer(id));
        return;
      }

      if (e.key === "Escape") {
        st.select(null);
        return;
      }

      if (e.key.startsWith("Arrow")) {
        if (!st.selectedIds.length) return;
        e.preventDefault();
        // Shift nudges by a grid step, otherwise a single pixel.
        const step = e.shiftKey ? st.gridSize : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        st.nudge(dx, dy);
        return;
      }

      switch (key) {
        case "v": st.setTool("select"); break;
        case "h": st.setTool("pan"); break;
        case "p": st.setTool("panel"); break;
        case "t": st.setTool("text"); break;
        case "b": st.setTool("bubble"); break;
        case "u": st.setTool("shape"); break;
        case "f": st.setTool("sfx"); break;
        case "g": st.toggleGrid(); break;
        case "r": st.toggleRuler(); break;
        case "s": st.toggleSnap(); break;
        case "a": st.toggleAlign(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fitToScreen]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={elRef} />
      {rulerEnabled && <Rulers />}
      <button
        onClick={fitToScreen}
        className="absolute bottom-3 right-3 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        Fit
      </button>
    </div>
  );
}

/** Exposes the live fabric canvas for PNG export. */
export function getCanvasElement(): HTMLCanvasElement | null {
  return document.querySelector("canvas.lower-canvas");
}
