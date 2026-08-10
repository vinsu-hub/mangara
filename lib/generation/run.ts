import { createAdminClient } from "@/lib/supabase/admin";
import { generate } from "@/lib/providers/router";
import type { GenerationSpec } from "@/lib/providers/types";
import type { ReferenceKind } from "@/lib/types";

/**
 * What a generation is being produced for. A generation row always belongs to
 * exactly one of these.
 */
export type GenerationTarget =
  | { kind: "panel"; panelId: string }
  | { kind: "character"; characterId: string; referenceKind: ReferenceKind; label: string };

/**
 * Creates the queued row and returns its id. Kept separate from `runGeneration`
 * so the HTTP handler can respond immediately and let the work finish in
 * `waitUntil` — image generation takes far longer than a request should.
 */
export async function queueGeneration(
  target: GenerationTarget,
  spec: GenerationSpec
): Promise<string> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("generations")
    .insert({
      panel_id: target.kind === "panel" ? target.panelId : null,
      character_id: target.kind === "character" ? target.characterId : null,
      spec,
      status: "queued",
    })
    .select("id")
    .single();

  if (error) throw error;

  if (target.kind === "panel") {
    await admin
      .from("panels")
      .update({ generation_status: "queued" })
      .eq("id", target.panelId);
  }

  return data.id as string;
}

/**
 * Runs the generation to completion and writes the result to whichever target
 * it belongs to. Never throws — failures are recorded on the row so the client,
 * which is polling, can surface them.
 */
export async function runGeneration(
  generationId: string,
  target: GenerationTarget,
  spec: GenerationSpec
): Promise<void> {
  const admin = createAdminClient();

  const markPanel = async (patch: Record<string, unknown>) => {
    if (target.kind === "panel") {
      await admin.from("panels").update(patch).eq("id", target.panelId);
    }
  };

  try {
    await admin
      .from("generations")
      .update({ status: "generating" })
      .eq("id", generationId);
    await markPanel({ generation_status: "generating" });

    const out = await generate(spec);

    const ext = out.contentType.includes("png") ? "png" : "jpg";
    const folder =
      target.kind === "panel" ? target.panelId : `characters/${target.characterId}`;
    const path = `${folder}/${Date.now()}.${ext}`;

    const { error: uploadError } = await admin.storage
      .from("panels")
      .upload(path, out.bytes, { contentType: out.contentType, upsert: true });
    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = admin.storage.from("panels").getPublicUrl(path);

    await admin
      .from("generations")
      .update({
        status: "complete",
        provider: out.provider,
        model: out.model,
        image_url: publicUrl,
        generation_time_ms: out.generationTimeMs,
      })
      .eq("id", generationId);

    if (target.kind === "panel") {
      await markPanel({
        image_url: publicUrl,
        generation_status: "complete",
        last_provider: out.provider,
      });
    } else {
      await admin.from("character_references").insert({
        character_id: target.characterId,
        image_url: publicUrl,
        kind: target.referenceKind,
        label: target.label,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("generations")
      .update({ status: "failed", error: message })
      .eq("id", generationId);
    await markPanel({ generation_status: "failed" });
  }
}
