// Self-host the single-threaded ffmpeg.wasm core (no SharedArrayBuffer / COOP+COEP needed).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@ffmpeg/core/dist/esm");
const out = join(root, "public/ffmpeg");
mkdirSync(out, { recursive: true });
for (const f of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) copyFileSync(join(src, f), join(out, f));
console.log("ffmpeg core copied to public/ffmpeg");
