"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "@/lib/store/editor";

export const RULER_SIZE = 22;

/** Pick a tick spacing that stays readable at the current zoom. */
function tickStep(zoom: number): number {
  for (const step of [50, 100, 200, 500, 1000, 2000]) {
    if (step * zoom >= 64) return step;
  }
  return 5000;
}

function ticksFor(extent: number, step: number) {
  const out: number[] = [];
  for (let v = 0; v <= extent; v += step) out.push(v);
  return out;
}

type Drag =
  | { axis: "h" | "v"; index: number; mode: "move" }
  | { axis: "h" | "v"; index: -1; mode: "create" };

/**
 * Page-space rulers with Photoshop-style guides.
 *
 * Press on a ruler to pull out a new guide; grab an existing one to move it;
 * drop either back onto its ruler to delete it. Positions are read from the
 * viewport transform the canvas mirrors into the store, so guides track pan
 * and zoom without the canvas needing to know this component exists.
 */
export function Rulers() {
  const { zoom, tx, ty } = useEditor((s) => s.viewport);
  const page = useEditor((s) => s.page);
  const guides = useEditor((s) => s.guides);
  const addGuide = useEditor((s) => s.addGuide);
  const moveGuide = useEditor((s) => s.moveGuide);
  const removeGuide = useEditor((s) => s.removeGuide);

  const hostRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<number | null>(null);

  /** Pointer position -> page coordinate on the given axis. */
  const toPage = useCallback(
    (e: PointerEvent | React.PointerEvent, axis: "h" | "v") => {
      const host = hostRef.current;
      if (!host) return 0;
      const r = host.getBoundingClientRect();
      return axis === "v"
        ? (e.clientX - r.left - tx) / zoom
        : (e.clientY - r.top - ty) / zoom;
    },
    [tx, ty, zoom]
  );

  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      const at = toPage(e, drag.axis);
      setPreview(at);
      if (drag.mode === "move") moveGuide(drag.axis, drag.index, at);
    };

    const onUp = (e: PointerEvent) => {
      const host = hostRef.current;
      const at = toPage(e, drag.axis);
      // Dropping back over the ruler strip means "get rid of it", the same
      // gesture Photoshop uses.
      let overRuler = false;
      if (host) {
        const r = host.getBoundingClientRect();
        overRuler =
          drag.axis === "v"
            ? e.clientX - r.left < RULER_SIZE
            : e.clientY - r.top < RULER_SIZE;
      }

      if (drag.mode === "create") {
        if (!overRuler) addGuide(drag.axis, at);
      } else if (overRuler) {
        removeGuide(drag.axis, drag.index);
      }

      setDrag(null);
      setPreview(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, toPage, addGuide, moveGuide, removeGuide]);

  if (!page) return null;
  const step = tickStep(zoom);

  const rulerBase =
    "absolute bg-card/95 font-mono text-[9px] tabular-nums text-muted-foreground";

  return (
    // The host spans the canvas but only the two strips take pointer events,
    // so the canvas underneath keeps working normally.
    <div ref={hostRef} className="pointer-events-none absolute inset-0 z-10">
      <div
        className={`${rulerBase} left-0 top-0 border-b border-r border-border`}
        style={{ width: RULER_SIZE, height: RULER_SIZE }}
      />

      {/* horizontal ruler — drags out horizontal guides */}
      <div
        role="presentation"
        aria-label="Horizontal ruler"
        onPointerDown={(e) => {
          e.preventDefault();
          setDrag({ axis: "h", index: -1, mode: "create" });
          setPreview(toPage(e, "h"));
        }}
        className={`${rulerBase} pointer-events-auto top-0 cursor-ns-resize overflow-hidden border-b border-border`}
        style={{ left: RULER_SIZE, right: 0, height: RULER_SIZE }}
      >
        <div
          className="absolute top-0 h-full bg-primary/10"
          style={{ left: tx - RULER_SIZE, width: Math.max(0, page.width * zoom) }}
        />
        {ticksFor(page.width, step).map((v) => (
          <div
            key={v}
            className="absolute top-0 h-full border-l border-border"
            style={{ left: tx + v * zoom - RULER_SIZE }}
          >
            <span className="ml-1 leading-[22px]">{v}</span>
          </div>
        ))}
      </div>

      {/* vertical ruler — drags out vertical guides */}
      <div
        role="presentation"
        aria-label="Vertical ruler"
        onPointerDown={(e) => {
          e.preventDefault();
          setDrag({ axis: "v", index: -1, mode: "create" });
          setPreview(toPage(e, "v"));
        }}
        className={`${rulerBase} pointer-events-auto left-0 cursor-ew-resize overflow-hidden border-r border-border`}
        style={{ top: RULER_SIZE, bottom: 0, width: RULER_SIZE }}
      >
        <div
          className="absolute left-0 w-full bg-primary/10"
          style={{ top: ty - RULER_SIZE, height: Math.max(0, page.height * zoom) }}
        />
        {ticksFor(page.height, step).map((v) => (
          <div
            key={v}
            className="absolute left-0 w-full border-t border-border"
            style={{ top: ty + v * zoom - RULER_SIZE }}
          >
            <span className="ml-0.5 block leading-tight">{v}</span>
          </div>
        ))}
      </div>

      {/* grab handles sitting over each guide, so they can be moved or removed */}
      {guides.v.map((x, i) => (
        <div
          key={`v-${i}`}
          aria-label={`Vertical guide ${i + 1}`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDrag({ axis: "v", index: i, mode: "move" });
          }}
          className="pointer-events-auto absolute cursor-ew-resize"
          style={{ left: tx + x * zoom - 4, top: RULER_SIZE, width: 9, bottom: 0 }}
        />
      ))}
      {guides.h.map((y, i) => (
        <div
          key={`h-${i}`}
          aria-label={`Horizontal guide ${i + 1}`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDrag({ axis: "h", index: i, mode: "move" });
          }}
          className="pointer-events-auto absolute cursor-ns-resize"
          style={{ top: ty + y * zoom - 4, left: RULER_SIZE, height: 9, right: 0 }}
        />
      ))}

      {/* live preview while pulling a new guide out */}
      {drag?.mode === "create" && preview !== null && (
        <div
          className="absolute bg-cyan-400"
          style={
            drag.axis === "v"
              ? { left: tx + preview * zoom, top: 0, width: 1, bottom: 0 }
              : { top: ty + preview * zoom, left: 0, height: 1, right: 0 }
          }
        />
      )}
    </div>
  );
}
