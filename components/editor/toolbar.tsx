"use client";

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
} from "lucide-react";
import { useEditor } from "@/lib/store/editor";
import type { ToolId } from "@/lib/types";

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

export function Toolbar({ onExport }: { onExport: (scale: number) => void }) {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const selectedId = useEditor((s) => s.selectedId);
  const removeLayer = useEditor((s) => s.removeLayer);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const saving = useEditor((s) => s.saving);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
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
  );
}
