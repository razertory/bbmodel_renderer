import type { Config } from "./config";
import { assertPublicHttpUrl, assertResolvesPublic } from "./ssrf";

export interface DownloadedModel {
  bytes: Uint8Array;
  text: string;
}

/** Download with SSRF guard, redirect cap, size cap and timeout. */
export async function downloadModel(config: Config, rawUrl: string): Promise<DownloadedModel> {
  let url = assertPublicHttpUrl(rawUrl);
  for (let redirects = 0; ; redirects++) {
    if (redirects > config.maxRedirects) throw new Error("too many redirects");
    await assertResolvesPublic(url);
    const res = await fetchWithTimeout(url, config.downloadTimeoutMs);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("redirect without location");
      url = assertPublicHttpUrl(new URL(location, url).toString());
      continue;
    }
    if (!res.ok) throw new Error(`download failed with HTTP ${res.status}`);

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > config.maxModelBytes) throw new SizeError(`model exceeds size limit (${declared} bytes)`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error("empty response body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > config.maxModelBytes) {
        await reader.cancel();
        throw new SizeError(`model exceeds size limit (${total} bytes)`);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, text: new TextDecoder().decode(bytes) };
  }
}

async function fetchWithTimeout(url: URL, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { redirect: "manual", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class SizeError extends Error {}

/** Validate bbmodel structure against configured limits. Throws descriptive errors. */
export function validateBbmodel(
  text: string,
  limits: { maxElements: number; maxTextureSize: number },
): { meta: unknown; elementCount: number; textureCount: number } {
  let doc: { meta?: unknown; elements?: unknown[]; textures?: unknown[] };
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("model is not valid JSON");
  }
  if (typeof doc !== "object" || doc === null || !Array.isArray(doc.elements)) {
    throw new Error("missing bbmodel elements array");
  }
  if (doc.elements.length > limits.maxElements) {
    throw new Error(`model has too many elements (${doc.elements.length} > ${limits.maxElements})`);
  }
  const textures = Array.isArray(doc.textures) ? doc.textures.length : 0;
  return { meta: doc.meta, elementCount: doc.elements.length, textureCount: textures };
}
