"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import { useEditor } from "@/lib/store/editor";
import {
  createPage,
  deletePage,
  getFirstChapter,
  listPages,
  loadLayers,
  saveLayers,
} from "@/lib/pages";
import type { Layer, Page } from "@/lib/types";
import { errorMessage } from "@/lib/errors";
import { Toolbar } from "./toolbar";
import { Inspector } from "./inspector";
import { PageStrip } from "./page-strip";

// Fabric touches `window` at module scope, so it can never render on the server.
const EditorCanvas = dynamic(
  () => import("./canvas").then((m) => m.EditorCanvas),
  { ssr: false, loading: () => <div className="flex-1 bg-muted/20" /> }
);

const AUTOSAVE_MS = 800;
const POLL_MS = 2000;

export function Editor({ projectId }: { projectId: string }) {
  const supabase = useRef(createClient()).current;
  const [pages, setPages] = useState<Page[]>([]);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const page = useEditor((s) => s.page);
  const layers = useEditor((s) => s.layers);
  const loadPage = useEditor((s) => s.loadPage);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(true);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ------------------------------------------------------------- load ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const chapter = await getFirstChapter(supabase, projectId);
        if (cancelled) return;
        setChapterId(chapter.id);

        let list = await listPages(supabase, chapter.id);
        if (!list.length) list = [await createPage(supabase, chapter.id, 1)];
        if (cancelled) return;
        setPages(list);

        // The Story Board can ask for a specific page; honour it, then clear
        // the request so a later reload doesn't jump back to it.
        const requested = useEditor.getState().requestedPageId;
        const first = (requested && list.find((pg) => pg.id === requested)) || list[0];
        if (requested) useEditor.getState().requestPage(null);

        const initial = await loadLayers(supabase, first.id);
        if (cancelled) return;
        skipNextSave.current = true;
        loadPage(first, initial);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, supabase, loadPage]);

  // --------------------------------------------------------- autosave ----
  useEffect(() => {
    if (!page) return;
    // Loading a page shouldn't immediately write it back.
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    useEditor.getState().setSaving(true);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveLayers(supabase, page.id, layers);
        useEditor.getState().markSaved();
      } catch (e) {
        useEditor.getState().setSaving(false);
        setError(errorMessage(e));
      }
    }, AUTOSAVE_MS);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [layers, page, supabase]);

  // ------------------------------------------- poll pending generations ---
  useEffect(() => {
    const pending = layers.filter(
      (l) => l.generation_status === "queued" || l.generation_status === "generating"
    );
    if (!pending.length) {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    if (pollTimer.current) return;

    pollTimer.current = setInterval(async () => {
      const ids = useEditor
        .getState()
        .layers.filter(
          (l) =>
            l.generation_status === "queued" || l.generation_status === "generating"
        )
        .map((l) => l.id);
      if (!ids.length) return;

      const { data } = await supabase
        .from("panels")
        .select("id, image_url, generation_status, last_provider")
        .in("id", ids);

      for (const row of data ?? []) {
        const current = useEditor.getState().layers.find((l) => l.id === row.id);
        if (!current || current.generation_status === row.generation_status) continue;
        useEditor.getState().updateLayer(
          row.id,
          {
            image_url: row.image_url,
            generation_status: row.generation_status,
            last_provider: row.last_provider,
          },
          true
        );
      }
    }, POLL_MS);

    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [layers, supabase]);

  // ------------------------------------------------------------ actions ---
  const switchPage = useCallback(
    async (next: Page) => {
      if (page && saveTimer.current) {
        clearTimeout(saveTimer.current);
        await saveLayers(supabase, page.id, useEditor.getState().layers);
      }
      const next_layers = await loadLayers(supabase, next.id);
      skipNextSave.current = true;
      loadPage(next, next_layers);
    },
    [page, supabase, loadPage]
  );

  const addPage = useCallback(async () => {
    if (!chapterId) return;
    const created = await createPage(supabase, chapterId, pages.length + 1);
    setPages((p) => [...p, created]);
    skipNextSave.current = true;
    loadPage(created, []);
  }, [chapterId, pages.length, supabase, loadPage]);

  const removePage = useCallback(
    async (target: Page) => {
      if (pages.length <= 1) return;
      if (
        !window.confirm(
          `Delete page ${target.order_index} and everything on it? This cannot be undone.`
        )
      ) {
        return;
      }
      try {
        await deletePage(supabase, target.id);
        const remaining = pages.filter((pg) => pg.id !== target.id);
        setPages(remaining);
        if (page?.id === target.id && remaining.length) {
          const next = remaining[0];
          skipNextSave.current = true;
          loadPage(next, await loadLayers(supabase, next.id));
        }
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [pages, page, supabase, loadPage]
  );

  const generate = useCallback(
    async (layer: Layer) => {
      // Persist before generating: the server reads the panel row by id.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (page) await saveLayers(supabase, page.id, useEditor.getState().layers);

      useEditor.getState().updateLayer(layer.id, { generation_status: "queued" }, true);
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            panelId: layer.id,
            prompt: layer.prompt,
            width: layer.geometry.w,
            height: layer.geometry.h,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
      } catch (e) {
        useEditor.getState().updateLayer(layer.id, { generation_status: "failed" }, true);
        setError(errorMessage(e));
      }
    },
    [page, supabase]
  );

  const exportPng = useCallback(
    (scale: number) => {
      const el = document.querySelector<HTMLCanvasElement>("canvas.lower-canvas");
      if (!el || !page) return;
      // Re-render from the page's own resolution rather than the zoomed
      // viewport, so export quality doesn't follow whatever zoom you're at.
      const out = document.createElement("canvas");
      out.width = page.width * scale;
      out.height = page.height * scale;
      const ctx = out.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(el, 0, 0, out.width, out.height);
      out.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `page-${page.order_index}${scale > 1 ? `@${scale}x` : ""}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    },
    [page]
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      <PageStrip
        pages={pages}
        activeId={page?.id ?? null}
        onSelect={switchPage}
        onAdd={addPage}
        onDelete={removePage}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Toolbar onExport={exportPng} />
        {error && (
          <div className="border-b border-red-900/50 bg-red-950/40 px-3 py-1.5 text-xs text-red-400">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">
              dismiss
            </button>
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <EditorCanvas />
        </div>
        <div className="flex shrink-0 items-center gap-4 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span>Page {page?.order_index ?? "–"}</span>
          <span>{layers.length} layers</span>
          <span className="ml-auto">{Math.round(useEditor.getState().zoom * 100)}%</span>
        </div>
      </div>
      <Inspector onGenerate={generate} />
    </div>
  );
}
