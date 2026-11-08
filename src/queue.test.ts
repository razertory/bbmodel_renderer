import { describe, expect, it } from "bun:test";
import { TaskQueue, type PreviewTask } from "./queue";

function makeTask(i: number): PreviewTask {
  return { id: `t${i}`, requestId: `r${i}`, modelUrl: "https://example.com/m.bbmodel", status: "queued", createdAt: Date.now() };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("TaskQueue", () => {
  it("runs up to concurrency and reports statuses", async () => {
    const events: string[] = [];
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let gateIndex = 0;
    const q = new TaskQueue(2, 10, async (t) => {
      await gates[gateIndex++]!.promise;
      events.push(t.id);
      t.status = "ready";
    });
    for (let i = 0; i < 4; i++) expect(q.enqueue(makeTask(i))).toBe(true);
    expect(q.size).toBe(4);
    await new Promise((r) => setTimeout(r, 10));
    expect(q.get("t0")!.status).toBe("running");
    expect(q.get("t2")!.status).toBe("queued");
    gates[0].resolve();
    gates[1].resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual(["t0", "t1"]);
    gates[2].resolve();
    gates[3].resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual(["t0", "t1", "t2", "t3"]);
    expect(q.get("t0")!.status).toBe("ready");
    expect(q.size).toBe(0);
  });

  it("rejects when in-flight (running + waiting) reaches max length", () => {
    const gates = [deferred(), deferred(), deferred()];
    let gateIndex = 0;
    const q = new TaskQueue(1, 3, async () => { await gates[gateIndex++]!.promise; });
    expect(q.enqueue(makeTask(0))).toBe(true);
    expect(q.enqueue(makeTask(1))).toBe(true);
    expect(q.enqueue(makeTask(2))).toBe(true);
    expect(q.enqueue(makeTask(3))).toBe(false);
    gates.forEach((g) => g.resolve());
  });

  it("worker errors mark task failed", async () => {
    const q = new TaskQueue(1, 5, async () => {
      const e = new Error("boom") as Error & { code?: string };
      e.code = "RENDER_FAILED";
      throw e;
    });
    q.enqueue(makeTask(9));
    await new Promise((r) => setTimeout(r, 10));
    const t = q.get("t9")!;
    expect(t.status).toBe("failed");
    expect(t.errorCode).toBe("RENDER_FAILED");
  });

  it("keeps ready task dedupable for a short window, failed re-submittable", async () => {
    const q = new TaskQueue(1, 5, async (t) => { t.status = "ready"; });
    q.enqueue({ ...makeTask(1), requestId: "same" });
    await new Promise((r) => setTimeout(r, 5));
    const hit = q.findInFlight("same");
    expect(hit?.status).toBe("ready");

    const q2 = new TaskQueue(1, 5, async () => { throw new Error("x"); });
    q2.enqueue({ ...makeTask(2), requestId: "bad" });
    await new Promise((r) => setTimeout(r, 10));
    expect(q2.findInFlight("bad")).toBeUndefined();
  });
});
