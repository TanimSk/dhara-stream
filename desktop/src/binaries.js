// Locate ffmpeg/ffprobe: DHARA_FFMPEG/DHARA_FFPROBE env, then the bundled static builds, then PATH.
const fs = require("node:fs");

function fromPackage(name) {
  try {
    let p = require(name);
    p = typeof p === "string" ? p : p.path;
    // Packaged apps keep binaries outside the asar archive.
    p = p.replace("app.asar", "app.asar.unpacked");
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

module.exports = {
  ffmpeg: process.env.DHARA_FFMPEG || fromPackage("ffmpeg-static") || "ffmpeg",
  ffprobe: process.env.DHARA_FFPROBE || fromPackage("ffprobe-static") || "ffprobe",
};
