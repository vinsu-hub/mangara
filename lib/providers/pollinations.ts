import { buildPrompt, type NormalizedOutput, type ProviderAdapter, type GenerationSpec } from "./types";

/**
 * No API key, no account, effectively unlimited — which makes it the provider
 * that can always be tried last. Its reference-image conditioning is weak, so
 * panels it produces are badged in the UI (see §6.5 of the build plan).
 */
export const pollinationsAdapter: ProviderAdapter = {
  name: "pollinations",

  async isAvailable() {
    return true;
  },

  async generate(spec: GenerationSpec): Promise<NormalizedOutput> {
    const start = Date.now();
    const width = Math.min(1536, Math.max(256, Math.round(spec.width)));
    const height = Math.min(1536, Math.max(256, Math.round(spec.height)));

    const url =
      `https://image.pollinations.ai/prompt/${encodeURIComponent(buildPrompt(spec))}` +
      `?width=${width}&height=${height}&nologo=true&model=flux`;

    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) {
      throw new Error(`Pollinations error ${res.status}: ${await res.text()}`);
    }

    return {
      bytes: await res.arrayBuffer(),
      contentType: res.headers.get("content-type") ?? "image/jpeg",
      width,
      height,
      provider: "pollinations",
      model: "flux",
      generationTimeMs: Date.now() - start,
    };
  },
};
