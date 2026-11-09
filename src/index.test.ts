import { afterAll, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";

const PORT = 4599;
const proc = spawn("bun", ["run", "src/index.ts"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    RENDER_API_KEY: "test-key",
    S3_BUCKET: "test-bucket",
    PUBLIC_BASE_URL: "https://static.example.com",
    S3_ENDPOINT: "http://localhost:9000",
    RENDER_CONCURRENCY: "2",
    RATE_LIMIT_PER_MINUTE: "1000",
  },
  stdio: "ignore",
});

const base = `http://localhost:${PORT}`;

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
}

afterAll(() => proc.kill());

describe("http api", () => {
  it("health endpoint works", async () => {
    await waitForServer();
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("requires bearer auth", async () => {
    const res = await fetch(`${base}/v1/previews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelUrl: "https://example.com/m.bbmodel" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("MISSING_API_KEY");
  });

  it("rejects invalid api key", async () => {
    const res = await fetch(`${base}/v1/previews`, {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: JSON.stringify({ modelUrl: "https://example.com/m.bbmodel" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_API_KEY");
  });

  it("400 on missing modelUrl", async () => {
    const res = await fetch(`${base}/v1/previews`, {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("accepts a task and returns 202 with queued status", async () => {
    const res = await fetch(`${base}/v1/previews`, {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ modelUrl: "https://1.1.1.1/m.bbmodel", requestId: "req-1" }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(["queued", "running"]).toContain(body.status);
    expect(body.requestId).toBe("req-1");

    // poll
    const poll = await fetch(`${base}/v1/tasks/${body.taskId}`, {
      headers: { authorization: "Bearer test-key" },
    });
    expect(poll.status).toBe(200);
    const pollBody = await poll.json();
    expect(["queued", "running", "ready", "failed"]).toContain(pollBody.status);
    // download of example.com will fail asynchronously → should end failed with DOWNLOAD_FAILED
    let final = pollBody;
    for (let i = 0; i < 50 && (final.status === "queued" || final.status === "running"); i++) {
      await new Promise((r) => setTimeout(r, 100));
      const r2 = await fetch(`${base}/v1/tasks/${body.taskId}`, { headers: { authorization: "Bearer test-key" } });
      final = await r2.json();
    }
    // network-dependent: assert deterministic failure with a sane error code
    // (INVALID_MODEL classification is unit-tested in download.test.ts)
    expect(final.status).toBe("failed");
    expect(["INVALID_MODEL", "INVALID_URL", "DOWNLOAD_FAILED"]).toContain(final.error.code);
  });

  it("rejects private URLs with INVALID_URL", async () => {
    const res = await fetch(`${base}/v1/previews`, {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ modelUrl: "https://169.254.169.254/latest/meta-data/", requestId: "req-ssrf" }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    let final = body;
    for (let i = 0; i < 50 && (final.status === "queued" || final.status === "running"); i++) {
      await new Promise((r) => setTimeout(r, 100));
      const r2 = await fetch(`${base}/v1/tasks/${body.taskId}`, { headers: { authorization: "Bearer test-key" } });
      final = await r2.json();
    }
    expect(final.status).toBe("failed");
    expect(final.error.code).toBe("INVALID_URL");
  });

  it("dedupes concurrent same requestId", async () => {
    const opts = {
      method: "POST" as const,
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ modelUrl: "https://192.0.2.1/m.bbmodel", requestId: "req-dup" }), // TEST-NET-1: hangs, stays in-flight
    };
    const [a, b] = await Promise.all([fetch(`${base}/v1/previews`, opts), fetch(`${base}/v1/previews`, opts)]);
    const ba = await a.json();
    const bb = await b.json();
    expect(ba.taskId).toBe(bb.taskId);
  });

  it("404 for unknown task", async () => {
    const res = await fetch(`${base}/v1/tasks/task_nope`, { headers: { authorization: "Bearer test-key" } });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("TASK_NOT_FOUND");
  });
});

describe("view selection", () => {
  it("rejects invalid view selections", async () => {
    await waitForServer();
    for (const views of [[], ["unknown"], ["front", "front"], "front", null]) {
      const res = await fetch(`${base}/v1/previews`, {
        method: "POST",
        headers: { authorization: "Bearer test-key", "content-type": "application/json" },
        body: JSON.stringify({ modelUrl: "https://example.com/m.bbmodel", views }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_REQUEST");
    }
  });

  it("accepts multiple supported views", async () => {
    const res = await fetch(`${base}/v1/previews`, {
      method: "POST",
      headers: { authorization: "Bearer test-key", "content-type": "application/json" },
      body: JSON.stringify({ modelUrl: "https://example.com/m.bbmodel", views: ["front", "top", "bottom"] }),
    });
    expect(res.status).toBe(202);
  });
});

describe("API documentation", () => {
  it("serves Swagger UI and a matching OpenAPI document", async () => {
    await waitForServer();
    const page = await fetch(`${base}/docs`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("SwaggerUIBundle");
    for (const asset of ["swagger-ui.css", "swagger-ui-bundle.js"]) {
      expect((await fetch(`${base}/docs-assets/${asset}`)).status).toBe(200);
    }
    expect((await fetch(`${base}/docs-assets/other.js`)).status).toBe(404);
    const spec = await (await fetch(`${base}/openapi.json`)).json();
    expect(spec.paths["/v1/previews"].post.security).toEqual([{ bearerAuth: [] }]);
    expect(spec.components.schemas.PreviewRequest.properties.views.items.enum).toEqual(["isometric", "front", "back", "left", "right", "top", "bottom"]);
    expect(spec.paths["/v1/tasks/{taskId}"].get).toBeDefined();
  });
});
