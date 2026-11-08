import { chromium, type Browser } from "playwright-core";
import { existsSync } from "node:fs";
import path from "node:path";

let browserPromise: Promise<Browser> | null = null;

function bundlePath(): string {
  const p = path.resolve(import.meta.dir, "../../assets/renderer.bundle.js");
  if (!existsSync(p)) {
    throw new Error("renderer bundle missing; run `bun run build:renderer`");
  }
  return p;
}

export function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch({
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--disable-gpu-sandbox",
    ],
  });
  return browserPromise;
}

export interface RenderOutput {
  webp: Uint8Array;
  width: number;
  height: number;
}

const VIEWS = ["isometric", "front", "back", "left", "right"];

export async function renderMultiviewWebp(
  bbmodelText: string,
  timeoutMs: number,
): Promise<RenderOutput> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    // 3x2 grid of 512x512 cells → 1536x1024 + label padding handled in-page
    viewport: { width: 1600, height: 1200 },
    serviceWorkers: "block",
  });
  // Block all outbound requests from the page — textures must be embedded in the bbmodel.
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http")) return route.abort();
    return route.continue();
  });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.goto("about:blank");
    await page.addScriptTag({ path: bundlePath() });
    const result = await page.evaluate(
      async ({ text, views, cellWidth, cellHeight }) =>
        await window.__renderMultiview(text, { views, cellWidth, cellHeight }),
      { text: bbmodelText, views: VIEWS, cellWidth: 512, cellHeight: 512 },
    );
    return {
      webp: Uint8Array.from(atob(result.webpBase64), (ch) => ch.charCodeAt(0)),
      width: result.width,
      height: result.height,
    };
  } finally {
    await context.close();
  }
}
