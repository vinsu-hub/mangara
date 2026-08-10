"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  Canvas as FabricCanvas,
  Ellipse,
  FabricImage,
  Pattern,
  Point,
  Rect,
  Textbox,
  type FabricObject,
  type TPointerEvent,
  type TPointerEventInfo,
} from "fabric";
import { useEditor } from "@/lib/store/editor";
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

export function EditorCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLCanvasElement>(null);
  const fcRef = useRef<FabricCanvas | null>(null);
  const objects = useRef(new Map<string, TaggedObject>());
  const pageRect = useRef<Rect | null>(null);

  // Fabric event handlers are registered once, so they'd otherwise close over
  // the first render's state. Refs keep them reading current values.
  const toolRef = useRef(useEditor.getState().tool);
  const draft = useRef<{ obj: Rect | Ellipse; x: number; y: number } | null>(null);
  const panning = useRef<{ x: number; y: number } | null>(null);
  const suppress = useRef(false);

  const page = useEditor((s) => s.page);
  const layers = useEditor((s) => s.layers);
  const selectedId = useEditor((s) => s.selectedId);
  const tool = useEditor((s) => s.tool);
  const zoom = useEditor((s) => s.zoom);

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
    if (!interactive) fc.discardActiveObject();
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
      const active = fc.getActiveObject() as TaggedObject | undefined;
      useEditor.getState().select(active?.layerId ?? null);
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

    fc.on("object:moving", (e) => writeBack(e.target as TaggedObject, true));
    fc.on("object:scaling", (e) => writeBack(e.target as TaggedObject, true));
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

    fc.on("mouse:move", (opt: TPointerEventInfo) => {
      if (panning.current) {
        const c = clientXY(opt.e);
        const dx = c.x - panning.current.x;
        const dy = c.y - panning.current.y;
        panning.current = c;
        fc.relativePan(new Point(dx, dy));
        return;
      }
      const d = draft.current;
      if (!d) return;
      const p = fc.getScenePoint(opt.e);
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

    // -- wheel zoom --------------------------------------------------------
    fc.on("mouse:wheel", (opt) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      let z = fc.getZoom() * 0.999 ** e.deltaY;
      z = Math.min(5, Math.max(0.05, z));
      fc.zoomToPoint(new Point(e.offsetX, e.offsetY), z);
      useEditor.getState().setZoom(z);
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
              : new Rect({ ...base, rx: layer.style.rx ?? 0 });

        created.layerId = layer.id;
        created.selectable = interactive;
        created.evented = interactive;
        objects.current.set(layer.id, created);
        fc.add(created);
        obj = created;
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
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const st = useEditor.getState();

      if ((e.key === "Delete" || e.key === "Backspace") && st.selectedId) {
        e.preventDefault();
        st.removeLayer(st.selectedId);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (st.selectedId) st.duplicateLayer(st.selectedId);
      } else if (e.key === "v") st.setTool("select");
      else if (e.key === "h") st.setTool("pan");
      else if (e.key === "p") st.setTool("panel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={elRef} />
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
