// Upload queue shared by the dashboard. One job at a time does the heavy step (transcode/remux);
// uploads of finished jobs overlap with the next job's transcode.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { post } from "../api";
import { desktop, type DesktopProgress } from "../desktop";
import type { UploadInfo, Video, Visibility } from "../types";
import { pool, putWithProgress, retry } from "./net";
import { MP4_LIMIT, canRemux, probeWeb, remuxEncrypted, thumbnail } from "./web";

export type Phase = "queued" | "probing" | "transcoding" | "uploading" | "finalizing" | "done" | "error" | "canceled";

export interface JobInput {
  title: string;
  category: number | null;
  visibility: Visibility;
  heights: number[]; // desktop only
  file?: File; // web
  path?: string; // desktop
  name: string;
  size: number;
}

export interface Job extends JobInput {
  id: string;
  phase: Phase;
  progress: number;
  detail?: string;
  error?: string;
  videoId?: string;
}

interface UploadCtx {
  jobs: Job[];
  add: (inputs: JobInput[]) => void;
  cancel: (id: string) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
  busy: boolean;
}

const Ctx = createContext<UploadCtx | null>(null);
const URL_BATCH = 200;
const PARALLEL = 6;

export function UploadProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const qc = useQueryClient();
  const controllers = useRef(new Map<string, AbortController>());
  const running = useRef(false);
  const queue = useRef<Job[]>([]);

  const update = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }, []);

  // Desktop progress events from the main process.
  useEffect(() => {
    if (!desktop) return;
    return desktop.onProgress((p: DesktopProgress) => update(p.jobId, { phase: p.phase, progress: p.progress, detail: p.detail }));
  }, [update]);

  const busy = jobs.some((j) => !["done", "error", "canceled"].includes(j.phase));
  useEffect(() => {
    if (!busy || desktop) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  const runJob = useCallback(
    async (job: Job) => {
      const ac = new AbortController();
      controllers.current.set(job.id, ac);
      try {
        if (desktop && job.path) await runDesktop(job, ac.signal, update);
        else if (job.file) await runWeb(job, job.file, ac.signal, update);
        update(job.id, { phase: "done", progress: 1, detail: undefined });
        qc.invalidateQueries({ queryKey: ["videos"] });
        qc.invalidateQueries({ queryKey: ["account"] });
      } catch (e) {
        const canceled = (e as Error).name === "AbortError" || ac.signal.aborted;
        if ((e as any).videoId) post(`/videos/${(e as any).videoId}/fail`).catch(() => {});
        update(job.id, canceled ? { phase: "canceled", detail: undefined } : { phase: "error", error: (e as Error).message });
        qc.invalidateQueries({ queryKey: ["videos"] });
      } finally {
        controllers.current.delete(job.id);
        if (desktop) desktop.cleanup(job.id).catch(() => {});
      }
    },
    [qc, update],
  );

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (queue.current.length) {
      const job = queue.current.shift()!;
      await runJob(job);
    }
    running.current = false;
  }, [runJob]);

  const add = useCallback(
    (inputs: JobInput[]) => {
      const created = inputs.map((i) => ({ ...i, id: crypto.randomUUID(), phase: "queued" as Phase, progress: 0 }));
      setJobs((js) => [...created, ...js]);
      queue.current.push(...created);
      pump();
    },
    [pump],
  );

  const cancel = useCallback((id: string) => {
    queue.current = queue.current.filter((j) => j.id !== id);
    controllers.current.get(id)?.abort();
    if (desktop) desktop.cancel(id).catch(() => {});
    setJobs((js) => js.map((j) => (j.id === id && ["queued"].includes(j.phase) ? { ...j, phase: "canceled" } : j)));
  }, []);

  const dismiss = useCallback((id: string) => setJobs((js) => js.filter((j) => j.id !== id)), []);
  const clearFinished = useCallback(() => setJobs((js) => js.filter((j) => !["done", "error", "canceled"].includes(j.phase))), []);

  return <Ctx.Provider value={{ jobs, add, cancel, dismiss, clearFinished, busy }}>{children}</Ctx.Provider>;
}

export function useUploads() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUploads outside UploadProvider");
  return ctx;
}

// ---------------- pipelines ----------------

type Update = (id: string, patch: Partial<Job>) => void;

function withVideo(e: unknown, videoId: string) {
  (e as any).videoId = videoId;
  return e;
}

async function createVideo(job: Job, source: "hls" | "mp4", via: "desktop" | "web") {
  const data = await post<{ video: Video; upload: UploadInfo }>("/videos", {
    title: job.title,
    category: job.category,
    visibility: job.visibility,
    source,
    uploaded_via: via,
    original_filename: job.name.slice(0, 255),
  });
  return data;
}

async function presign(videoId: string, files: string[]): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  for (let i = 0; i < files.length; i += URL_BATCH) {
    const d = await post<{ urls: Record<string, string> }>(`/videos/${videoId}/upload-urls`, { files: files.slice(i, i + URL_BATCH) });
    Object.assign(urls, d.urls);
  }
  return urls;
}

async function runDesktop(job: Job, signal: AbortSignal, update: Update): Promise<string> {
  const d = desktop!;
  update(job.id, { phase: "probing", progress: 0 });
  const probe = await d.probe(job.path!);
  const { video, upload } = await createVideo(job, "hls", "desktop");
  update(job.id, { videoId: video.id });
  try {
    const out = await d.transcode(job.id, job.path!, {
      heights: job.heights,
      keyHex: upload.key_hex,
      keyUri: upload.key_uri,
      segmentSeconds: upload.segment_seconds,
    });
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    update(job.id, { phase: "uploading", progress: 0 });
    // Presign in batches as we go so URLs never sit around long enough to expire.
    for (let i = 0; i < out.files.length; i += URL_BATCH) {
      const urls = await presign(video.id, out.files.slice(i, i + URL_BATCH));
      await d.upload(job.id, urls);
      if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    }
    update(job.id, { phase: "finalizing", progress: 1 });
    await post(`/videos/${video.id}/complete`, {
      duration: out.duration || probe.duration,
      width: out.width,
      height: out.height,
      size_bytes: out.sizeBytes,
      has_thumbnail: out.hasThumbnail,
      renditions: out.renditions.map((r) => ({
        height: r.height, width: r.width, pixel_height: r.pixelHeight, bandwidth: r.bandwidth, codecs: r.codecs, playlist: r.playlist,
      })),
    });
    return video.id;
  } catch (e) {
    throw withVideo(e, video.id);
  }
}

async function runWeb(job: Job, file: File, signal: AbortSignal, update: Update): Promise<string> {
  update(job.id, { phase: "probing", progress: 0, detail: "Reading the file" });
  const probe = await probeWeb(file);
  const remux = canRemux(probe, file.size);
  if (!remux && file.size > MP4_LIMIT) throw new Error("Files over 5 GB need the desktop app.");
  const { video, upload } = await createVideo(job, remux ? "hls" : "mp4", "web");
  update(job.id, { videoId: video.id });
  try {
    const thumb = await thumbnail(file, probe.duration);
    const blobs = new Map<string, Blob>();
    let renditions: unknown[] = [];
    if (remux) {
      update(job.id, { phase: "transcoding", progress: 0, detail: "Packaging and encrypting" });
      const r = await remuxEncrypted(file, probe, upload.key_hex, upload.key_uri, (p) => update(job.id, { progress: p }), signal);
      for (const s of r.segments) blobs.set(`${r.label}p/${s.name}`, s.blob);
      blobs.set(`${r.label}p/index.m3u8`, new Blob([r.playlist], { type: "application/vnd.apple.mpegurl" }));
      renditions = [{
        height: r.label,
        width: probe.width,
        pixel_height: probe.height,
        bandwidth: r.bandwidth,
        codecs: "",
        playlist: r.playlist,
      }];
    } else {
      blobs.set("video.mp4", file);
    }
    if (thumb) blobs.set("thumb.jpg", thumb);

    update(job.id, { phase: "uploading", progress: 0, detail: remux ? undefined : "Uploading the original file" });
    const total = [...blobs.values()].reduce((s, b) => s + b.size, 0);
    const sent = new Map<string, number>();
    const report = () => update(job.id, { progress: [...sent.values()].reduce((a, b) => a + b, 0) / Math.max(total, 1) });
    const paths = [...blobs.keys()];
    for (let i = 0; i < paths.length; i += URL_BATCH) {
      const urls = await presign(video.id, paths.slice(i, i + URL_BATCH));
      await pool(Object.keys(urls), PARALLEL, async (path) => {
        await retry(() => putWithProgress(urls[path], blobs.get(path)!, (n) => { sent.set(path, n); report(); }, signal), 4, signal);
        sent.set(path, blobs.get(path)!.size);
        blobs.set(path, new Blob()); // release memory as we go
        report();
      });
    }

    update(job.id, { phase: "finalizing", progress: 1, detail: undefined });
    await post(`/videos/${video.id}/complete`, {
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      size_bytes: total,
      has_thumbnail: Boolean(thumb),
      renditions,
    });
    return video.id;
  } catch (e) {
    throw withVideo(e, video.id);
  }
}
