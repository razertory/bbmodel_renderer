import { Hono } from "hono";
import type { Config } from "../config";
import { badRequest } from "../http";
import type { TaskQueue } from "../queue";
import { newTaskId, type PreviewTask } from "../queue";

export function previewsRoute(config: Config, queue: TaskQueue) {
  const app = new Hono();

  app.post("/v1/previews", async (c) => {
    let body: { modelUrl?: unknown; requestId?: unknown };
    try {
      body = await c.req.json();
    } catch {
      return badRequest(c, "INVALID_REQUEST", "request body must be JSON");
    }
    const modelUrl = typeof body.modelUrl === "string" ? body.modelUrl : "";
    const requestId = typeof body.requestId === "string" && body.requestId ? body.requestId : crypto.randomUUID();
    if (!modelUrl) {
      return badRequest(c, "INVALID_REQUEST", "modelUrl is required", requestId);
    }
    try {
      new URL(modelUrl);
    } catch {
      return badRequest(c, "INVALID_URL", "modelUrl is not a valid URL", requestId);
    }

    // in-flight dedupe by requestId
    const existing = queue.findInFlight(requestId);
    if (existing) {
      return c.json(taskEnvelope(existing), 202);
    }

    const task: PreviewTask = {
      id: newTaskId(),
      requestId,
      modelUrl,
      status: "queued",
      createdAt: Date.now(),
    };
    if (!queue.enqueue(task)) {
      return c.json(
        { requestId, error: { code: "QUEUE_FULL", message: "render queue is full; retry later" } },
        429,
      );
    }
    return c.json(taskEnvelope(task), 202);
  });

  app.get("/v1/tasks/:taskId", (c) => {
    const task = queue.get(c.req.param("taskId"));
    if (!task) {
      return c.json({ requestId: null, error: { code: "TASK_NOT_FOUND", message: "unknown task id" } }, 404);
    }
    const status = task.status === "ready" || task.status === "failed" ? 200 : 200;
    return c.json(taskEnvelope(task), status as 200);
  });

  return app;
}

function taskEnvelope(task: PreviewTask) {
  const body: Record<string, unknown> = {
    taskId: task.id,
    requestId: task.requestId,
    status: task.status,
  };
  if (task.result) body.result = task.result;
  if (task.errorCode) body.error = { code: task.errorCode, message: task.errorMessage ?? "" };
  return body;
}
