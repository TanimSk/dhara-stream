// Build the dashboard for the desktop shell and bake API/player origins into config.json.
import { execSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
execSync("npm run build:desktop", { cwd: join(root, "..", "web"), stdio: "inherit" });
// The desktop app never shows the marketing page or runs ffmpeg.wasm.
for (const p of ["media", "ffmpeg"]) rmSync(join(root, "renderer", p), { recursive: true, force: true });
const apiBase = process.env.DHARA_API_BASE || "http://localhost:8000";
const playerOrigin = process.env.DHARA_PLAYER_ORIGIN || apiBase;
writeFileSync(join(root, "config.json"), JSON.stringify({ apiBase, playerOrigin }, null, 2) + "\n");
console.log(`renderer built · api ${apiBase} · player ${playerOrigin}`);
