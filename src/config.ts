export interface Config {
  port: number;
  apiKey: string;
  // queue
  concurrency: number;
  queueMaxLength: number;
  rateLimitPerMinute: number;
  // download
  maxModelBytes: number;
  downloadTimeoutMs: number;
  maxRedirects: number;
  // render
  renderTimeoutMs: number;
  maxElements: number;
  maxTextureSize: number;
  // storage
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  s3ForcePathStyle: boolean;
  s3Prefix: string;
  publicBaseUrl: string;
}

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const apiKey = env.RENDER_API_KEY;
  if (!apiKey) throw new Error("RENDER_API_KEY is required");
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is required");
  const publicBaseUrl = env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) throw new Error("PUBLIC_BASE_URL is required");
  let publicUrl: URL;
  try { publicUrl = new URL(publicBaseUrl); } catch { throw new Error("PUBLIC_BASE_URL must be a valid HTTP(S) URL"); }
  if (!["http:", "https:"].includes(publicUrl.protocol) || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password) {
    throw new Error("PUBLIC_BASE_URL must be an HTTP(S) URL without credentials, query or fragment");
  }
  return {
    port: num(env.PORT, 3000),
    apiKey,
    concurrency: num(env.RENDER_CONCURRENCY, 2),
    queueMaxLength: num(env.QUEUE_MAX_LENGTH, 100),
    rateLimitPerMinute: num(env.RATE_LIMIT_PER_MINUTE, 30),
    maxModelBytes: num(env.MAX_MODEL_BYTES, 50 * 1024 * 1024),
    downloadTimeoutMs: num(env.DOWNLOAD_TIMEOUT_MS, 30_000),
    maxRedirects: num(env.MAX_REDIRECTS, 3),
    renderTimeoutMs: num(env.RENDER_TIMEOUT_MS, 60_000),
    maxElements: num(env.MAX_ELEMENTS, 100_000),
    maxTextureSize: num(env.MAX_TEXTURE_SIZE, 2048),
    s3Endpoint: env.S3_ENDPOINT ?? "",
    s3Region: env.S3_REGION ?? "us-east-1",
    s3Bucket: bucket,
    s3AccessKeyId: env.S3_ACCESS_KEY_ID ?? "",
    s3SecretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    s3ForcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    s3Prefix: (env.S3_PREFIX ?? "blocky/previews/").replace(/^\//, ""),
    publicBaseUrl,
  };
}
