import type { Context, Next } from "hono";
import type { Config } from "./config";
import { tooManyRequests, unauthorized } from "./http";

/** Simple fixed-window rate limiter keyed by API key. */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private limit: number, private windowMs = 60_000) {}

  allow(key: string): boolean {
    const now = Date.now();
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, w);
    }
    w.count++;
    if (this.windows.size > 10_000) {
      for (const [k, win] of this.windows) if (win.resetAt <= now) this.windows.delete(k);
    }
    return w.count <= this.limit;
  }
}

export function authMiddleware(config: Config, limiter: RateLimiter) {
  return async (c: Context, next: Next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return unauthorized(c, "MISSING_API_KEY", "Authorization: Bearer <API_KEY> is required.");
    if (token !== config.apiKey) return unauthorized(c, "INVALID_API_KEY", "API key is invalid.");
    if (!limiter.allow(token)) {
      return tooManyRequests(c, "RATE_LIMITED", "Too many requests from this API key.");
    }
    await next();
  };
}
