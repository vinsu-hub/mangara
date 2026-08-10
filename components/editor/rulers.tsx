"use client";

import { useEditor } from "@/lib/store/editor";

export const RULER_SIZE = 20;

/** Pick a tick spacing that stays readable at the current zoom. */
function tickStep(zoom: number): number {
  for (const step of [50, 100, 200, 500, 1000, 2000]) {
    if (step * zoom >= 60) return step;
  }
  return 5000;
}

function ticksFor(extent: number, step: number) {
  const out: number[] = [];
  for (let v = 0; v <= extent; v += step) out.push(v);
  return out;
}

/**
 * Page-space rulers along the top and left edges, overlaid on the canvas.
 *
 * They read the viewport transform that the canvas mirrors into the store, so
 * they stay aligned through pan and zoom without the canvas having to know
 * they exist. Tick positions are shifted by RULER_SIZE because each ruler's
 * own coordinate space starts that far into the canvas.
 */
export function Rulers() {
  const { zoom, tx, ty } = useEditor((s) => s.viewport);
  const page = useEditor((s) => s.page);
  if (!page) return null;

  const step = tickStep(zoom);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div
        className="absolute left-0 top-0 border-b border-r border-border bg-card"
        style={{ width: RULER_SIZE, height: RULER_SIZE }}
      />

      <div
        className="absolute top-0 overflow-hidden border-b border-border bg-card"
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
            <span className="ml-1 text-[9px] leading-5 text-muted-foreground">{v}</span>
          </div>
        ))}
      </div>

      <div
        className="absolute left-0 overflow-hidden border-r border-border bg-card"
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
            <span className="ml-0.5 block text-[9px] leading-tight text-muted-foreground">
              {v}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
