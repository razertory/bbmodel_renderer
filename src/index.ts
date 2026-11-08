import { Hono } from "hono";
import { loadConfig } from "./config";
import { authMiddleware, RateLimiter } from "./auth";
import { TaskQueue } from "./queue";
import { createS3 } from "./storage";
import { runPipeline } from "./pipeline";
import { previewsRoute } from "./routes/previews";

const config = loadConfig();
const limiter = new RateLimiter(config.rateLimitPerMinute);
const s3 = createS3(config);
const queue = new TaskQueue(config.concurrency, config.queueMaxLength, async (task) => {
  await runPipeline(task, { config, s3 });
});

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok", queue: queue.size, concurrency: config.concurrency }));
app.use("/v1/*", authMiddleware(config, limiter));
app.route("/", previewsRoute(config, queue));

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
});

console.log(`renderer listening on http://localhost:${config.port} (concurrency=${config.concurrency})`);

export { app, server };
