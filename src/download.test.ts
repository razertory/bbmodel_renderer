import { describe, expect, it } from "bun:test";
import { validateBbmodel } from "./download";

describe("validateBbmodel", () => {
  const limits = { maxElements: 10, maxTextureSize: 2048 };
  it("rejects non-JSON", () => {
    expect(() => validateBbmodel("not json", limits)).toThrow("valid JSON");
  });
  it("rejects missing elements", () => {
    expect(() => validateBbmodel("{}", limits)).toThrow("elements");
  });
  it("rejects too many elements", () => {
    const doc = { elements: Array.from({ length: 11 }, (_, i) => ({ name: i })) };
    expect(() => validateBbmodel(JSON.stringify(doc), limits)).toThrow("too many elements");
  });
  it("accepts a valid model", () => {
    const doc = { meta: { format_version: "4.5" }, elements: [{}], textures: [{}] };
    const r = validateBbmodel(JSON.stringify(doc), limits);
    expect(r.elementCount).toBe(1);
    expect(r.textureCount).toBe(1);
  });
});
