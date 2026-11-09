import { PutObjectCommand, S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { Config } from "./config";

export function createS3(config: Config): S3Client {
  return new S3Client({
    region: config.s3Region,
    endpoint: config.s3Endpoint || undefined,
    forcePathStyle: config.s3ForcePathStyle,
    credentials:
      config.s3AccessKeyId && config.s3SecretAccessKey
        ? { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey }
        : undefined,
  });
}

export function storageKeyFor(config: Config, contentHash: string, view?: import("./render/views").View): string {
  if (view) return `${config.s3Prefix}${contentHash}/views-v2/${view}.webp`;
  return `${config.s3Prefix}${contentHash}/multiview-v2/composite.webp`;
}

export async function objectExists(client: S3Client, config: Config, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    return true;
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    if (name === "NotFound" || name === "404") return false;
    throw err;
  }
}

export async function uploadObject(
  client: S3Client,
  config: Config,
  key: string,
  body: Uint8Array,
  contentType = "image/webp",
): Promise<void> {
  await client.send(
    new PutObjectCommand({ Bucket: config.s3Bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export function publicUrlFor(config: Config, key: string): string {
  const base = config.publicBaseUrl.replace(/\/+$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return base + "/" + path;
}
