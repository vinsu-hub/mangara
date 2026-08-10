import type { SupabaseClient } from "@supabase/supabase-js";

export interface Project {
  id: string;
  name: string;
  owner_id: string;
}

/**
 * Bootstraps the signed-in user's default project (plus its first chapter and
 * page) if they don't have one yet.
 *
 * This is a single SECURITY DEFINER RPC rather than client-side inserts on
 * purpose. Inserting the project from the client and chaining `.select()`
 * fails: PostgREST's INSERT..RETURNING is evaluated against the SELECT policy,
 * which requires a collaborator row that doesn't exist yet. Splitting it into
 * two statements also risks orphaning a project the user can never see.
 */
export async function getOrCreateDefaultProject(
  supabase: SupabaseClient
): Promise<Project> {
  const { data, error } = await supabase
    .rpc("get_or_create_default_project")
    .single<Project>();

  if (error) throw error;
  return data;
}
