// Browser pipeline: no compression. H.264 files are remuxed (-c copy) into HLS with ffmpeg.wasm and
// each segment is AES-128 encrypted with WebCrypto, so web uploads get the same protection as desktop
// ones. Anything else is uploaded as a single MP4.

import type { FFmpeg } from "@ffmpeg/ffmpeg";

import { labelFor } from "./quality";

export const REMUX_LIMIT = 2 * 1024 ** 3; // larger files would not fit in browser memory
export const MP4_LIMIT = 5 * 1024 ** 3; // single presigned PUT limit

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function loadFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ff = new FFmpeg();
      const base = new URL("/ffmpeg/", window.location.href).href;
      await ff.load({ coreURL: `${base}ffmpeg-core.js`, wasmURL: `${base}ffmpeg-core.wasm` });
      return ff;
    })().catch((e) => {
      ffmpegPromise = null;
      throw e;
    });
  }
  return ffmpegPromise;
}

export interface WebProbe {
  duration: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
}

/** Duration and size from the browser, codecs from ffmpeg's stream dump. */
export async function probeWeb(file: File): Promise<WebProbe> {
  const meta = await videoMeta(file).catch(() => ({ duration: 0, width: 0, height: 0 }));
  const ff = await loadFFmpeg();
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => lines.push(message);
  ff.on("log", onLog);
  await mount(ff, file);
  try {
    await ff.exec(["-hide_banner", "-i", `/in/${file.name}`]);
  } finally {
    ff.off("log", onLog);
    await unmount(ff);
  }
  const log = lines.join("\n");
  const video = /Stream #\S+.*?: Video: (\w+)/.exec(log)?.[1] ?? "unknown";
  const audio = /Stream #\S+.*?: Audio: (\w+)/.exec(log)?.[1] ?? null;
  let { duration, width, height } = meta;
  if (!duration) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
    if (m) duration = +m[1] * 3600 + +m[2] * 60 + +m[3];
  }
  if (!width) {
    const m = /Video: .*?, (\d{2,5})x(\d{2,5})/.exec(log);
    if (m) [width, height] = [+m[1], +m[2]];
  }
  return { duration, width, height, videoCodec: video, audioCodec: audio };
}

export function canRemux(p: WebProbe, size: number) {
  return p.videoCodec === "h264" && (p.audioCodec === null || ["aac", "mp3"].includes(p.audioCodec)) && size <= REMUX_LIMIT;
}

async function mount(ff: FFmpeg, file: File) {
  await ff.createDir("/in").catch(() => {});
  await ff.mount("WORKERFS" as any, { files: [file] }, "/in");
}

async function unmount(ff: FFmpeg) {
  await ff.unmount("/in").catch(() => {});
}

function videoMeta(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      resolve({ duration: v.duration || 0, width: v.videoWidth, height: v.videoHeight });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    v.src = url;
  });
}

/** A JPEG poster grabbed a little way into the video. Null when the browser can't decode it. */
export function thumbnail(file: File, duration: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (b: Blob | null) => {
      URL.revokeObjectURL(url);
      resolve(b);
    };
    v.muted = true;
    v.preload = "auto";
    v.onloadeddata = () => (v.currentTime = Math.min(Math.max(duration * 0.1, 1), 8, duration || 1));
    v.onseeked = () => {
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, 1));
      const c = document.createElement("canvas");
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => done(b), "image/jpeg", 0.82);
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 15000);
    v.src = url;
  });
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(h: string) {
  return new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));
}

export interface RemuxResult {
  label: number;
  playlist: string;
  segments: { name: string; blob: Blob }[];
  bandwidth: number;
}

/** Remux to 6 s TS segments and encrypt each one (AES-128-CBC, PKCS7, one random IV per video). */
export async function remuxEncrypted(
  file: File,
  probe: WebProbe,
  keyHex: string,
  keyUri: string,
  onProgress: (p: number) => void,
  signal?: AbortSignal,
): Promise<RemuxResult> {
  const ff = await loadFFmpeg();
  const onProg = ({ progress }: { progress: number }) => onProgress(Math.max(0, Math.min(1, progress)));
  ff.on("progress", onProg);
  const abort = () => {
    ff.terminate();
    ffmpegPromise = null; // a terminated instance can't be reused
  };
  signal?.addEventListener("abort", abort, { once: true });
  await mount(ff, file);
  await ff.createDir("/out").catch(() => {});
  try {
    const code = await ff.exec([
      "-hide_banner", "-i", `/in/${file.name}`,
      "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-sn", "-dn",
      "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
      "-hls_segment_filename", "/out/seg_%05d.ts", "/out/index.m3u8",
    ]);
    if (code !== 0) throw new Error("This file couldn't be repackaged in the browser.");
    const playlist = (await ff.readFile("/out/index.m3u8", "utf8")) as string;
    const names = playlist.split("\n").map((l) => l.trim()).filter((l) => /^seg_\d{5}\.ts$/.test(l));

    const key = await crypto.subtle.importKey("raw", fromHex(keyHex), "AES-CBC", false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const segments: { name: string; blob: Blob }[] = [];
    let total = 0;
    for (const name of names) {
      const data = (await ff.readFile(`/out/${name}`)) as Uint8Array;
      await ff.deleteFile(`/out/${name}`);
      const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, data));
      total += data.byteLength;
      segments.push({ name, blob: new Blob([enc], { type: "video/mp2t" }) });
    }
    await ff.deleteFile("/out/index.m3u8").catch(() => {});

    const keyLine = `#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x${hex(iv)}`;
    const lines = playlist.split("\n").map((l) => l.trim()).filter(Boolean);
    const firstInf = lines.findIndex((l) => l.startsWith("#EXTINF"));
    lines.splice(firstInf, 0, keyLine);
    return {
      label: labelFor(probe.width, probe.height),
      playlist: lines.join("\n") + "\n",
      segments,
      bandwidth: Math.max(1000, Math.round((total * 8) / Math.max(probe.duration, 1))),
    };
  } finally {
    ff.off("progress", onProg);
    signal?.removeEventListener("abort", abort);
    await unmount(ff);
  }
}
