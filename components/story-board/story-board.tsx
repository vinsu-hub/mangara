"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Circle, Plus, Search, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import {
  createBeat,
  createChapter,
  createScene,
  deleteBeat,
  deleteScene,
  getChapterStats,
  listBeats,
  listChapters,
  listScenes,
  listSceneCharacterIds,
  setSceneCharacter,
  updateScene,
  type ChapterStats,
} from "@/lib/story";
import { listCharacters } from "@/lib/characters";
import type { Beat, Chapter, Character, Scene, SceneTag } from "@/lib/types";

const TABS = ["Chapters", "Scenes", "Beats", "Outline"] as const;
type Tab = (typeof TABS)[number];

const TAG_LABEL: Record<SceneTag, string> = {
  establishing: "Establishing",
  rising_action: "Rising Action",
  climax: "Climax",
  falling_action: "Falling Action",
  resolution: "Resolution",
};

const TAG_CLASS: Record<SceneTag, string> = {
  establishing: "bg-primary/15 text-primary",
  rising_action: "bg-primary/15 text-primary",
  climax: "bg-amber-500/15 text-amber-500",
  falling_action: "bg-sky-500/15 text-sky-400",
  resolution: "bg-emerald-500/15 text-emerald-400",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function ProgressRing({ value }: { value: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 44 44" className="size-11 -rotate-90">
      <circle cx="22" cy="22" r={r} className="fill-none stroke-border" strokeWidth="4" />
      <circle
        cx="22"
        cy="22"
        r={r}
        className="fill-none stroke-emerald-500"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value / 100)}
      />
    </svg>
  );
}

export function StoryBoard({ projectId }: { projectId: string }) {
  const supabase = useRef(createClient()).current;

  const [tab, setTab] = useState<Tab>("Chapters");
  const [query, setQuery] = useState("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [stats, setStats] = useState<Record<string, ChapterStats>>({});
  const [activeChapter, setActiveChapter] = useState<string | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const [beats, setBeats] = useState<Beat[]>([]);
  const [sceneChars, setSceneChars] = useState<string[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [allScenes, setAllScenes] = useState<Record<string, Scene[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // ------------------------------------------------------------- loading ---
  const loadChapters = useCallback(async () => {
    const list = await listChapters(supabase, projectId);
    setChapters(list);
    const entries = await Promise.all(
      list.map(async (c) => [c.id, await getChapterStats(supabase, c.id)] as const)
    );
    setStats(Object.fromEntries(entries));
    const scenesByChapter = await Promise.all(
      list.map(async (c) => [c.id, await listScenes(supabase, c.id)] as const)
    );
    setAllScenes(Object.fromEntries(scenesByChapter));
    return list;
  }, [projectId, supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, chars] = await Promise.all([
          loadChapters(),
          listCharacters(supabase, projectId),
        ]);
        if (cancelled) return;
        setCharacters(chars);
        if (list.length) setActiveChapter((prev) => prev ?? list[0].id);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadChapters, projectId, supabase]);

  useEffect(() => {
    if (!activeChapter) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listScenes(supabase, activeChapter);
        if (cancelled) return;
        setScenes(list);
        setActiveScene(list[0]?.id ?? null);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChapter, supabase]);

  useEffect(() => {
    if (!activeScene) {
      setBeats([]);
      setSceneChars([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [b, ids] = await Promise.all([
          listBeats(supabase, activeScene),
          listSceneCharacterIds(supabase, activeScene),
        ]);
        if (cancelled) return;
        setBeats(b);
        setSceneChars(ids);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeScene, supabase]);

  // ------------------------------------------------------------- actions ---
  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const addChapter = () =>
    guard(async () => {
      const created = await createChapter(
        supabase,
        projectId,
        `Chapter ${chapters.length + 1}`,
        chapters.length + 1
      );
      setChapters((c) => [...c, created]);
      setActiveChapter(created.id);
      await loadChapters();
    });

  const addScene = () =>
    guard(async () => {
      if (!activeChapter) return;
      const created = await createScene(supabase, activeChapter, scenes.length + 1);
      setScenes((s) => [...s, created]);
      setActiveScene(created.id);
      await loadChapters();
    });

  const patchScene = (id: string, patch: Partial<Scene>) => {
    setScenes((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    void guard(() => updateScene(supabase, id, patch));
  };

  const removeScene = (id: string) =>
    guard(async () => {
      await deleteScene(supabase, id);
      setScenes((s) => s.filter((x) => x.id !== id));
      if (activeScene === id) setActiveScene(null);
      await loadChapters();
    });

  const addBeat = () =>
    guard(async () => {
      if (!activeScene) return;
      const created = await createBeat(
        supabase,
        activeScene,
        "New beat",
        beats.length + 1
      );
      setBeats((b) => [...b, created]);
    });

  const removeBeat = (id: string) =>
    guard(async () => {
      await deleteBeat(supabase, id);
      setBeats((b) => b.filter((x) => x.id !== id));
    });

  const toggleCharacter = (characterId: string) =>
    guard(async () => {
      if (!activeScene) return;
      const present = sceneChars.includes(characterId);
      await setSceneCharacter(supabase, activeScene, characterId, !present);
      setSceneChars((ids) =>
        present ? ids.filter((i) => i !== characterId) : [...ids, characterId]
      );
    });

  // --------------------------------------------------------------- derived ---
  const chapter = chapters.find((c) => c.id === activeChapter) ?? null;
  const scene = scenes.find((s) => s.id === activeScene) ?? null;
  const chapterStat = activeChapter ? stats[activeChapter] : undefined;
  const progress = chapterStat?.panelCount
    ? Math.round((chapterStat.approvedCount / chapterStat.panelCount) * 100)
    : 0;

  const filteredChapters = useMemo(
    () =>
      chapters.filter((c) =>
        query ? c.title.toLowerCase().includes(query.toLowerCase()) : true
      ),
    [chapters, query]
  );

  const flatScenes = useMemo(
    () =>
      Object.entries(allScenes).flatMap(([chapterId, list]) =>
        list.map((s) => ({
          scene: s,
          chapter: chapters.find((c) => c.id === chapterId) ?? null,
        }))
      ),
    [allScenes, chapters]
  );

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading story board…
      </main>
    );
  }

  return (
    <main className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* header */}
        <div className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <h1 className="text-lg font-semibold tracking-tight">STORY BOARD</h1>
              <p className="text-xs text-muted-foreground">
                Plan your story, scenes, and panel flow.
              </p>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chapters, scenes…"
                className="w-56 rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-primary"
              />
            </div>
            <button
              onClick={addChapter}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              <Plus className="size-3.5" />
              New Chapter
            </button>
          </div>

          <div className="mt-3 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-xs transition-colors ${
                  tab === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="border-b border-red-900/50 bg-red-950/40 px-4 py-1.5 text-xs text-red-400">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">
              dismiss
            </button>
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {tab === "Chapters" && (
            <>
              {/* chapter list */}
              <div className="w-56 shrink-0 overflow-y-auto border-r border-border p-3">
                <p className="mb-2 text-[10px] tracking-wide text-muted-foreground">
                  CHAPTERS
                </p>
                {filteredChapters.map((c) => {
                  const st = stats[c.id];
                  const done = st && st.panelCount > 0 && st.approvedCount === st.panelCount;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setActiveChapter(c.id)}
                      className={`mb-1 flex w-full items-start gap-2 rounded-md border p-2.5 text-left transition-colors ${
                        activeChapter === c.id
                          ? "border-primary bg-primary/10"
                          : "border-transparent hover:bg-muted"
                      }`}
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium">{c.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {plural(st?.pageCount ?? 0, "page")} ·{" "}
                          {plural(allScenes[c.id]?.length ?? 0, "scene")}
                        </p>
                      </div>
                      {done ? (
                        <Check className="size-4 shrink-0 text-emerald-500" />
                      ) : (
                        <Circle className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })}
                {!filteredChapters.length && (
                  <p className="text-xs text-muted-foreground">No chapters yet.</p>
                )}
                <p className="mt-3 text-[11px] text-muted-foreground">
                  {plural(chapters.length, "chapter")}
                </p>
              </div>

              {/* scene cards */}
              <div className="flex-1 overflow-y-auto p-5">
                {!chapter ? (
                  <p className="text-sm text-muted-foreground">
                    Create a chapter to start planning.
                  </p>
                ) : (
                  <>
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex-1">
                        <h2 className="text-base font-semibold">{chapter.title}</h2>
                        <p className="text-xs text-muted-foreground">
                          {plural(chapterStat?.pageCount ?? 0, "page")} ·{" "}
                          {plural(scenes.length, "scene")} ·{" "}
                          {plural(chapterStat?.panelCount ?? 0, "panel")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <ProgressRing value={progress} />
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium">
                            {progress}%
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {chapterStat?.approvedCount ?? 0} / {chapterStat?.panelCount ?? 0}{" "}
                          panels approved
                        </span>
                      </div>
                    </div>

                    {scenes.map((s, i) => (
                      <button
                        key={s.id}
                        onClick={() => setActiveScene(s.id)}
                        className={`mb-3 flex w-full gap-4 rounded-lg border p-3 text-left transition-colors ${
                          activeScene === s.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/40"
                        }`}
                      >
                        <div className="w-10 shrink-0 text-center">
                          <p className="text-sm font-semibold">
                            {String(i + 1).padStart(2, "0")}
                          </p>
                          <p className="text-[10px] text-muted-foreground">SCENE</p>
                        </div>
                        <div
                          className="h-20 w-32 shrink-0 rounded-md border border-border bg-muted bg-cover bg-center"
                          style={
                            s.thumbnail_url
                              ? { backgroundImage: `url(${s.thumbnail_url})` }
                              : undefined
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">{s.title}</p>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] ${TAG_CLASS[s.tag]}`}
                            >
                              {TAG_LABEL[s.tag]}
                            </span>
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {s.synopsis || "No synopsis yet."}
                          </p>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Pages {s.page_start ?? "–"}–{s.page_end ?? "–"}
                          </p>
                        </div>
                      </button>
                    ))}

                    <button
                      onClick={addScene}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-3 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                    >
                      <Plus className="size-3.5" />
                      Add Scene
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {tab === "Scenes" && (
            <div className="flex-1 overflow-y-auto p-5">
              {flatScenes.map(({ scene: s, chapter: c }) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setActiveChapter(s.chapter_id);
                    setActiveScene(s.id);
                    setTab("Chapters");
                  }}
                  className="mb-2 flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/40"
                >
                  <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">
                    {c?.title ?? "—"}
                  </span>
                  <span className="flex-1 truncate text-sm">{s.title}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${TAG_CLASS[s.tag]}`}>
                    {TAG_LABEL[s.tag]}
                  </span>
                </button>
              ))}
              {!flatScenes.length && (
                <p className="text-sm text-muted-foreground">No scenes yet.</p>
              )}
            </div>
          )}

          {tab === "Beats" && (
            <div className="flex-1 overflow-y-auto p-5">
              {scene ? (
                <>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Beats for <span className="text-foreground">{scene.title}</span>
                  </p>
                  {beats.map((b, i) => (
                    <div key={b.id} className="mb-2 flex items-center gap-2">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] text-primary">
                        {i + 1}
                      </span>
                      <input
                        defaultValue={b.body}
                        onBlur={(e) =>
                          guard(async () => {
                            const { updateBeat } = await import("@/lib/story");
                            await updateBeat(supabase, b.id, { body: e.target.value });
                          })
                        }
                        className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                      />
                      <button
                        onClick={() => removeBeat(b.id)}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addBeat}
                    className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
                  >
                    <Plus className="size-3.5" />
                    Add beat
                  </button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a scene in the Chapters tab to edit its beats.
                </p>
              )}
            </div>
          )}

          {tab === "Outline" && (
            <div className="flex-1 overflow-y-auto p-5 text-sm">
              {chapters.map((c) => (
                <div key={c.id} className="mb-4">
                  <p className="font-medium">{c.title}</p>
                  {(allScenes[c.id] ?? []).map((s, i) => (
                    <div key={s.id} className="ml-4 mt-1">
                      <p className="text-xs">
                        <span className="text-muted-foreground">{i + 1}.</span> {s.title}{" "}
                        <span className="text-muted-foreground">
                          ({TAG_LABEL[s.tag]})
                        </span>
                      </p>
                      {s.synopsis && (
                        <p className="ml-4 text-[11px] text-muted-foreground">
                          {s.synopsis}
                        </p>
                      )}
                    </div>
                  ))}
                  {!(allScenes[c.id] ?? []).length && (
                    <p className="ml-4 text-xs text-muted-foreground">No scenes.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* scene details */}
      {tab === "Chapters" && (
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border">
          <p className="border-b border-border px-4 py-3 text-[10px] tracking-wide text-muted-foreground">
            SCENE DETAILS
          </p>
          {!scene ? (
            <p className="p-4 text-xs text-muted-foreground">
              Select a scene to edit its details.
            </p>
          ) : (
            <div className="space-y-4 p-4">
              <div
                className="h-32 rounded-lg border border-border bg-muted bg-cover bg-center"
                style={
                  scene.thumbnail_url
                    ? { backgroundImage: `url(${scene.thumbnail_url})` }
                    : undefined
                }
              />

              <input
                value={scene.title}
                onChange={(e) => patchScene(scene.id, { title: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-medium outline-none focus:border-primary"
              />

              <select
                value={scene.tag}
                onChange={(e) =>
                  patchScene(scene.id, { tag: e.target.value as SceneTag })
                }
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
              >
                {(Object.keys(TAG_LABEL) as SceneTag[]).map((t) => (
                  <option key={t} value={t}>
                    {TAG_LABEL[t]}
                  </option>
                ))}
              </select>

              <div>
                <p className="mb-1 text-[10px] tracking-wide text-muted-foreground">
                  SCENE PURPOSE
                </p>
                <textarea
                  value={scene.purpose ?? ""}
                  onChange={(e) => patchScene(scene.id, { purpose: e.target.value })}
                  rows={3}
                  placeholder="What does this scene accomplish?"
                  className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                />
              </div>

              <div>
                <p className="mb-1 text-[10px] tracking-wide text-muted-foreground">
                  SYNOPSIS
                </p>
                <textarea
                  value={scene.synopsis ?? ""}
                  onChange={(e) => patchScene(scene.id, { synopsis: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                />
              </div>

              <div>
                <p className="mb-1 text-[10px] tracking-wide text-muted-foreground">
                  SCENE INFO
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-muted-foreground">
                    Page from
                    <input
                      type="number"
                      value={scene.page_start ?? ""}
                      onChange={(e) =>
                        patchScene(scene.id, {
                          page_start: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                    />
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Page to
                    <input
                      type="number"
                      value={scene.page_end ?? ""}
                      onChange={(e) =>
                        patchScene(scene.id, {
                          page_end: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                    />
                  </label>
                </div>
                <select
                  value={scene.status}
                  onChange={(e) =>
                    patchScene(scene.id, {
                      status: e.target.value as Scene["status"],
                    })
                  }
                  className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                >
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                  <option value="complete">Complete</option>
                </select>
              </div>

              <div>
                <p className="mb-1 text-[10px] tracking-wide text-muted-foreground">
                  CHARACTERS
                </p>
                {characters.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {characters.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => toggleCharacter(c.id)}
                        className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                          sceneChars.includes(c.id)
                            ? "border-primary text-primary"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Add characters in Character Ref first.
                  </p>
                )}
              </div>

              <div>
                <p className="mb-1 text-[10px] tracking-wide text-muted-foreground">
                  KEY BEATS IN THIS SCENE
                </p>
                {beats.map((b, i) => (
                  <div key={b.id} className="mb-1.5 flex items-start gap-2">
                    <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] text-primary">
                      {i + 1}
                    </span>
                    <input
                      defaultValue={b.body}
                      aria-label={`Beat ${i + 1}`}
                      onBlur={(e) =>
                        guard(async () => {
                          const { updateBeat } = await import("@/lib/story");
                          await updateBeat(supabase, b.id, { body: e.target.value });
                          setBeats((bs) =>
                            bs.map((x) =>
                              x.id === b.id ? { ...x, body: e.target.value } : x
                            )
                          );
                        })
                      }
                      className="flex-1 rounded bg-transparent px-1 py-0.5 text-[11px] outline-none focus:bg-background focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={() => removeBeat(b.id)}
                      className="text-muted-foreground hover:text-red-400"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addBeat}
                  className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
                >
                  <Plus className="size-3" />
                  Add beat
                </button>
              </div>

              <div>
                <p className="mb-1 text-[10px] tracking-wide text-muted-foreground">
                  NOTES
                </p>
                <textarea
                  value={scene.notes ?? ""}
                  onChange={(e) => patchScene(scene.id, { notes: e.target.value })}
                  rows={3}
                  className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                />
              </div>

              <button
                onClick={() => removeScene(scene.id)}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-red-400"
              >
                <Trash2 className="size-3" />
                Delete scene
              </button>
            </div>
          )}
        </aside>
      )}
    </main>
  );
}
