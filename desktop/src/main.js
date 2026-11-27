// dhara desktop: an Electron shell around the dashboard that adds on-device compression and
// parallel uploads. The renderer never sees R2 credentials, only presigned URLs from the API.

const { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { probe, transcode, detectEncoder } = require("./transcode");
const { uploadAll } = require("./upload");

const config = loadConfig();
const SCHEME = "app";
const ORIGIN = `${SCHEME}://dhara`;
const RENDERER = path.join(__dirname, "..", "renderer");
const jobs = new Map(); // jobId -> { ac, workDir, total, sent }

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function loadConfig() {
  // Packaged builds bake config.json (from DHARA_API_BASE / DHARA_PLAYER_ORIGIN at build time).
  // In development the environment wins.
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8"));
  } catch {
    /* defaults */
  }
  const dev = !app.isPackaged;
  const devUrl = dev ? process.env.DHARA_DEV_URL || "" : "";
  return {
    // Against the Vite dev server the API is same-origin (proxied), so the base stays empty.
    apiBase: devUrl ? "" : (dev && process.env.DHARA_API_BASE) || file.apiBase || "http://localhost:8000",
    playerOrigin: (dev && process.env.DHARA_PLAYER_ORIGIN) || file.playerOrigin || "http://localhost:8000",
    devUrl,
  };
}

// ---------------- secure token storage ----------------

const tokenFile = () => path.join(app.getPath("userData"), "session.bin");

function getRefresh() {
  try {
    const buf = fs.readFileSync(tokenFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null;
  } catch {
    return null;
  }
}

function setRefresh(token) {
  if (!token) return fs.rmSync(tokenFile(), { force: true });
  if (!safeStorage.isEncryptionAvailable()) return; // never write a refresh token in plain text
  fs.writeFileSync(tokenFile(), safeStorage.encryptString(token), { mode: 0o600 });
}

// ---------------- window ----------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "dhara",
    backgroundColor: "#f7f7f4",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [`--dhara-api=${config.apiBase}`, `--dhara-version=${app.getVersion()}`],
    },
  });
  // Links (docs, embed previews in a new tab) open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN) && !(config.devUrl && url.startsWith(config.devUrl))) e.preventDefault();
  });
  if (process.env.DHARA_SMOKE === "1" && !app.isPackaged) require("../scripts/smoke")(win, app);
  win.loadURL(config.devUrl || `${ORIGIN}/app`);
  return win;
}

function serveRenderer() {
  // SPA: real files are served as-is, every other path gets index.html.
  protocol.handle(SCHEME, (req) => {
    const { pathname } = new URL(req.url);
    let file = path.normalize(path.join(RENDERER, decodeURIComponent(pathname)));
    if (!file.startsWith(RENDERER) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(RENDERER, "index.html");
    return net.fetch(require("node:url").pathToFileURL(file).toString());
  });
}

function stampPlayerReferer() {
  // Custom-scheme pages send no Referer; the gate trusts the desktop origin for dashboard previews.
  const filter = { urls: [`${config.playerOrigin}/*`] };
  session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, cb) => {
    if (!details.requestHeaders.Referer && !details.requestHeaders.referer) details.requestHeaders.Referer = `${ORIGIN}/`;
    cb({ requestHeaders: details.requestHeaders });
  });
}

// ---------------- IPC ----------------

function send(win, payload) {
  if (!win.isDestroyed()) win.webContents.send("dhara:progress", payload);
}

function registerIpc() {
  ipcMain.handle("dhara:getRefresh", () => getRefresh());
  ipcMain.handle("dhara:setRefresh", (_e, token) => setRefresh(token));
  ipcMain.handle("dhara:encoders", async () => {
    const enc = await detectEncoder();
    return { hardware: enc === "libx264" ? null : enc };
  });

  ipcMain.handle("dhara:pickFiles", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      title: "Choose videos",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "webm", "m4v", "avi", "mts", "wmv", "flv"] }],
    });
    return r.canceled ? [] : r.filePaths.map((p) => ({ path: p, name: path.basename(p), size: fs.statSync(p).size }));
  });

  ipcMain.handle("dhara:probe", (_e, file) => probe(file));

  ipcMain.handle("dhara:transcode", async (e, jobId, file, opts) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dhara-"));
    const job = { ac: new AbortController(), workDir, total: 0, sent: 0 };
    jobs.set(jobId, job);
    let last = 0;
    const result = await transcode({
      input: file,
      workDir,
      heights: opts.heights,
      keyHex: opts.keyHex,
      keyUri: opts.keyUri,
      segmentSeconds: opts.segmentSeconds,
      signal: job.ac.signal,
      onProgress: (p) => {
        const now = Date.now();
        if (now - last > 250 || p >= 1) {
          last = now;
          send(win, { jobId, phase: "transcoding", progress: p, detail: undefined });
        }
      },
    });
    job.total = result.sizeBytes + (result.hasThumbnail ? fs.statSync(path.join(workDir, "out", "thumb.jpg")).size : 0);
    send(win, { jobId, phase: "transcoding", progress: 1, detail: result.encoder === "libx264" ? "software encoder" : "hardware encoder" });
    return result;
  });

  ipcMain.handle("dhara:upload", async (e, jobId, urls) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const job = jobs.get(jobId);
    if (!job) throw new Error("Unknown upload job");
    await uploadAll({
      outDir: path.join(job.workDir, "out"),
      urls,
      signal: job.ac.signal,
      onBytes: (n) => {
        job.sent += n;
        send(win, { jobId, phase: "uploading", progress: job.total ? job.sent / job.total : 0 });
      },
    });
  });

  ipcMain.handle("dhara:cancel", (_e, jobId) => jobs.get(jobId)?.ac.abort());
  ipcMain.handle("dhara:cleanup", (_e, jobId) => {
    const job = jobs.get(jobId);
    if (job) fs.rmSync(job.workDir, { recursive: true, force: true });
    jobs.delete(jobId);
  });
}

app.whenReady().then(() => {
  serveRenderer();
  stampPlayerReferer();
  registerIpc();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on("before-quit", (e) => {
  const busy = [...jobs.values()].length;
  if (!busy) return;
  const choice = dialog.showMessageBoxSync({
    type: "warning",
    buttons: ["Keep uploading", "Quit anyway"],
    defaultId: 0,
    message: "Videos are still being compressed or uploaded.",
    detail: "Quitting now cancels them. You'll need to upload them again.",
  });
  if (choice === 0) e.preventDefault();
  else for (const j of jobs.values()) j.ac.abort();
});

app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
