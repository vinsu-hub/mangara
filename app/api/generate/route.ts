import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import { queueGeneration, runGeneration } from "@/lib/generation/run";
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
    .select("id")
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

  const target = { kind: "panel" as const, panelId };

  try {
    const generationId = await queueGeneration(target, spec);
    // Return immediately and finish in the background — a 10–30s synchronous
    // response would be fragile and blocks the client for no reason. The
    // client polls the panel row for the result.
    waitUntil(runGeneration(generationId, target, spec));
    return NextResponse.json({ generationId, status: "queued" });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
