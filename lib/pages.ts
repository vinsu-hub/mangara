import type { SupabaseClient } from "@supabase/supabase-js";
import type { Chapter, Layer, Page } from "@/lib/types";

interface PanelRow {
  id: string;
  page_id: string;
  kind: Layer["kind"];
  geometry: Layer["geometry"];
  style: Layer["style"] | null;
  content: string | null;
  z_index: number | null;
  image_url: string | null;
  prompt: string | null;
  generation_status: Layer["generation_status"] | null;
  review_status: Layer["review_status"] | null;
  last_provider: string | null;
}

function rowToLayer(row: PanelRow): Layer {
  return {
    id: row.id,
    page_id: row.page_id,
    kind: row.kind ?? "panel",
    geometry: row.geometry,
    style: row.style ?? {},
    content: row.content,
    z_index: row.z_index ?? 0,
    image_url: row.image_url,
    prompt: row.prompt,
    generation_status: row.generation_status ?? "idle",
    review_status: row.review_status ?? "pending",
    last_provider: row.last_provider,
  };
}

export async function getFirstChapter(
  supabase: SupabaseClient,
  projectId: string
): Promise<Chapter> {
  const { data, error } = await supabase
    .from("chapters")
    .select("id, project_id, title, order_index")
    .eq("project_id", projectId)
    .order("order_index")
    .limit(1)
    .single();

  if (error) throw error;
  return data as Chapter;
}

export async function listPages(
  supabase: SupabaseClient,
  chapterId: string
): Promise<Page[]> {
  const { data, error } = await supabase
    .from("pages")
    .select("id, chapter_id, order_index, width, height")
    .eq("chapter_id", chapterId)
    .order("order_index");

  if (error) throw error;
  return (data ?? []) as Page[];
}

export async function createPage(
  supabase: SupabaseClient,
  chapterId: string,
  orderIndex: number
): Promise<Page> {
  const { data, error } = await supabase
    .from("pages")
    .insert({ chapter_id: chapterId, order_index: orderIndex })
    .select("id, chapter_id, order_index, width, height")
    .single();

  if (error) throw error;
  return data as Page;
}

export async function deletePage(
  supabase: SupabaseClient,
  pageId: string
): Promise<void> {
  const { error } = await supabase.from("pages").delete().eq("id", pageId);
  if (error) throw error;
}

export async function loadLayers(
  supabase: SupabaseClient,
  pageId: string
): Promise<Layer[]> {
  const { data, error } = await supabase
    .from("panels")
    .select(
      "id, page_id, kind, geometry, style, content, z_index, image_url, prompt, generation_status, review_status, last_provider"
    )
    .eq("page_id", pageId)
    .order("z_index");

  if (error) throw error;
  return ((data ?? []) as PanelRow[]).map(rowToLayer);
}

/**
 * Persists the page's layers.
 *
 * Deleted layers are removed by id-diff rather than wipe-and-reinsert, so
 * panel ids stay stable — `generations` rows reference them.
 *
 * Deliberately does NOT write `image_url`, `generation_status` or
 * `last_provider`. Those columns are owned by the generation pipeline, which
 * updates them from the server while the editor is open. Including them here
 * makes autosave race the pipeline and clobber a finished result with the
 * browser's stale copy — the panel then sticks on "generating" forever even
 * though the image landed. On INSERT the column defaults apply; on UPDATE
 * PostgREST leaves omitted columns untouched, which is exactly what we want.
 */
export async function saveLayers(
  supabase: SupabaseClient,
  pageId: string,
  layers: Layer[]
): Promise<void> {
  const { data: existing, error: fetchError } = await supabase
    .from("panels")
    .select("id")
    .eq("page_id", pageId);

  if (fetchError) throw fetchError;

  const keepIds = new Set(layers.map((l) => l.id));
  const toDelete = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => !keepIds.has(id));

  if (toDelete.length) {
    const { error } = await supabase.from("panels").delete().in("id", toDelete);
    if (error) throw error;
  }

  if (layers.length) {
    const { error } = await supabase.from("panels").upsert(
      layers.map((l) => ({
        id: l.id,
        page_id: pageId,
        kind: l.kind,
        geometry: l.geometry,
        style: l.style,
        content: l.content,
        z_index: l.z_index,
        prompt: l.prompt,
        review_status: l.review_status,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id" }
    );
    if (error) throw error;
  }
}
