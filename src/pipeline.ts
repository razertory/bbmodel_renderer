import { createHash } from "node:crypto";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Config } from "./config";
import { downloadModel, SizeError, validateBbmodel } from "./download";
import { renderMultiviewWebp } from "./render/browser";
import { objectExists, presignUrl, storageKeyFor, uploadObject } from "./storage";
import type { PreviewTask } from "./queue";

export class CodedError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface PipelineDeps {
  config: Config;
  s3: S3Client;
}

/**
 * Full job pipeline: download → validate → render → upload → presign.
 * Mutates task on success; throws CodedError on failure.
 */
export async function runPipeline(task: PreviewTask, deps: PipelineDeps): Promise<void> {
  const { config, s3 } = deps;
  const warnings: string[] = [];

  // 1. download
  let downloaded;
  try {
    downloaded = await downloadModel(config, task.modelUrl);
  } catch (err) {
    if (err instanceof SizeError) throw new CodedError("MODEL_TOO_LARGE", err.message);
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("private") || msg.includes("not allowed")) {
      throw new CodedError("INVALID_URL", msg);
    }
    throw new CodedError("DOWNLOAD_FAILED", `failed to download model: ${msg}`);
  }

  // 2. validate
  try {
    const info = validateBbmodel(downloaded.text, {
      maxElements: config.maxElements,
      maxTextureSize: config.maxTextureSize,
    });
    if (info.textureCount === 0) warnings.push("model contains no textures; output will be untextured");
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (msg.includes("too many elements")) throw new CodedError("TOO_MANY_ELEMENTS", msg);
    throw new CodedError("INVALID_MODEL", msg);
  }

  // 3. content-hash cache (cross-restart via S3 HEAD)
  const contentHash = createHash("sha256").update(downloaded.bytes).digest("hex");
  const views = task.views ?? [undefined];
  const images = [];
  let cached = false;
  for (const view of views) {
    const key = storageKeyFor(config, contentHash, view);
    let width = view ? 515 : 1536;
    let height = view ? 512 : 1024;
    if (await objectExists(s3, config, key)) {
      cached = true;
    } else {
      let rendered;
      try {
        rendered = await withTimeout(renderMultiviewWebp(downloaded.text, config.renderTimeoutMs, view), config.renderTimeoutMs, "RENDER_TIMEOUT", "render timed out");
      } catch (err) {
        if (err instanceof CodedError) throw err;
        throw new CodedError("RENDER_FAILED", "render failed: " + String((err as Error)?.message ?? err));
      }
      try {
        await uploadObject(s3, config, key, rendered.webp);
      } catch (err) {
        throw new CodedError("UPLOAD_FAILED", "failed to upload preview: " + String((err as Error)?.message ?? err));
      }
      width = rendered.width;
      height = rendered.height;
    }
    const presigned = await presignUrl(s3, config, key);
    images.push({ view, storageKey: key, url: presigned.url, expiresAt: presigned.expiresAt, width, height });
  }
  if (cached) warnings.push("reused cached render");
  task.status = "ready";
  if (task.views) {
    task.result = { images: images as import("./queue").PreviewImage[], warnings };
  } else {
    const { view, ...image } = images[0];
    task.result = { ...image, warnings };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, code: string, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CodedError(code, message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
