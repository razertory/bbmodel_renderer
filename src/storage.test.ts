import { describe, expect, it } from "bun:test";
import { loadConfig } from "./config";
import { publicUrlFor, storageKeyFor } from "./storage";

const env = { RENDER_API_KEY: "key", S3_BUCKET: "bucket", PUBLIC_BASE_URL: "https://static.razertory.com/" };

describe("public image URLs", () => {
  it("returns a complete unsigned URL for each output type", () => {
    const config = loadConfig(env);
    expect(publicUrlFor(config, storageKeyFor(config, "hash", "front"))).toBe("https://static.razertory.com/blocky/previews/hash/views-v2/front.webp");
    expect(publicUrlFor(config, storageKeyFor(config, "hash"))).toBe("https://static.razertory.com/blocky/previews/hash/multiview-v2/composite.webp");
  });

  it("preserves a base path and encodes object key characters", () => {
    const config = loadConfig({ ...env, PUBLIC_BASE_URL: "https://example.com/assets/" });
    expect(publicUrlFor(config, "dir/a b?#.webp")).toBe("https://example.com/assets/dir/a%20b%3F%23.webp");
  });

  it("requires a valid public URL without query parameters", () => {
    for (const value of ["", "invalid", "https://example.com/?token=1", "ftp://example.com"]) {
      expect(() => loadConfig({ ...env, PUBLIC_BASE_URL: value })).toThrow();
    }
  });
});
