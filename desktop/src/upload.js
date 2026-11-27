// Parallel presigned PUTs from disk with per-file retries. Runs in the main process (no CORS).

const fs = require("node:fs");
const path = require("node:path");

const PARALLEL = 6;

async function putFile(url, file, signal) {
  const body = await fs.promises.readFile(file);
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (signal?.aborted) throw Object.assign(new Error("Canceled"), { name: "AbortError" });
    try {
      const r = await fetch(url, { method: "PUT", body, signal });
      if (r.ok) return body.length;
      lastErr = new Error(`Storage returned ${r.status}`);
      if (r.status === 403) break; // expired or bad signature: retrying won't help
    } catch (e) {
      if (e.name === "AbortError") throw e;
      lastErr = e;
    }
    await new Promise((res) => setTimeout(res, 800 * 2 ** attempt));
  }
  throw lastErr;
}

/** Upload `urls` ({relPath: presignedUrl}) from `outDir`. `onBytes(n)` after each file. */
async function uploadAll({ outDir, urls, onBytes, signal }) {
  const entries = Object.entries(urls);
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const [rel, url] = entries[next++];
      const n = await putFile(url, path.join(outDir, rel), signal);
      onBytes(n);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, entries.length) }, worker));
}

module.exports = { uploadAll };
