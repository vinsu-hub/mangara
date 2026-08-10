"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Search, Sparkles, Trash2, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import {
  DEFAULT_LOCK,
  EXPRESSION_SET,
  addRelationship,
  createCharacter,
  deleteCharacter,
  deleteReference,
  getCharacterUsage,
  listCharacters,
  listReferences,
  listRelationships,
  removeRelationship,
  requestCharacterArt,
  updateCharacter,
  type CharacterUsage,
} from "@/lib/characters";
import type {
  Character,
  CharacterReference,
  CharacterRelationship,
  ReferenceKind,
} from "@/lib/types";

const SUB_TABS = [
  "Overview",
  "Design",
  "Expressions",
  "Poses",
  "Costumes",
  "Notes",
  "Appearance Lock",
] as const;
type SubTab = (typeof SUB_TABS)[number];

const LOCK_FIELDS: { key: keyof typeof DEFAULT_LOCK; label: string }[] = [
  { key: "face", label: "Face Identity" },
  { key: "hair", label: "Hair Style" },
  { key: "clothing", label: "Clothing" },
  { key: "weapon", label: "Weapon Design" },
  { key: "proportions", label: "Proportions" },
];

const POLL_MS = 3000;

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border py-1.5 last:border-0">
      <span className="w-24 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <input
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded bg-transparent px-1 py-0.5 text-xs outline-none focus:bg-background focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}

function RefGrid({
  items,
  empty,
  onDelete,
}: {
  items: CharacterReference[];
  empty: string;
  onDelete: (id: string) => void;
}) {
  if (!items.length) {
    return <p className="text-[11px] text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((r) => (
        <div key={r.id} className="group relative">
          <div
            className="size-20 rounded-md border border-border bg-muted bg-cover bg-center"
            style={r.image_url ? { backgroundImage: `url(${r.image_url})` } : undefined}
          />
          {r.label && (
            <p className="mt-1 w-20 truncate text-center text-[10px] text-muted-foreground">
              {r.label}
            </p>
          )}
          <button
            onClick={() => onDelete(r.id)}
            title="Remove"
            className="absolute right-0.5 top-0.5 hidden rounded bg-background/80 p-0.5 text-muted-foreground group-hover:block hover:text-red-400"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function CharacterRef({
  projectId,
  onUseInPanel,
}: {
  projectId: string;
  onUseInPanel?: (c: Character) => void;
}) {
  const supabase = useRef(createClient()).current;

  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refs, setRefs] = useState<CharacterReference[]>([]);
  const [rels, setRels] = useState<CharacterRelationship[]>([]);
  const [usage, setUsage] = useState<CharacterUsage | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("Overview");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"All" | "Main" | "Supporting">("All");
  const [generating, setGenerating] = useState<ReferenceKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const active = characters.find((c) => c.id === activeId) ?? null;

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listCharacters(supabase, projectId);
        if (cancelled) return;
        setCharacters(list);
        setActiveId((prev) => prev ?? list[0]?.id ?? null);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, supabase]);

  const loadDetail = useCallback(
    async (id: string) => {
      const [r, rel, u] = await Promise.all([
        listReferences(supabase, id),
        listRelationships(supabase, id),
        getCharacterUsage(supabase, id),
      ]);
      setRefs(r);
      setRels(rel);
      setUsage(u);
    },
    [supabase]
  );

  useEffect(() => {
    if (!activeId) {
      setRefs([]);
      setRels([]);
      setUsage(null);
      return;
    }
    void guard(() => loadDetail(activeId));
  }, [activeId, loadDetail]);

  // Generated art arrives asynchronously; poll while a request is in flight.
  useEffect(() => {
    if (!generating || !activeId) return;
    const started = refs.length;
    const timer = setInterval(async () => {
      const r = await listReferences(supabase, activeId);
      setRefs(r);
      if (r.length > started) {
        setGenerating(null);
        // Usage counts move with the generation, so refresh them together —
        // otherwise the card claims 0 generations beside a stored image.
        setUsage(await getCharacterUsage(supabase, activeId));
      }
    }, POLL_MS);
    const stop = setTimeout(() => setGenerating(null), 120_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [generating, activeId, refs.length, supabase]);

  const patch = (id: string, p: Partial<Character>) => {
    setCharacters((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));
    void guard(() => updateCharacter(supabase, id, p));
  };

  const addCharacter = () =>
    guard(async () => {
      const created = await createCharacter(
        supabase,
        projectId,
        `Character ${characters.length + 1}`
      );
      setCharacters((c) => [...c, created]);
      setActiveId(created.id);
    });

  const generate = (kind: ReferenceKind, labels: string[]) =>
    guard(async () => {
      if (!activeId) return;
      setGenerating(kind);
      try {
        await requestCharacterArt(activeId, kind, labels);
      } catch (e) {
        setGenerating(null);
        throw e;
      }
    });

  const filtered = useMemo(
    () =>
      characters.filter((c) => {
        if (query && !c.name.toLowerCase().includes(query.toLowerCase())) return false;
        if (roleFilter === "Main")
          return /protagonist|antagonist|main/i.test(c.role ?? "");
        if (roleFilter === "Supporting")
          return !/protagonist|antagonist|main/i.test(c.role ?? "");
        return true;
      }),
    [characters, query, roleFilter]
  );

  const byKind = (k: ReferenceKind) => refs.filter((r) => r.kind === k);

  if (loading) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading characters…
      </main>
    );
  }

  return (
    <main className="flex flex-1 overflow-hidden">
      {/* character list */}
      <div className="flex w-60 shrink-0 flex-col border-r border-border">
        <div className="flex items-center justify-between px-3 py-3">
          <p className="text-[10px] tracking-wide text-muted-foreground">CHARACTERS</p>
          <button
            onClick={addCharacter}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Plus className="size-3.5" />
            New
          </button>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search characters…"
              className="w-full rounded-md border border-border bg-background py-1 pl-7 pr-2 text-xs outline-none focus:border-primary"
            />
          </div>
          <div className="mt-2 flex gap-1">
            {(["All", "Main", "Supporting"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setRoleFilter(f)}
                className={`rounded px-2 py-0.5 text-[11px] ${
                  roleFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`mb-1 flex w-full items-center gap-2 rounded-md border p-2 text-left ${
                activeId === c.id
                  ? "border-primary bg-primary/10"
                  : "border-transparent hover:bg-muted"
              }`}
            >
              <div
                className="size-9 shrink-0 rounded-md border border-border bg-muted bg-cover bg-center"
                style={
                  c.hero_image_url
                    ? { backgroundImage: `url(${c.hero_image_url})` }
                    : undefined
                }
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {c.role || "—"}
                </p>
              </div>
            </button>
          ))}
          {!filtered.length && (
            <p className="px-2 text-xs text-muted-foreground">No characters.</p>
          )}
        </div>

        <button
          onClick={addCharacter}
          className="m-2 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          <UserPlus className="size-3.5" />
          Add Character
        </button>
      </div>

      {/* detail */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {error && (
          <div className="border-b border-red-900/50 bg-red-950/40 px-4 py-1.5 text-xs text-red-400">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">
              dismiss
            </button>
          </div>
        )}

        {!active ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Create a character to get started.
          </div>
        ) : (
          <>
            {/* hero */}
            <div
              className="relative flex h-40 shrink-0 items-end bg-muted bg-cover bg-center p-5"
              style={
                active.hero_image_url
                  ? { backgroundImage: `url(${active.hero_image_url})` }
                  : undefined
              }
            >
              <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
              <div className="relative">
                <input
                  value={active.name}
                  aria-label="Character name"
                  onChange={(e) => patch(active.id, { name: e.target.value })}
                  className="w-full bg-transparent text-2xl font-semibold outline-none focus:underline"
                />
                <div className="mt-1 flex w-[46rem] max-w-[70vw] items-center gap-2">
                  <input
                    value={active.role ?? ""}
                    aria-label="Character role"
                    onChange={(e) => patch(active.id, { role: e.target.value })}
                    placeholder="Role"
                    className="w-28 shrink-0 rounded bg-primary/15 px-2 py-0.5 text-[11px] text-primary outline-none"
                  />
                  <input
                    value={active.description ?? ""}
                    aria-label="Character description"
                    onChange={(e) => patch(active.id, { description: e.target.value })}
                    placeholder="One-line description"
                    className="flex-1 bg-transparent text-xs text-muted-foreground outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex shrink-0 gap-4 border-b border-border px-5">
              {SUB_TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setSubTab(t)}
                  className={`border-b-2 py-2 text-xs transition-colors ${
                    subTab === t
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {subTab === "Overview" ? (
              <div className="grid flex-1 grid-cols-3 gap-4 p-5">
                {/* turnaround */}
                <section className="col-span-2 rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] tracking-wide text-muted-foreground">
                      TURNAROUND
                    </p>
                    <button
                      onClick={() =>
                        generate("turnaround", ["front view", "side view", "back view"])
                      }
                      disabled={generating !== null}
                      className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-40"
                    >
                      {generating === "turnaround" ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Sparkles className="size-3" />
                      )}
                      Generate
                    </button>
                  </div>
                  <RefGrid
                    items={byKind("turnaround")}
                    empty="No turnaround yet — generate one to lock the character's look."
                    onDelete={(id) =>
                      guard(async () => {
                        await deleteReference(supabase, id);
                        setRefs((r) => r.filter((x) => x.id !== id));
                      })
                    }
                  />
                </section>

                {/* basic info */}
                <section className="rounded-lg border border-border p-3">
                  <p className="mb-2 text-[10px] tracking-wide text-muted-foreground">
                    BASIC INFO
                  </p>
                  <Field
                    label="Age"
                    value={active.age ?? ""}
                    onChange={(v) => patch(active.id, { age: v })}
                  />
                  <Field
                    label="Height"
                    value={active.height ?? ""}
                    onChange={(v) => patch(active.id, { height: v })}
                  />
                  <Field
                    label="Weapon"
                    value={active.weapon ?? ""}
                    onChange={(v) => patch(active.id, { weapon: v })}
                  />
                  <Field
                    label="Style"
                    value={active.style ?? ""}
                    onChange={(v) => patch(active.id, { style: v })}
                  />
                  <Field
                    label="Personality"
                    placeholder="comma separated"
                    value={active.personality.join(", ")}
                    onChange={(v) =>
                      patch(active.id, {
                        personality: v
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </section>

                {/* consistency lock */}
                <section className="rounded-lg border border-border p-3">
                  <p className="text-[10px] tracking-wide text-muted-foreground">
                    CONSISTENCY LOCK
                  </p>
                  <p className="mb-2 text-[10px] text-muted-foreground">
                    Elements AI should preserve
                  </p>
                  {LOCK_FIELDS.map(({ key, label }) => {
                    const v = active.consistency_lock?.[key] ?? DEFAULT_LOCK[key];
                    return (
                      <div key={key} className="mb-2">
                        <div className="flex justify-between text-[11px]">
                          <span>{label}</span>
                          <span className="text-muted-foreground">{v}%</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={v}
                          aria-label={label}
                          onChange={(e) =>
                            patch(active.id, {
                              consistency_lock: {
                                ...DEFAULT_LOCK,
                                ...active.consistency_lock,
                                [key]: Number(e.target.value),
                              },
                            })
                          }
                          className="w-full accent-primary"
                        />
                      </div>
                    );
                  })}
                  <p className="rounded-md border border-border p-2 text-[10px] text-muted-foreground">
                    High lock = less variation. Lower lock = more creative freedom.
                  </p>
                </section>

                {/* expressions */}
                <section className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] tracking-wide text-muted-foreground">
                      EXPRESSIONS
                    </p>
                    <button
                      onClick={() => generate("expression", EXPRESSION_SET)}
                      disabled={generating !== null}
                      className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-40"
                    >
                      {generating === "expression" ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Sparkles className="size-3" />
                      )}
                      Generate set
                    </button>
                  </div>
                  <RefGrid
                    items={byKind("expression")}
                    empty="No expressions yet."
                    onDelete={(id) =>
                      guard(async () => {
                        await deleteReference(supabase, id);
                        setRefs((r) => r.filter((x) => x.id !== id));
                      })
                    }
                  />
                </section>

                {/* poses */}
                <section className="rounded-lg border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] tracking-wide text-muted-foreground">
                      POSE REFERENCES
                    </p>
                    <button
                      onClick={() => generate("pose", ["dynamic action pose"])}
                      disabled={generating !== null}
                      className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-40"
                    >
                      {generating === "pose" ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Sparkles className="size-3" />
                      )}
                      New pose
                    </button>
                  </div>
                  <RefGrid
                    items={byKind("pose")}
                    empty="No poses yet."
                    onDelete={(id) =>
                      guard(async () => {
                        await deleteReference(supabase, id);
                        setRefs((r) => r.filter((x) => x.id !== id));
                      })
                    }
                  />
                </section>

                {/* relationships */}
                <section className="rounded-lg border border-border p-3">
                  <p className="mb-2 text-[10px] tracking-wide text-muted-foreground">
                    RELATIONSHIPS
                  </p>
                  {rels.map((r) => {
                    const other = characters.find((c) => c.id === r.to_character_id);
                    return (
                      <div key={r.id} className="mb-1 flex items-center gap-2 text-[11px]">
                        <span className="flex-1 truncate">{other?.name ?? "—"}</span>
                        <span className="text-muted-foreground">{r.label}</span>
                        <button
                          onClick={() =>
                            guard(async () => {
                              await removeRelationship(supabase, r.id);
                              setRels((x) => x.filter((y) => y.id !== r.id));
                            })
                          }
                          className="text-muted-foreground hover:text-red-400"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    );
                  })}
                  {characters.length > 1 ? (
                    <select
                      value=""
                      aria-label="Add relationship"
                      onChange={(e) => {
                        const toId = e.target.value;
                        if (!toId) return;
                        void guard(async () => {
                          const rel = await addRelationship(
                            supabase,
                            active.id,
                            toId,
                            "Ally"
                          );
                          setRels((x) => [...x.filter((y) => y.id !== rel.id), rel]);
                        });
                      }}
                      className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] outline-none focus:border-primary"
                    >
                      <option value="">+ Add relationship…</option>
                      {characters
                        .filter(
                          (c) =>
                            c.id !== active.id &&
                            !rels.some((r) => r.to_character_id === c.id)
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Add another character to link relationships.
                    </p>
                  )}
                </section>

                {/* notes */}
                <section className="rounded-lg border border-border p-3">
                  <p className="mb-2 text-[10px] tracking-wide text-muted-foreground">
                    NOTES
                  </p>
                  <textarea
                    value={active.notes ?? ""}
                    onChange={(e) => patch(active.id, { notes: e.target.value })}
                    rows={5}
                    placeholder="Habits, history, things the art must always get right…"
                    className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                  />
                </section>

                {/* usage + quick actions */}
                <section className="rounded-lg border border-border p-3">
                  <p className="mb-2 text-[10px] tracking-wide text-muted-foreground">
                    AI USAGE
                  </p>
                  <p className="text-xs">
                    {usage?.generationCount ?? 0} generations ·{" "}
                    {usage?.completeCount ?? 0} complete
                  </p>
                  <p className="mb-3 mt-1 text-[11px] text-muted-foreground">
                    {refs.length} reference images stored
                  </p>
                  <button
                    onClick={() => onUseInPanel?.(active)}
                    disabled={!onUseInPanel}
                    title={
                      onUseInPanel
                        ? "Append this character to the selected panel's prompt"
                        : "Select a panel in the Editing tab first"
                    }
                    className="w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40"
                  >
                    Use in Current Panel
                  </button>
                  <button
                    onClick={() =>
                      guard(async () => {
                        if (!window.confirm(`Delete ${active.name}?`)) return;
                        await deleteCharacter(supabase, active.id);
                        setCharacters((c) => c.filter((x) => x.id !== active.id));
                        setActiveId(null);
                      })
                    }
                    className="mt-2 w-full rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:border-red-900 hover:text-red-400"
                  >
                    Delete character
                  </button>
                </section>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <p className="max-w-sm text-xs text-muted-foreground">
                  <span className="text-foreground">{subTab}</span> isn&apos;t built yet.
                  Turnaround, expressions, poses, the consistency lock and relationships
                  all live under Overview.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
