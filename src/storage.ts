import { GetObjectCommand, PutObjectCommand, S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

export function storageKeyFor(config: Config, contentHash: string): string {
  return `${config.s3Prefix}${contentHash}/multiview-v1/composite.webp`;
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

/**
 * Presign a short-lived GET URL. When PUBLIC_BASE_URL is set (path-style storage behind a
 * public gateway/custom domain), the origin is swapped while the /bucket/key path is kept.
 */
export async function presignUrl(
  client: S3Client,
  config: Config,
  key: string,
): Promise<{ url: string; expiresAt: string }> {
  const signed = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }),
    { expiresIn: config.presignExpiresSeconds },
  );
  const expiresAt = new Date(Date.now() + config.presignExpiresSeconds * 1000).toISOString();
  if (config.publicBaseUrl) {
    const u = new URL(signed);
    const pub = new URL(config.publicBaseUrl);
    u.protocol = pub.protocol;
    u.hostname = pub.hostname;
    u.port = pub.port;
    return { url: u.toString(), expiresAt };
  }
  return { url: signed, expiresAt };
}
