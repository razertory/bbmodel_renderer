import type { Context } from "hono";

export type ErrorCode =
  | "MISSING_API_KEY"
  | "INVALID_API_KEY"
  | "INVALID_REQUEST"
  | "INVALID_URL"
  | "INVALID_MODEL"
  | "MODEL_TOO_LARGE"
  | "TEXTURE_TOO_LARGE"
  | "TOO_MANY_ELEMENTS"
  | "QUEUE_FULL"
  | "RATE_LIMITED"
  | "TASK_NOT_FOUND"
  | "DOWNLOAD_FAILED"
  | "SSRF_BLOCKED"
  | "RENDER_FAILED"
  | "RENDER_TIMEOUT"
  | "UPLOAD_FAILED";

export function errorBody(requestId: string | null, code: ErrorCode, message: string) {
  return {
    requestId,
    error: { code, message },
  };
}

export function badRequest(c: Context, code: ErrorCode, message: string, requestId: string | null = null) {
  return c.json(errorBody(requestId, code, message), 400);
}

export function unauthorized(c: Context, code: ErrorCode, message: string) {
  return c.json(errorBody(null, code, message), 401);
}

export function tooManyRequests(c: Context, code: ErrorCode, message: string) {
  return c.json(errorBody(null, code, message), 429);
}

export function payloadTooLarge(c: Context, code: ErrorCode, message: string, requestId: string | null = null) {
  return c.json(errorBody(requestId, code, message), 413);
}

export function badGateway(c: Context, code: ErrorCode, message: string, requestId: string | null) {
  return c.json(errorBody(requestId, code, message), 502);
}
