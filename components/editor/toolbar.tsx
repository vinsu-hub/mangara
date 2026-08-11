"use client";

import { useState } from "react";
import {
  MousePointer2,
  Hand,
  Square,
  PenTool,
  Circle,
  Type,
  MessageCircle,
  Sparkles,
  Copy,
  Trash2,
  Undo2,
  Redo2,
  Download,
  SplitSquareHorizontal,
  SplitSquareVertical,
  Combine,
  LayoutTemplate,
  Spline,
  Pentagon,
  ChevronDown,
  Grid3x3,
  Magnet,
  Ruler,
  AlignHorizontalDistributeCenter,
  Eraser,
} from "lucide-react";
import { useEditor } from "@/lib/store/editor";
import { LAYOUTS, instantiateLayout } from "@/lib/layouts";
import { GRID_SIZES } from "@/lib/store/editor";
import type { PanelShape, ToolId } from "@/lib/types";
import { useConfirm } from "@/components/confirm-provider";

const TOOLS: { id: ToolId; label: string; icon: typeof Square; key?: string }[] = [
  { id: "select", label: "Select", icon: MousePointer2, key: "V" },
  { id: "pan", label: "Pan", icon: Hand, key: "H" },
  { id: "panel", label: "Panel", icon: Square, key: "P" },
  { id: "pen", label: "Pen", icon: PenTool },
  { id: "shape", label: "Shape", icon: Circle },
  { id: "text", label: "Text", icon: Type },
  { id: "bubble", label: "Bubble", icon: MessageCircle },
  { id: "sfx", label: "SFX", icon: Sparkles },
];

const SHAPES: { id: PanelShape; label: string; icon: typeof Square }[] = [
  { id: "rectangle", label: "Rectangle", icon: Square },
  { id: "polygon", label: "Polygon", icon: Pentagon },
  { id: "freeform", label: "Freeform", icon: Spline },
];

export function Toolbar({ onExport }: { onExport: (scale: number) => void }) {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const shapeMode = useEditor((s) => s.shapeMode);
  const setShapeMode = useEditor((s) => s.setShapeMode);
  const selectedId = useEditor((s) => s.selectedId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const page = useEditor((s) => s.page);
  const removeLayer = useEditor((s) => s.removeLayer);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const splitLayer = useEditor((s) => s.splitLayer);
  const mergeLayers = useEditor((s) => s.mergeLayers);
  const applyLayout = useEditor((s) => s.applyLayout);
  const layerCount = useEditor((s) => s.layers.length);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const saving = useEditor((s) => s.saving);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);

  const gridEnabled = useEditor((s) => s.gridEnabled);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const rulerEnabled = useEditor((s) => s.rulerEnabled);
  const gridSize = useEditor((s) => s.gridSize);
  const toggleGrid = useEditor((s) => s.toggleGrid);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const toggleRuler = useEditor((s) => s.toggleRuler);
  const setGridSize = useEditor((s) => s.setGridSize);
  const alignEnabled = useEditor((s) => s.alignEnabled);
  const toggleAlign = useEditor((s) => s.toggleAlign);
  const clearGuides = useEditor((s) => s.clearGuides);
  const guideCount = useEditor((s) => s.guides.h.length + s.guides.v.length);

  const [layoutOpen, setLayoutOpen] = useState(false);
  const confirm = useConfirm();

  const applyTemplate = async (layoutId: string) => {
    const layout = LAYOUTS.find((l) => l.id === layoutId);
    if (!layout || !page) return;
    setLayoutOpen(false);

    // An empty page has nothing to lose, so don't ask.
    let replace = true;
    if (layerCount > 0) {
      const choice = await confirm({
        title: `Apply the "${layout.name}" layout?`,
        description:
          "This page already has panels. Replacing swaps them for the layout; " +
          "adding keeps them and puts the layout on top. Either way you can undo it.",
        actions: [
          { id: "alongside", label: "Add alongside", variant: "ghost" },
          { id: "replace", label: "Replace panels" },
        ],
      });
      if (choice === null) return;
      replace = choice === "replace";
    }

    applyLayout(instantiateLayout(layout, page.width, page.height), replace);
  };

  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex items-center gap-1 px-3 py-2">
        {TOOLS.map(({ id, label, icon: Icon, key }) => (
          <button
            key={id}
            onClick={() => setTool(id)}
            title={key ? `${label} (${key})` : label}
            className={`flex flex-col items-center gap-1 rounded-md px-3 py-1.5 text-[10px] transition-colors ${
              tool === id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}

        <div className="mx-2 h-8 w-px bg-border" />

        <button
          onClick={() => selectedId && duplicateLayer(selectedId)}
          disabled={!selectedId}
          title="Duplicate (Ctrl+D)"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <Copy className="size-4" />
        </button>
        <button
          onClick={() => selectedId && removeLayer(selectedId)}
          disabled={!selectedId}
          title="Delete"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <Trash2 className="size-4" />
        </button>
        <button
          onClick={undo}
          disabled={past === 0}
          title="Undo (Ctrl+Z)"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <Undo2 className="size-4" />
        </button>
        <button
          onClick={redo}
          disabled={future === 0}
          title="Redo (Ctrl+Shift+Z)"
          className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
        >
          <Redo2 className="size-4" />
        </button>

        <div className="mx-2 h-8 w-px bg-border" />

        <button
          onClick={toggleGrid}
          title="Grid (G)"
          aria-pressed={gridEnabled}
          className={`rounded-md p-2 transition-colors ${
            gridEnabled
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Grid3x3 className="size-4" />
        </button>
        <button
          onClick={toggleSnap}
          title="Snap to grid (S)"
          aria-pressed={snapEnabled}
          className={`rounded-md p-2 transition-colors ${
            snapEnabled
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Magnet className="size-4" />
        </button>
        <button
          onClick={toggleAlign}
          title="Align to other panels (A)"
          aria-pressed={alignEnabled}
          className={`rounded-md p-2 transition-colors ${
            alignEnabled
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <AlignHorizontalDistributeCenter className="size-4" />
        </button>
        <button
          onClick={toggleRuler}
          title="Rulers (R)"
          aria-pressed={rulerEnabled}
          className={`rounded-md p-2 transition-colors ${
            rulerEnabled
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Ruler className="size-4" />
        </button>
        {guideCount > 0 && (
          <button
            onClick={clearGuides}
            title={`Clear ${guideCount} guide${guideCount === 1 ? "" : "s"}`}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Eraser className="size-4" />
          </button>
        )}
        <select
          value={gridSize}
          aria-label="Grid size"
          onChange={(e) => setGridSize(Number(e.target.value))}
          className="rounded-md border border-border bg-background px-1 py-1 text-[11px] text-muted-foreground outline-none focus:border-primary"
        >
          {GRID_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}px
            </option>
          ))}
        </select>

        <div className="mx-2 h-8 w-px bg-border" />

        <button
          onClick={() => onExport(1)}
          title="Export PNG"
          className="flex items-center gap-1.5 rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Download className="size-4" />
          PNG
        </button>
        <button
          onClick={() => onExport(2)}
          title="Export PNG at 2x (print)"
          className="rounded-md px-2 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          2x
        </button>

        <div className="ml-auto text-xs text-muted-foreground">
          {saving
            ? "Saving…"
            : lastSavedAt
              ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
              : ""}
        </div>
      </div>

      {/* Panel sub-toolbar — the layouting row, only while the Panel tool is up. */}
      {tool === "panel" && (
        <div className="flex items-center gap-1 border-t border-border bg-muted/30 px-3 py-1.5">
          {SHAPES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setShapeMode(id)}
              title={`${label} panel`}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                shapeMode === id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}

          <div className="mx-2 h-5 w-px bg-border" />

          <button
            onClick={() => selectedId && splitLayer(selectedId, "vertical")}
            disabled={!selectedId}
            title="Split into left and right"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <SplitSquareHorizontal className="size-3.5" />
            Split V
          </button>
          <button
            onClick={() => selectedId && splitLayer(selectedId, "horizontal")}
            disabled={!selectedId}
            title="Split into top and bottom"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <SplitSquareVertical className="size-3.5" />
            Split H
          </button>
          <button
            onClick={() => mergeLayers(selectedIds)}
            disabled={selectedIds.length < 2}
            title="Merge the selected panels (shift-click to select more than one)"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <Combine className="size-3.5" />
            Merge
          </button>

          <div className="mx-2 h-5 w-px bg-border" />

          <div className="relative">
            <button
              onClick={() => setLayoutOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LayoutTemplate className="size-3.5" />
              Layout
              <ChevronDown className="size-3" />
            </button>
            {layoutOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-border bg-card p-1 shadow-xl">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => applyTemplate(l.id)}
                    className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  >
                    <span className="text-xs font-medium">{l.name}</span>
                    <span className="text-[11px] text-muted-foreground">{l.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="ml-auto text-[11px] text-muted-foreground">
            {shapeMode === "polygon"
              ? "Click to place points, double-click to close"
              : shapeMode === "freeform"
                ? "Drag to trace an outline"
                : "Drag on the page to draw a panel"}
          </span>
        </div>
      )}
    </div>
  );
}
