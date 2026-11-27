// On-device compression: one decode, every selected quality encoded in a single ffmpeg pass,
// written as AES-128 encrypted HLS (MPEG-TS, 6 s segments) ready for presigned upload.

const { spawn, execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { ffmpeg, ffprobe } = require("./binaries");

const QUALITIES = [2160, 1440, 1080, 720, 480, 360, 240];
const VIDEO_KBPS = { 2160: 14000, 1440: 8000, 1080: 4500, 720: 2500, 480: 1100, 360: 700, 240: 400 };
const AUDIO_KBPS = 128;

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)));
  });
}

async function probe(file) {
  const out = JSON.parse(await run(ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]));
  const v = out.streams.find((s) => s.codec_type === "video");
  const a = out.streams.find((s) => s.codec_type === "audio");
  if (!v) throw new Error("This file has no video track.");
  let { width, height } = v;
  const rot = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
  if (rot === 90 || rot === 270) [width, height] = [height, width];
  return {
    duration: Number(out.format.duration || v.duration || 0),
    width,
    height,
    videoCodec: v.codec_name,
    audioCodec: a ? a.codec_name : null,
  };
}

const labelFor = (w, h) => QUALITIES.find((q) => q <= Math.min(w, h) + 8) ?? 240;
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** Output pixel size for a quality label, keeping aspect ratio (label = short side). */
function sizeFor(label, w, h) {
  const portrait = h > w;
  return portrait ? { width: label, height: even((label * h) / w) } : { width: even((label * w) / h), height: label };
}

let encoderCache = null;
async function detectEncoder() {
  if (encoderCache) return encoderCache;
  const candidates = process.platform === "darwin" ? ["h264_videotoolbox"] : process.platform === "win32" ? ["h264_nvenc", "h264_qsv", "h264_amf"] : ["h264_nvenc", "h264_vaapi"];
  for (const enc of candidates) {
    try {
      // A real one-second test encode: listing encoders isn't enough (driver/GPU may be missing).
      await run(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-t", "1", "-c:v", enc, "-f", "null", "-"]);
      return (encoderCache = enc);
    } catch {
      /* try the next one */
    }
  }
  return (encoderCache = "libx264");
}

function encoderArgs(enc, kbps) {
  const rate = [`-b:v`, `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.5)}k`, "-bufsize", `${kbps * 2}k`];
  switch (enc) {
    case "libx264":
      return ["-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high", ...rate];
    case "h264_videotoolbox":
      return ["-c:v", "h264_videotoolbox", "-profile:v", "high", "-allow_sw", "1", ...rate];
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", "p5", "-profile:v", "high", ...rate];
    default:
      return ["-c:v", enc, ...rate];
  }
}

/**
 * @returns {Promise<{files, renditions, duration, width, height, sizeBytes, hasThumbnail}>}
 */
async function transcode({ input, workDir, heights, keyHex, keyUri, segmentSeconds = 6, onProgress, signal }) {
  const src = await probe(input);
  const top = labelFor(src.width, src.height);
  let labels = [...new Set(heights)].filter((h) => QUALITIES.includes(h) && h <= top).sort((a, b) => b - a);
  if (!labels.length) labels = [top];

  const outDir = path.join(workDir, "out");
  const secretDir = path.join(workDir, "secret"); // never uploaded
  fs.mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  const keyFile = path.join(secretDir, "enc.key");
  fs.writeFileSync(keyFile, Buffer.from(keyHex, "hex"), { mode: 0o600 });
  const iv = require("node:crypto").randomBytes(16).toString("hex");
  const keyInfo = path.join(secretDir, "keyinfo");
  fs.writeFileSync(keyInfo, `${keyUri}\n${keyFile}\n${iv}\n`, { mode: 0o600 });

  const enc = await detectEncoder();
  const sizes = labels.map((l) => sizeFor(l, src.width, src.height));
  const split = `[0:v]format=yuv420p,split=${labels.length}${labels.map((_, i) => `[s${i}]`).join("")};` +
    labels.map((_, i) => `[s${i}]scale=${sizes[i].width}:${sizes[i].height}:flags=bicubic[o${i}]`).join(";");

  const args = ["-hide_banner", "-v", "error", "-nostats", "-progress", "pipe:1", "-y", "-i", input, "-filter_complex", split];
  labels.forEach((label, i) => {
    const dir = path.join(outDir, `${label}p`);
    fs.mkdirSync(dir, { recursive: true });
    args.push(
      "-map", `[o${i}]`, "-map", "0:a:0?",
      ...encoderArgs(enc, VIDEO_KBPS[label]),
      // Keyframe every segment boundary so every quality switches cleanly.
      "-force_key_frames", `expr:gte(t,n_forced*${segmentSeconds})`,
      "-c:a", "aac", "-b:a", `${AUDIO_KBPS}k`, "-ac", "2",
      "-sn", "-dn",
      "-f", "hls", "-hls_time", String(segmentSeconds), "-hls_playlist_type", "vod",
      "-hls_key_info_file", keyInfo,
      "-hls_segment_filename", path.join(dir, "seg_%05d.ts"),
      path.join(dir, "index.m3u8"),
    );
  });

  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = "";
    const kill = () => proc.kill("SIGKILL");
    signal?.addEventListener("abort", kill, { once: true });
    proc.stdout.on("data", (buf) => {
      const m = /out_time_us=(\d+)/g;
      let last;
      for (let x; (x = m.exec(buf.toString())); ) last = x;
      if (last && src.duration) onProgress?.(Math.min(0.99, Number(last[1]) / 1e6 / src.duration));
    });
    proc.stderr.on("data", (b) => (stderr = (stderr + b.toString()).slice(-4000)));
    proc.on("error", reject);
    proc.on("close", (code) => {
      signal?.removeEventListener("abort", kill);
      if (signal?.aborted) return reject(Object.assign(new Error("Canceled"), { name: "AbortError" }));
      code === 0 ? resolve() : reject(new Error(`Compression failed: ${stderr.trim().split("\n").pop() || `ffmpeg exited ${code}`}`));
    });
  });

  // Poster frame (unencrypted, it's public anyway).
  let hasThumbnail = false;
  try {
    const at = Math.min(Math.max(src.duration * 0.1, 1), 8);
    await run(ffmpeg, ["-v", "error", "-y", "-ss", String(at), "-i", input, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "4", path.join(outDir, "thumb.jpg")]);
    hasThumbnail = fs.existsSync(path.join(outDir, "thumb.jpg"));
  } catch {
    /* a missing poster is fine */
  }
  fs.rmSync(secretDir, { recursive: true, force: true });

  const files = [];
  let sizeBytes = 0;
  const renditions = labels.map((label, i) => {
    const dir = path.join(outDir, `${label}p`);
    let bytes = 0;
    for (const f of fs.readdirSync(dir)) {
      const size = fs.statSync(path.join(dir, f)).size;
      bytes += size;
      files.push(`${label}p/${f}`);
    }
    sizeBytes += bytes;
    return {
      height: label,
      width: sizes[i].width,
      pixelHeight: sizes[i].height,
      bandwidth: Math.max(1000, Math.round((bytes * 8) / Math.max(src.duration, 1))),
      codecs: "",
      playlist: fs.readFileSync(path.join(dir, "index.m3u8"), "utf8"),
    };
  });
  if (hasThumbnail) files.push("thumb.jpg");
  onProgress?.(1);
  return { files, renditions, duration: src.duration, width: src.width, height: src.height, sizeBytes, hasThumbnail, encoder: enc };
}

module.exports = { probe, transcode, detectEncoder, labelFor, sizeFor };
