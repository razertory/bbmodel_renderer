/**
 * Browser-side render entry. Bundled to assets/renderer.bundle.js and injected
 * into a Playwright page. Exposes window.__renderMultiview(bbmodelText, opts).
 */
import * as THREE from "three";
import { BBModelLoader } from "three-blockbench";

export interface RenderOptions {
  views: string[];
  cellWidth: number;
  cellHeight: number;
  labelPrefix?: string;
}

const LABELS: Record<string, string> = {
  front: "Front",
  back: "Back",
  left: "Left",
  right: "Right",
  top: "Top",
  isometric: "Isometric",
};

async function renderMultiview(text: string, opts: RenderOptions): Promise<{ webpBase64: string; width: number; height: number }> {
  const loader = new BBModelLoader(new THREE.LoadingManager(), { loadTextures: true });
  const bb = await loader.parseAsync(text);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f4f5);
  scene.add(bb.scene);

  const ambient = new THREE.AmbientLight(0xffffff, 1.6);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 1.4);
  dir.position.set(2, 4, 3);
  scene.add(dir);

  // Fit camera to model bounds
  const box = new THREE.Box3().setFromObject(bb.scene);
  if (box.isEmpty()) throw new Error("model has empty bounds");
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) || 1;

  const { cellWidth, cellHeight, views } = opts;
  const cols = Math.min(3, views.length);
  const rows = Math.ceil(views.length / cols);
  const composite = document.createElement("canvas");
  composite.width = cols * cellWidth;
  composite.height = rows * cellHeight;
  const ctx = composite.getContext("2d")!;
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(0, 0, composite.width, composite.height);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(cellWidth, cellHeight, false);

  const camera = new THREE.PerspectiveCamera(40, cellWidth / cellHeight, radius / 100, radius * 20);

  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    const dirVec = new THREE.Vector3();
    switch (view) {
      case "front": dirVec.set(0, 0, 1); break;
      case "back": dirVec.set(0, 0, -1); break;
      case "left": dirVec.set(-1, 0, 0); break;
      case "right": dirVec.set(1, 0, 0); break;
      case "top": dirVec.set(0, 1, 0.001); break;
      default: dirVec.set(1, 1, 1); break; // isometric
    }
    camera.position.copy(center).add(dirVec.multiplyScalar(radius * 2.2));
    camera.lookAt(center);

    renderer.render(scene, camera);
    const x = (i % cols) * cellWidth;
    const y = Math.floor(i / cols) * cellHeight;
    ctx.drawImage(renderer.domElement, x, y, cellWidth, cellHeight);

    // label
    const label = LABELS[view] ?? view;
    ctx.fillStyle = "rgba(24,24,27,0.82)";
    const pad = 6;
    ctx.font = "600 16px system-ui, sans-serif";
    const tw = ctx.measureText(label).width;
    ctx.fillRect(x + pad, y + pad, tw + pad * 2, 26);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + pad * 2, y + pad + 18);
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    composite.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/webp", 90),
  );
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of buf) binary += String.fromCharCode(byte);
  const webpBase64 = btoa(binary);

  bb.dispose();
  renderer.dispose();
  return { webpBase64, width: composite.width, height: composite.height };
}

declare global {
  interface Window {
    __renderMultiview: typeof renderMultiview;
  }
}
window.__renderMultiview = renderMultiview;
