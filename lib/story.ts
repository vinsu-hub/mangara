import type { SupabaseClient } from "@supabase/supabase-js";
import type { Beat, Chapter, Page, Scene } from "@/lib/types";

const SCENE_COLS =
  "id, chapter_id, title, synopsis, purpose, tag, order_index, page_start, page_end, status, notes, thumbnail_url";

export async function listChapters(
  supabase: SupabaseClient,
  projectId: string
): Promise<Chapter[]> {
  const { data, error } = await supabase
    .from("chapters")
    .select("id, project_id, title, order_index")
    .eq("project_id", projectId)
    .order("order_index");
  if (error) throw error;
  return (data ?? []) as Chapter[];
}

export async function createChapter(
  supabase: SupabaseClient,
  projectId: string,
  title: string,
  orderIndex: number
): Promise<Chapter> {
  const { data, error } = await supabase
    .from("chapters")
    .insert({ project_id: projectId, title, order_index: orderIndex })
    .select("id, project_id, title, order_index")
    .single();
  if (error) throw error;
  return data as Chapter;
}

export async function updateChapter(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<Chapter>
): Promise<void> {
  const { error } = await supabase.from("chapters").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteChapter(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("chapters").delete().eq("id", id);
  if (error) throw error;
}

export async function listScenes(
  supabase: SupabaseClient,
  chapterId: string
): Promise<Scene[]> {
  const { data, error } = await supabase
    .from("scenes")
    .select(SCENE_COLS)
    .eq("chapter_id", chapterId)
    .order("order_index");
  if (error) throw error;
  return (data ?? []) as Scene[];
}

export async function createScene(
  supabase: SupabaseClient,
  chapterId: string,
  orderIndex: number
): Promise<Scene> {
  const { data, error } = await supabase
    .from("scenes")
    .insert({
      chapter_id: chapterId,
      title: `Scene ${orderIndex}`,
      order_index: orderIndex,
      tag: "establishing",
      status: "not_started",
    })
    .select(SCENE_COLS)
    .single();
  if (error) throw error;
  return data as Scene;
}

export async function updateScene(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<Scene>
): Promise<void> {
  const { error } = await supabase.from("scenes").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteScene(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("scenes").delete().eq("id", id);
  if (error) throw error;
}

export async function listBeats(
  supabase: SupabaseClient,
  sceneId: string
): Promise<Beat[]> {
  const { data, error } = await supabase
    .from("beats")
    .select("id, scene_id, body, order_index")
    .eq("scene_id", sceneId)
    .order("order_index");
  if (error) throw error;
  return (data ?? []) as Beat[];
}

export async function createBeat(
  supabase: SupabaseClient,
  sceneId: string,
  body: string,
  orderIndex: number
): Promise<Beat> {
  const { data, error } = await supabase
    .from("beats")
    .insert({ scene_id: sceneId, body, order_index: orderIndex })
    .select("id, scene_id, body, order_index")
    .single();
  if (error) throw error;
  return data as Beat;
}

export async function updateBeat(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<Beat>
) {
  const { error } = await supabase.from("beats").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteBeat(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from("beats").delete().eq("id", id);
  if (error) throw error;
}

export async function listSceneCharacterIds(
  supabase: SupabaseClient,
  sceneId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("scene_characters")
    .select("character_id")
    .eq("scene_id", sceneId);
  if (error) throw error;
  return (data ?? []).map((r) => r.character_id as string);
}

export async function setSceneCharacter(
  supabase: SupabaseClient,
  sceneId: string,
  characterId: string,
  present: boolean
) {
  if (present) {
    const { error } = await supabase
      .from("scene_characters")
      .upsert({ scene_id: sceneId, character_id: characterId });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("scene_characters")
      .delete()
      .eq("scene_id", sceneId)
      .eq("character_id", characterId);
    if (error) throw error;
  }
}

export interface ChapterStats {
  pageCount: number;
  panelCount: number;
  approvedCount: number;
}

/**
 * Real progress, derived from the pages and panels that actually exist rather
 * than a stored percentage that would drift out of date the moment anyone
 * edited a page.
 */
export async function getChapterStats(
  supabase: SupabaseClient,
  chapterId: string
): Promise<ChapterStats> {
  const { data: pages, error: pageError } = await supabase
    .from("pages")
    .select("id")
    .eq("chapter_id", chapterId);
  if (pageError) throw pageError;

  const pageIds = (pages ?? []).map((p) => p.id as string);
  if (!pageIds.length) return { pageCount: 0, panelCount: 0, approvedCount: 0 };

  const { data: panels, error: panelError } = await supabase
    .from("panels")
    .select("id, review_status")
    .in("page_id", pageIds);
  if (panelError) throw panelError;

  return {
    pageCount: pageIds.length,
    panelCount: panels?.length ?? 0,
    approvedCount: (panels ?? []).filter((p) => p.review_status === "approved").length,
  };
}


export interface ScenePages {
  pages: Page[];
  panelCount: number;
  approvedCount: number;
}

/**
 * Resolves a scene's page range to the real `pages` rows it covers.
 *
 * page_start/page_end are page *numbers* (a page's order_index within its
 * chapter), which is what an author thinks in. Everything downstream — panel
 * counts, progress, "open in editor" — resolves through here so the numbers
 * on screen always describe pages that actually exist.
 */
export async function getScenePages(
  supabase: SupabaseClient,
  chapterId: string,
  pageStart: number | null,
  pageEnd: number | null
): Promise<ScenePages> {
  if (pageStart == null) return { pages: [], panelCount: 0, approvedCount: 0 };
  const end = pageEnd ?? pageStart;

  const { data: pageRows, error } = await supabase
    .from("pages")
    .select("id, chapter_id, order_index, width, height")
    .eq("chapter_id", chapterId)
    .gte("order_index", Math.min(pageStart, end))
    .lte("order_index", Math.max(pageStart, end))
    .order("order_index");
  if (error) throw error;

  const pages = (pageRows ?? []) as Page[];
  if (!pages.length) return { pages, panelCount: 0, approvedCount: 0 };

  const { data: panels, error: panelError } = await supabase
    .from("panels")
    .select("id, review_status")
    .in("page_id", pages.map((p) => p.id));
  if (panelError) throw panelError;

  return {
    pages,
    panelCount: panels?.length ?? 0,
    approvedCount: (panels ?? []).filter((p) => p.review_status === "approved").length,
  };
}

/**
 * Creates whatever pages a scene's range refers to but which don't exist yet,
 * so a range is never a promise the project can't keep.
 */
export async function ensurePagesForRange(
  supabase: SupabaseClient,
  chapterId: string,
  pageStart: number,
  pageEnd: number
): Promise<Page[]> {
  const { data: existing, error } = await supabase
    .from("pages")
    .select("order_index")
    .eq("chapter_id", chapterId);
  if (error) throw error;

  const have = new Set((existing ?? []).map((p) => p.order_index as number));
  const missing: number[] = [];
  for (let i = Math.min(pageStart, pageEnd); i <= Math.max(pageStart, pageEnd); i++) {
    if (!have.has(i)) missing.push(i);
  }
  if (!missing.length) return [];

  const { data, error: insertError } = await supabase
    .from("pages")
    .insert(missing.map((order_index) => ({ chapter_id: chapterId, order_index })))
    .select("id, chapter_id, order_index, width, height");
  if (insertError) throw insertError;
  return (data ?? []) as Page[];
}
