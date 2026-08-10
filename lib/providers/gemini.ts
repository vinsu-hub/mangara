import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildPrompt,
  type GenerationSpec,
  type NormalizedOutput,
  type ProviderAdapter,
} from "./types";

const MODEL = "gemini-2.5-flash-image";
// The free AI Studio tier is ~500 requests/day; stay under it so the router
// falls through to Pollinations rather than burning requests on 429s.
const DAILY_CAP = 480;

export const geminiAdapter: ProviderAdapter = {
  name: "gemini",

  async isAvailable() {
    if (!process.env.GEMINI_API_KEY) return false;

    const since = new Date();
    since.setHours(0, 0, 0, 0);

    const { count, error } = await createAdminClient()
      .from("generation_log")
      .select("*", { count: "exact", head: true })
      .eq("provider", "gemini")
      .gte("created_at", since.toISOString());

    if (error) return false;
    return (count ?? 0) < DAILY_CAP;
  },

  async generate(spec: GenerationSpec): Promise<NormalizedOutput> {
    const start = Date.now();

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY!,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(spec) }] }],
        }),
        signal: AbortSignal.timeout(90_000),
      }
    );

    if (!res.ok) {
      throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const inline = parts.find(
      (p: { inlineData?: { data?: string } }) => p.inlineData?.data
    )?.inlineData;

    if (!inline?.data) throw new Error("Gemini returned no image");

    return {
      bytes: Buffer.from(inline.data, "base64").buffer as ArrayBuffer,
      contentType: inline.mimeType ?? "image/png",
      width: spec.width,
      height: spec.height,
      provider: "gemini",
      model: MODEL,
      generationTimeMs: Date.now() - start,
    };
  },
};
