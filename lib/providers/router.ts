import { createAdminClient } from "@/lib/supabase/admin";
import { geminiAdapter } from "./gemini";
import { pollinationsAdapter } from "./pollinations";
import type { GenerationSpec, NormalizedOutput, ProviderAdapter } from "./types";

/**
 * Order matters: Gemini first because it handles reference-image conditioning
 * well (which the Character Reference / consistency-lock workflow depends on),
 * Pollinations as the always-available safety net. Gemini reports itself
 * unavailable when GEMINI_API_KEY is unset or the daily cap is spent, so with
 * no key configured this list resolves to Pollinations automatically.
 */
const providers: ProviderAdapter[] = [geminiAdapter, pollinationsAdapter];

export async function generate(spec: GenerationSpec): Promise<NormalizedOutput> {
  const failures: string[] = [];

  for (const provider of providers) {
    let available = false;
    try {
      available = await provider.isAvailable();
    } catch {
      available = false;
    }
    if (!available) continue;

    try {
      const result = await provider.generate(spec);
      await logUsage(provider.name);
      return result;
    } catch (err) {
      failures.push(`${provider.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  throw new Error(
    failures.length
      ? `All providers failed — ${failures.join(" | ")}`
      : "No image provider is currently available"
  );
}

async function logUsage(provider: string) {
  try {
    await createAdminClient().from("generation_log").insert({ provider });
  } catch {
    // Usage logging is only used for quota estimation — never fail a
    // successful generation because the bookkeeping write didn't land.
  }
}
