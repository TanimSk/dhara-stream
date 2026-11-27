// Dev-only (DHARA_SMOKE=1, unpackaged): drive the real renderer bridge end to end, screenshot, quit.
const fs = require("node:fs");
const path = require("node:path");

module.exports = function smoke(win, app) {
  const out = process.env.DHARA_SMOKE_OUT || path.join(require("node:os").tmpdir(), "dhara-smoke.png");
  const sample = process.env.DHARA_SMOKE_FILE;
  win.webContents.once("did-finish-load", async () => {
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const d = window.dharaDesktop;
        if (!d) throw new Error("bridge missing");
        const api = (p, o = {}) => fetch(d.apiBase + "/api/v1" + p, { ...o, headers: { "Content-Type": "application/json", ...(o.headers || {}) } }).then(async r => ({ status: r.status, body: await r.json() }));
        const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: "demo@dhara.local", password: "dhara-dev-123", device: "desktop" }) });
        if (login.status !== 200) throw new Error("login " + login.status);
        await d.setRefresh(login.body.refresh);
        const auth = { Authorization: "Bearer " + login.body.access };
        const probe = await d.probe(${JSON.stringify(sample)});
        const created = await api("/videos", { method: "POST", headers: auth, body: JSON.stringify({ title: "Desktop smoke test", source: "hls", uploaded_via: "desktop", original_filename: "sample.mp4" }) });
        const { video, upload } = created.body;
        const t = await d.transcode("smoke", ${JSON.stringify(sample)}, { heights: [1080, 720, 480], keyHex: upload.key_hex, keyUri: upload.key_uri, segmentSeconds: 6 });
        const urls = await api("/videos/" + video.id + "/upload-urls", { method: "POST", headers: auth, body: JSON.stringify({ files: t.files }) });
        await d.upload("smoke", urls.body.urls);
        await d.cleanup("smoke");
        const done = await api("/videos/" + video.id + "/complete", { method: "POST", headers: auth, body: JSON.stringify({
          duration: t.duration, width: t.width, height: t.height, size_bytes: t.sizeBytes, has_thumbnail: t.hasThumbnail,
          renditions: t.renditions.map(r => ({ height: r.height, width: r.width, pixel_height: r.pixelHeight, bandwidth: r.bandwidth, codecs: r.codecs, playlist: r.playlist })) }) });
        return { origin: location.origin, probe, files: t.files.length, status: done.status, qualities: done.body.video && done.body.video.qualities, id: video.id };
      })()`);
      console.log("SMOKE", JSON.stringify(result));
      await win.loadURL("app://dhara/app");
      await new Promise((r) => setTimeout(r, 2500));
      fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
      console.log("SMOKE screenshot", out);
    } catch (e) {
      console.error("SMOKE FAILED", e);
      process.exitCode = 1;
    }
    app.exit();
  });
};
