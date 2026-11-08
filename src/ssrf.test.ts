import { describe, expect, it } from "bun:test";
import { assertPublicHttpUrl, isPrivateV4, isPrivateV6 } from "./ssrf";

const blocked = [
  "http://example.com/x", // not https
  "https://localhost/x",
  "https://127.0.0.1/x",
  "https://10.0.0.1/x",
  "https://172.16.0.1/x",
  "https://192.168.1.1/x",
  "https://169.254.169.254/latest/meta-data/",
  "https://[::1]/x",
  "https://[fe80::1]/x",
  "https://metadata.google.internal/x",
];

const allowed = [
  "https://storage.example.com/models/example.bbmodel",
  "https://8.8.8.8/x",
  "https://s3.us-east-1.amazonaws.com/bucket/key",
];

describe("ssrf", () => {
  it("blocks private and non-https URLs", () => {
    for (const u of blocked) expect(() => assertPublicHttpUrl(u)).toThrow();
  });
  it("allows public https URLs", () => {
    for (const u of allowed) expect(() => assertPublicHttpUrl(u)).not.toThrow();
  });
  it("classifies ipv4 ranges", () => {
    expect(isPrivateV4("127.0.0.1")).toBe(true);
    expect(isPrivateV4("192.168.0.15")).toBe(true);
    expect(isPrivateV4("8.8.8.8")).toBe(false);
  });
  it("classifies ipv6", () => {
    expect(isPrivateV6("::1")).toBe(true);
    expect(isPrivateV6("fd00::1")).toBe(true);
    expect(isPrivateV6("2606:4700::1")).toBe(false);
  });
});
