import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generate } from "@/lib/providers/router";
import type { GenerationSpec } from "@/lib/providers/types";

// Image generation takes far longer than the 10s default. Hobby allows 60s.
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const panelId: string | undefined = body?.panelId;
  const prompt: string | undefined = body?.prompt?.trim();

  if (!panelId || !prompt) {
    return NextResponse.json(
      { error: "panelId and prompt are required" },
      { status: 400 }
    );
  }

  // Authorize against the *user's* client so RLS decides whether they may
  // touch this panel. Everything after this point runs as admin.
  const { data: panel, error: panelError } = await supabase
    .from("panels")
    .select("id, page_id")
    .eq("id", panelId)
    .single();

  if (panelError || !panel) {
    return NextResponse.json({ error: "Panel not found" }, { status: 404 });
  }

  const spec: GenerationSpec = {
    prompt,
    width: Math.round(body?.width ?? 1024),
    height: Math.round(body?.height ?? 1024),
    quality: "standard",
  };

  const admin = createAdminClient();
  const { data: generation, error: genError } = await admin
    .from("generations")
    .insert({ panel_id: panelId, spec, status: "queued" })
    .select("id")
    .single();

  if (genError) {
    return NextResponse.json({ error: genError.message }, { status: 500 });
  }

  await admin
    .from("panels")
    .update({ generation_status: "queued" })
    .eq("id", panelId);

  // Return immediately and finish the work in the background — a 10–30s
  // synchronous response would be fragile and blocks the UI thread on the
  // client for no reason. The client polls the panel row for the result.
  waitUntil(runGeneration(generation.id, panelId, spec));

  return NextResponse.json({ generationId: generation.id, status: "queued" });
}

async function runGeneration(
  generationId: string,
  panelId: string,
  spec: GenerationSpec
) {
  const admin = createAdminClient();

  try {
    await admin
      .from("generations")
      .update({ status: "generating" })
      .eq("id", generationId);
    await admin
      .from("panels")
      .update({ generation_status: "generating" })
      .eq("id", panelId);

    const out = await generate(spec);

    const ext = out.contentType.includes("png") ? "png" : "jpg";
    const path = `${panelId}/${Date.now()}.${ext}`;

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

    await admin
      .from("panels")
      .update({
        image_url: publicUrl,
        generation_status: "complete",
        last_provider: out.provider,
      })
      .eq("id", panelId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin
      .from("generations")
      .update({ status: "failed", error: message })
      .eq("id", generationId);
    await admin
      .from("panels")
      .update({ generation_status: "failed" })
      .eq("id", panelId);
  }
}
