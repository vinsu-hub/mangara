export interface GenerationSpec {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  referenceImages?: string[];
  characterLock?: string[];
  quality?: "draft" | "standard" | "final";
}

export interface NormalizedOutput {
  /** Raw image bytes. The caller uploads to storage and assigns the URL. */
  bytes: ArrayBuffer;
  contentType: string;
  width: number;
  height: number;
  provider: string;
  model: string;
  generationTimeMs: number;
}

export interface ProviderAdapter {
  name: string;
  /** Quota/health check — consulted before the adapter is tried. */
  isAvailable(): Promise<boolean>;
  generate(spec: GenerationSpec): Promise<NormalizedOutput>;
}

/**
 * The house style. Every provider gets this appended so panels look like they
 * belong to the same book regardless of which adapter served the request.
 */
export function buildPrompt(spec: GenerationSpec): string {
  return [
    spec.prompt,
    "black and white manga panel art, high contrast, expressive ink linework, screentone shading",
    spec.negativePrompt ? `Avoid: ${spec.negativePrompt}` : null,
  ]
    .filter(Boolean)
    .join(". ");
}
