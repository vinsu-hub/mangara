import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { createClient } from "@/lib/supabase/server";
import { queueGeneration, runGeneration, type GenerationTarget } from "@/lib/generation/run";
import type { GenerationSpec } from "@/lib/providers/types";
import type { Character, ReferenceKind } from "@/lib/types";

export const maxDuration = 60;

const KINDS: ReferenceKind[] = ["turnaround", "pose", "expression"];

/** Framing per reference type — a turnaround needs full body, an expression a head shot. */
const FRAMING: Record<ReferenceKind, { text: string; w: number; h: number }> = {
  turnaround: {
    text: "full body character turnaround reference sheet, neutral A-pose, plain background",
    w: 1024,
    h: 1024,
  },
  pose: {
    text: "full body dynamic action pose, plain background",
    w: 768,
    h: 1024,
  },
  expression: {
    text: "head and shoulders portrait, clear facial expression, plain background",
    w: 768,
    h: 768,
  },
};

/**
 * Builds a prompt that carries the character's identity, so generated
 * references stay recognisably the same person. The consistency lock decides
 * which traits are stated as fixed — that is the whole point of those sliders.
 */
function buildCharacterPrompt(
  character: Character,
  kind: ReferenceKind,
  label: string
): string {
  const lock = character.consistency_lock ?? {};
  const locked: string[] = [];
  if ((lock.face ?? 100) >= 70) locked.push("consistent facial identity");
  if ((lock.hair ?? 100) >= 70 && character.style) locked.push("consistent hair style");
  if ((lock.clothing ?? 100) >= 70) locked.push("consistent clothing design");
  if ((lock.weapon ?? 100) >= 70 && character.weapon)
    locked.push(`carrying ${character.weapon}`);
  if ((lock.proportions ?? 100) >= 70) locked.push("consistent body proportions");

  return [
    character.name,
    character.description,
    character.age ? `age ${character.age}` : null,
    character.height,
    character.style,
    character.personality?.length ? character.personality.join(", ") : null,
    label && kind === "expression" ? `${label} expression` : label || null,
    FRAMING[kind].text,
    locked.join(", "),
  ]
    .filter(Boolean)
    .join(", ");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const characterId: string | undefined = body?.characterId;
  const kind: ReferenceKind = body?.kind;
  const labels: string[] = Array.isArray(body?.labels) ? body.labels : [body?.label ?? ""];

  if (!characterId || !KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `characterId and kind (${KINDS.join("|")}) are required` },
      { status: 400 }
    );
  }

  // RLS decides whether this user may touch the character.
  const { data: character, error } = await supabase
    .from("characters")
    .select("*")
    .eq("id", characterId)
    .single<Character>();

  if (error || !character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const framing = FRAMING[kind];
  const ids: string[] = [];

  for (const label of labels.slice(0, 6)) {
    const spec: GenerationSpec = {
      prompt: buildCharacterPrompt(character, kind, label),
      width: framing.w,
      height: framing.h,
      quality: "standard",
    };
    const target: GenerationTarget = {
      kind: "character",
      characterId,
      referenceKind: kind,
      label,
    };
    try {
      const generationId = await queueGeneration(target, spec);
      waitUntil(runGeneration(generationId, target, spec));
      ids.push(generationId);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ generationIds: ids, status: "queued" });
}
