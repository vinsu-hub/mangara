import type { SupabaseClient } from "@supabase/supabase-js";

export interface Project {
  id: string;
  name: string;
  owner_id: string;
}

/**
 * Milestone 1 has no project-creation UI yet — every user gets a single
 * default project, created on first login, so the app shell has something
 * real to point at.
 */
export async function getOrCreateDefaultProject(
  supabase: SupabaseClient,
  userId: string
): Promise<Project> {
  const { data: existing } = await supabase
    .from("projects")
    .select("id, name, owner_id")
    .eq("owner_id", userId)
    .limit(1)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("projects")
    .insert({ name: "My Manga", owner_id: userId })
    .select("id, name, owner_id")
    .single();

  if (error) throw error;

  const { error: collabError } = await supabase
    .from("collaborators")
    .insert({ project_id: created.id, user_id: userId, role: "owner" });

  if (collabError) throw collabError;

  return created;
}
