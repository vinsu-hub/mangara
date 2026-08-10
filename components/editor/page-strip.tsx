"use client";

import { Plus } from "lucide-react";
import type { Page } from "@/lib/types";

export function PageStrip({
  pages,
  activeId,
  onSelect,
  onAdd,
}: {
  pages: Page[];
  activeId: string | null;
  onSelect: (page: Page) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex w-28 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border p-2">
      {pages.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p)}
          className={`shrink-0 rounded-md border-2 bg-white/90 p-1 transition-colors ${
            p.id === activeId ? "border-primary" : "border-transparent hover:border-border"
          }`}
          style={{ aspectRatio: `${p.width} / ${p.height}` }}
        >
          <span className="text-[10px] font-medium text-zinc-600">
            {p.order_index}
          </span>
        </button>
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
