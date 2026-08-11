import type { Geometry, Layer } from "@/lib/types";

/** How close, in *screen* pixels, an edge must be before it snaps. */
export const SNAP_THRESHOLD_PX = 7;

export interface Guides {
  /** Horizontal guides, stored as page-space y values. */
  h: number[];
  /** Vertical guides, stored as page-space x values. */
  v: number[];
}

/** Always a fresh object — a shared const would be one accidental push away
 *  from every page sharing the same guides. */
export const emptyGuides = (): Guides => ({ h: [], v: [] });

/** A line the canvas should draw to show why something snapped. */
export interface SnapLine {
  axis: "x" | "y";
  /** Page-space position of the line. */
  at: number;
  /** Extent of the line along the other axis, so it spans both objects. */
  from: number;
  to: number;
  /** Guides get their own colour, matching Photoshop's convention. */
  kind: "object" | "page" | "guide";
}

export interface SnapResult {
  dx: number;
  dy: number;
  lines: SnapLine[];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const boxOf = (g: Geometry): Box => ({ x: g.x, y: g.y, w: g.w, h: g.h });

/** The three lines an edge can align on, per axis. */
const xLines = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w];
const yLines = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h];

interface Candidate {
  at: number;
  from: number;
  to: number;
  kind: SnapLine["kind"];
}

/**
 * Computes the offset that aligns `moving` to nearby panels, page edges and
 * guides, plus the lines to draw so the user can see why.
 *
 * The threshold is given in screen pixels and divided by `zoom`, so the pull
 * feels the same whether you're at 26% or 300% — a fixed page-space threshold
 * would feel sticky when zoomed out and useless when zoomed in.
 */
export function computeSnap(
  moving: Geometry,
  others: Layer[],
  page: { width: number; height: number },
  guides: Guides,
  zoom: number
): SnapResult {
  const tolerance = SNAP_THRESHOLD_PX / Math.max(zoom, 0.0001);
  const box = boxOf(moving);

  const xCandidates: Candidate[] = [];
  const yCandidates: Candidate[] = [];

  for (const other of others) {
    const o = boxOf(other.geometry);
    for (const at of xLines(o)) {
      xCandidates.push({ at, from: o.y, to: o.y + o.h, kind: "object" });
    }
    for (const at of yLines(o)) {
      yCandidates.push({ at, from: o.x, to: o.x + o.w, kind: "object" });
    }
  }

  for (const at of [0, page.width / 2, page.width]) {
    xCandidates.push({ at, from: 0, to: page.height, kind: "page" });
  }
  for (const at of [0, page.height / 2, page.height]) {
    yCandidates.push({ at, from: 0, to: page.width, kind: "page" });
  }

  for (const at of guides.v) {
    xCandidates.push({ at, from: 0, to: page.height, kind: "guide" });
  }
  for (const at of guides.h) {
    yCandidates.push({ at, from: 0, to: page.width, kind: "guide" });
  }

  const best = (
    edges: number[],
    candidates: Candidate[]
  ): { delta: number; line: SnapLine } | null => {
    let winner: { delta: number; line: SnapLine; distance: number } | null = null;
    for (const edge of edges) {
      for (const c of candidates) {
        const distance = Math.abs(c.at - edge);
        if (distance > tolerance) continue;
        if (winner && distance >= winner.distance) continue;
        winner = {
          distance,
          delta: c.at - edge,
          line: { axis: "x", at: c.at, from: c.from, to: c.to, kind: c.kind },
        };
      }
    }
    return winner ? { delta: winner.delta, line: winner.line } : null;
  };

  const x = best(xLines(box), xCandidates);
  const y = best(yLines(box), yCandidates);

  const lines: SnapLine[] = [];
  if (x) lines.push({ ...x.line, axis: "x" });
  if (y) lines.push({ ...y.line, axis: "y" });

  return { dx: x?.delta ?? 0, dy: y?.delta ?? 0, lines };
}

/**
 * Snap for a resize: only the edges being dragged move, so the caller says
 * which ones those are and gets back the corrected width/height.
 */
export function computeResizeSnap(
  moving: Geometry,
  others: Layer[],
  page: { width: number; height: number },
  guides: Guides,
  zoom: number
): { w: number; h: number; lines: SnapLine[] } {
  const tolerance = SNAP_THRESHOLD_PX / Math.max(zoom, 0.0001);
  const right = moving.x + moving.w;
  const bottom = moving.y + moving.h;

  const xTargets = [
    ...others.flatMap((o) => xLines(boxOf(o.geometry))),
    0,
    page.width / 2,
    page.width,
    ...guides.v,
  ];
  const yTargets = [
    ...others.flatMap((o) => yLines(boxOf(o.geometry))),
    0,
    page.height / 2,
    page.height,
    ...guides.h,
  ];

  const nearest = (value: number, targets: number[]) => {
    let hit: number | null = null;
    let dist = tolerance;
    for (const t of targets) {
      const d = Math.abs(t - value);
      if (d <= dist) {
        dist = d;
        hit = t;
      }
    }
    return hit;
  };

  const snappedRight = nearest(right, xTargets);
  const snappedBottom = nearest(bottom, yTargets);

  const lines: SnapLine[] = [];
  if (snappedRight !== null) {
    lines.push({
      axis: "x",
      at: snappedRight,
      from: 0,
      to: page.height,
      kind: "object",
    });
  }
  if (snappedBottom !== null) {
    lines.push({
      axis: "y",
      at: snappedBottom,
      from: 0,
      to: page.width,
      kind: "object",
    });
  }

  return {
    w: snappedRight !== null ? Math.max(8, snappedRight - moving.x) : moving.w,
    h: snappedBottom !== null ? Math.max(8, snappedBottom - moving.y) : moving.h,
    lines,
  };
}
