export type JobStatus = "queued" | "running" | "ready" | "failed";

export interface PreviewResult {
  storageKey: string;
  url: string;
  expiresAt: string;
  width: number;
  height: number;
  warnings: string[];
}

export interface PreviewTask {
  id: string;
  requestId: string;
  modelUrl: string;
  status: JobStatus;
  createdAt: number;
  finishedAt?: number;
  result?: PreviewResult;
  errorCode?: string;
  errorMessage?: string;
}

export class TaskQueue {
  private tasks = new Map<string, PreviewTask>();
  private waiting: PreviewTask[] = [];
  private running = 0;
  private dedupe = new Map<string, string>(); // requestId -> taskId (in-flight)
  private taskCounter = 0;

  constructor(
    private concurrency: number,
    private maxLength: number,
    private worker: (task: PreviewTask) => Promise<void>,
    private retentionMs = 60 * 60 * 1000,
    private readyDedupeMs = 60 * 1000,
  ) {}

  get size(): number {
    return this.waiting.length + this.running;
  }

  /** Returns existing task for requestId while in flight, or recently ready (dedupe window). */
  findInFlight(requestId: string): PreviewTask | undefined {
    const id = this.dedupe.get(requestId);
    if (!id) return undefined;
    const t = this.tasks.get(id);
    if (!t) return undefined;
    if (t.status === "failed") return undefined; // failed tasks are immediately re-submittable
    if (t.finishedAt && Date.now() - t.finishedAt > this.readyDedupeMs) return undefined;
    return t;
  }

  enqueue(task: PreviewTask): boolean {
    if (this.size >= this.maxLength) return false;
    this.tasks.set(task.id, task);
    this.dedupe.set(task.requestId, task.id);
    this.waiting.push(task);
    this.prune();
    this.pump();
    return true;
  }

  get(taskId: string): PreviewTask | undefined {
    return this.tasks.get(taskId);
  }

  private prune() {
    const cutoff = Date.now() - this.retentionMs;
    if (this.tasks.size < 5000) return;
    for (const [id, t] of this.tasks) {
      if (t.finishedAt && t.finishedAt < cutoff) {
        this.tasks.delete(id);
        if (this.dedupe.get(t.requestId) === id) this.dedupe.delete(t.requestId);
      }
    }
  }

  private pump() {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const task = this.waiting.shift()!;
      this.running++;
      task.status = "running";
      this.worker(task)
        .catch((err) => {
          task.status = "failed";
          task.errorCode = err?.code ?? "RENDER_FAILED";
          task.errorMessage = String(err?.message ?? err);
        })
        .finally(() => {
          task.finishedAt = Date.now();
          this.running--;
          if (task.status === "failed" && this.dedupe.get(task.requestId) === task.id) {
            this.dedupe.delete(task.requestId);
          }
          this.pump();
        });
    }
  }
}

let taskSeq = 0;
export function newTaskId(): string {
  return `task_${Date.now().toString(36)}_${(++taskSeq).toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}
