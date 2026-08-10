"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Page } from "@/lib/types";

export function PageStrip({
  pages,
  activeId,
  onSelect,
  onAdd,
  onDelete,
}: {
  pages: Page[];
  activeId: string | null;
  onSelect: (page: Page) => void;
  onAdd: () => void;
  onDelete: (page: Page) => void;
}) {
  return (
    <div className="flex w-28 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border p-2">
      {pages.map((p) => (
        <div key={p.id} className="group relative shrink-0">
          <button
            onClick={() => onSelect(p)}
            aria-label={`Page ${p.order_index}`}
            className={`w-full rounded-md border-2 bg-white/90 p-1 transition-colors ${
              p.id === activeId ? "border-primary" : "border-transparent hover:border-border"
            }`}
            style={{ aspectRatio: `${p.width} / ${p.height}` }}
          >
            <span className="text-[10px] font-medium text-zinc-600">
              {p.order_index}
            </span>
          </button>
          {pages.length > 1 && (
            <button
              onClick={() => onDelete(p)}
              title={`Delete page ${p.order_index}`}
              aria-label={`Delete page ${p.order_index}`}
              // Fades rather than display:none — a hover-only control is unreachable
              // on touch, and keyboard focus needs to be able to reveal it.
              className="absolute right-0.5 top-0.5 rounded bg-background/90 p-0.5 text-muted-foreground opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 hover:text-red-400"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onAdd}
        className="flex shrink-0 items-center justify-center gap-1 rounded-md border border-dashed border-border py-3 text-xs text-muted-foreground hover:border-primary hover:text-primary"
      >
        <Plus className="size-3.5" />
        Page
      </button>
    </div>
  );
}
