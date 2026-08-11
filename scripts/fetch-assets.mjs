/**
 * Stage the MediaPipe assets into public/ so the game serves them itself.
 *
 * The wasm runtime already ships inside the @mediapipe/tasks-vision package,
 * so it is copied rather than downloaded. Only the pose model is fetched, from
 * Google's official model host.
 *
 * Runs automatically after `npm install`. Keeping these out of git leaves the
 * repository small while still giving the built site its own copies, so the
 * game has no CDN dependency at runtime.
 */
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WASM_SRC = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const WASM_DEST = join(root, "public", "mediapipe", "wasm");
const MODEL_DEST = join(root, "public", "models", "pose_landmarker_lite.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

/**
 * The ES-module variant is not used by FilesetResolver.forVisionTasks() in this
 * app and is another 12MB, so it is skipped.
 */
const SKIP = /vision_wasm_module_internal/;

const exists = (p) => stat(p).then(() => true, () => false);

async function copyWasm() {
  if (!(await exists(WASM_SRC))) {
    throw new Error(`MediaPipe wasm not found at ${WASM_SRC}. Run npm install first.`);
  }
  await mkdir(WASM_DEST, { recursive: true });
  const files = (await readdir(WASM_SRC)).filter((f) => !SKIP.test(f));
  for (const file of files) {
    await copyFile(join(WASM_SRC, file), join(WASM_DEST, file));
  }
  console.log(`[assets] copied ${files.length} wasm files -> public/mediapipe/wasm`);
}

async function fetchModel() {
  if (await exists(MODEL_DEST)) {
    console.log("[assets] pose model already present, skipping download");
    return;
  }
  await mkdir(dirname(MODEL_DEST), { recursive: true });
  console.log("[assets] downloading pose model…");

  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`Model download failed: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(MODEL_DEST));

  const { size } = await stat(MODEL_DEST);
  console.log(`[assets] pose model saved (${(size / 1e6).toFixed(1)} MB)`);
}

await copyWasm();
await fetchModel();
