import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Character,
  CharacterReference,
  CharacterRelationship,
  ReferenceKind,
} from "@/lib/types";

const CHAR_COLS =
  "id, project_id, name, role, description, notes, age, height, weapon, style, personality, theme_colors, hero_image_url, consistency_lock";

export const DEFAULT_LOCK = {
  face: 100,
  hair: 100,
  clothing: 95,
  weapon: 100,
  proportions: 95,
};

/** The six expressions the mockup's "Generate Expression Set" produces. */
export const EXPRESSION_SET = [
  "Neutral",
  "Angry",
  "Focused",
  "Surprised",
  "Sad",
  "Determined",
];

function normalise(row: Record<string, unknown>): Character {
  return {
    ...(row as unknown as Character),
    personality: (row.personality as string[]) ?? [],
    theme_colors: (row.theme_colors as string[]) ?? [],
    consistency_lock:
      (row.consistency_lock as Character["consistency_lock"]) ?? DEFAULT_LOCK,
  };
}

export async function listCharacters(
  supabase: SupabaseClient,
  projectId: string
): Promise<Character[]> {
  const { data, error } = await supabase
    .from("characters")
    .select(CHAR_COLS)
    .eq("project_id", projectId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((r) => normalise(r as Record<string, unknown>));
}

export async function createCharacter(
  supabase: SupabaseClient,
  projectId: string,
  name: string
): Promise<Character> {
  const { data, error } = await supabase
    .from("characters")
    .insert({
      project_id: projectId,
      name,
      role: "Supporting",
      consistency_lock: DEFAULT_LOCK,
    })
    .select(CHAR_COLS)
    .single();
  if (error) throw error;
  return normalise(data as Record<string, unknown>);
}

export async function updateCharacter(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<Character>
): Promise<void> {
  const { error } = await supabase.from("characters").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCharacter(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("characters").delete().eq("id", id);
  if (error) throw error;
}

export async function listReferences(
  supabase: SupabaseClient,
  characterId: string
): Promise<CharacterReference[]> {
  const { data, error } = await supabase
    .from("character_references")
    .select("id, character_id, image_url, kind, label")
    .eq("character_id", characterId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as CharacterReference[];
}

export async function deleteReference(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("character_references").delete().eq("id", id);
  if (error) throw error;
}

export async function listRelationships(
  supabase: SupabaseClient,
  characterId: string
): Promise<CharacterRelationship[]> {
  const { data, error } = await supabase
    .from("character_relationships")
    .select("id, from_character_id, to_character_id, label")
    .eq("from_character_id", characterId);
  if (error) throw error;
  return (data ?? []) as CharacterRelationship[];
}

export async function addRelationship(
  supabase: SupabaseClient,
  fromId: string,
  toId: string,
  label: string
): Promise<CharacterRelationship> {
  const { data, error } = await supabase
    .from("character_relationships")
    .upsert(
      { from_character_id: fromId, to_character_id: toId, label },
      { onConflict: "from_character_id,to_character_id" }
    )
    .select("id, from_character_id, to_character_id, label")
    .single();
  if (error) throw error;
  return data as CharacterRelationship;
}

export async function removeRelationship(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("character_relationships").delete().eq("id", id);
  if (error) throw error;
}

export interface CharacterUsage {
  panelCount: number;
  generationCount: number;
  completeCount: number;
}

export async function getCharacterUsage(
  supabase: SupabaseClient,
  characterId: string
): Promise<CharacterUsage> {
  const { data, error } = await supabase
    .from("generations")
    .select("id, status")
    .eq("character_id", characterId);
  if (error) throw error;

  const rows = data ?? [];
  return {
    panelCount: 0,
    generationCount: rows.length,
    completeCount: rows.filter((r) => r.status === "complete").length,
  };
}

/** Fire-and-forget: the caller polls `character_references` for the results. */
export async function requestCharacterArt(
  characterId: string,
  kind: ReferenceKind,
  labels: string[]
): Promise<void> {
  const res = await fetch("/api/generate/character", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ characterId, kind, labels }),
  });
  if (!res.ok) throw new Error(await res.text());
}

/**
 * The identity block appended to a panel prompt by "Use in Current Panel", so
 * a panel generation renders recognisably the same character.
 */
export function characterPromptBlock(c: Character): string {
  return [
    c.name,
    c.description,
    c.style,
    c.weapon ? `carrying ${c.weapon}` : null,
    c.personality?.length ? c.personality.join(", ") : null,
  ]
    .filter(Boolean)
    .join(", ");
}
