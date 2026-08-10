import type { Geometry, Layer } from "@/lib/types";

/** A cell in normalised page space: 0..1 on both axes, before gutters. */
interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageLayout {
  id: string;
  name: string;
  hint: string;
  cells: Cell[];
}

/**
 * Common manga page constructions. Normalised so one template works at any
 * page size; the gutter is applied in real pixels at instantiation, because a
 * proportional gutter would look wrong across different page dimensions.
 */
export const LAYOUTS: PageLayout[] = [
  {
    id: "3-tier",
    name: "3 tiers",
    hint: "Three full-width rows — the workhorse manga page",
    cells: [
      { x: 0, y: 0, w: 1, h: 1 / 3 },
      { x: 0, y: 1 / 3, w: 1, h: 1 / 3 },
      { x: 0, y: 2 / 3, w: 1, h: 1 / 3 },
    ],
  },
  {
    id: "grid-2x2",
    name: "2 × 2 grid",
    hint: "Four equal panels",
    cells: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: "splash",
    name: "Splash",
    hint: "One full-bleed panel for a big moment",
    cells: [{ x: 0, y: 0, w: 1, h: 1 }],
  },
  {
    id: "vertical-4",
    name: "4 stacked",
    hint: "Four wide rows — good for quiet beats",
    cells: [
      { x: 0, y: 0, w: 1, h: 0.25 },
      { x: 0, y: 0.25, w: 1, h: 0.25 },
      { x: 0, y: 0.5, w: 1, h: 0.25 },
      { x: 0, y: 0.75, w: 1, h: 0.25 },
    ],
  },
  {
    id: "two-top-wide",
    name: "2 top + wide",
    hint: "Two beats, then a wide establishing shot",
    cells: [
      { x: 0, y: 0, w: 0.5, h: 0.42 },
      { x: 0.5, y: 0, w: 0.5, h: 0.42 },
      { x: 0, y: 0.42, w: 1, h: 0.58 },
    ],
  },
  {
    id: "manga-6",
    name: "6 panel",
    hint: "Wide opener, two pairs, wide closer",
    cells: [
      { x: 0, y: 0, w: 1, h: 0.22 },
      { x: 0, y: 0.22, w: 0.5, h: 0.26 },
      { x: 0.5, y: 0.22, w: 0.5, h: 0.26 },
      { x: 0, y: 0.48, w: 0.5, h: 0.26 },
      { x: 0.5, y: 0.48, w: 0.5, h: 0.26 },
      { x: 0, y: 0.74, w: 1, h: 0.26 },
    ],
  },
];

export const DEFAULT_GUTTER = 24;
export const PAGE_MARGIN = 64;

/**
 * Turns a template into concrete panel geometry for a page. Gutters are taken
 * out of each cell's edges rather than added between them, so the outer
 * margin stays exact and panels never overhang the page.
 */
export function instantiateLayout(
  layout: PageLayout,
  pageWidth: number,
  pageHeight: number,
  gutter = DEFAULT_GUTTER,
  margin = PAGE_MARGIN
): Geometry[] {
  const innerW = pageWidth - margin * 2;
  const innerH = pageHeight - margin * 2;
  const half = gutter / 2;

  return layout.cells.map((c) => {
    const x = margin + c.x * innerW;
    const y = margin + c.y * innerH;
    const w = c.w * innerW;
    const h = c.h * innerH;

    // Only inset edges that sit against a neighbour, so the page margin is
    // preserved on the outside.
    const left = c.x > 0 ? half : 0;
    const top = c.y > 0 ? half : 0;
    const right = c.x + c.w < 0.999 ? half : 0;
    const bottom = c.y + c.h < 0.999 ? half : 0;

    return {
      x: Math.round(x + left),
      y: Math.round(y + top),
      w: Math.round(w - left - right),
      h: Math.round(h - top - bottom),
      rotation: 0,
      shape: "rectangle",
    };
  });
}

/**
 * Splits a panel in two along the given axis, leaving a gutter between the
 * halves. Returns the geometry for both; the caller decides which one keeps
 * the original panel's content.
 */
export function splitGeometry(
  g: Geometry,
  axis: "horizontal" | "vertical",
  gutter = DEFAULT_GUTTER
): [Geometry, Geometry] {
  const half = gutter / 2;

  if (axis === "vertical") {
    const w = (g.w - gutter) / 2;
    return [
      { ...g, w: Math.round(w) },
      { ...g, x: Math.round(g.x + w + gutter), w: Math.round(w) },
    ];
  }

  const h = (g.h - gutter) / 2;
  return [
    { ...g, h: Math.round(h) },
    { ...g, y: Math.round(g.y + h + gutter), h: Math.round(h) },
  ];
}

/** Bounding box of several layers — used by Merge. */
export function mergeGeometry(layers: Layer[]): Geometry {
  const xs = layers.map((l) => l.geometry.x);
  const ys = layers.map((l) => l.geometry.y);
  const rs = layers.map((l) => l.geometry.x + l.geometry.w);
  const bs = layers.map((l) => l.geometry.y + l.geometry.h);
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return {
    x,
    y,
    w: Math.max(...rs) - x,
    h: Math.max(...bs) - y,
    rotation: 0,
    shape: "rectangle",
  };
}
