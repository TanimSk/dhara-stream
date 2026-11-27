// The bridge the Electron preload exposes as window.dharaDesktop. Absent in the browser.

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
}

export interface RenditionOut {
  height: number; // quality label (short side)
  width: number;
  pixelHeight: number;
  bandwidth: number;
  codecs: string;
  playlist: string;
}

export interface TranscodeResult {
  files: string[]; // relative paths, e.g. "720p/seg_00000.ts"
  renditions: RenditionOut[];
  duration: number;
  width: number;
  height: number;
  sizeBytes: number;
  hasThumbnail: boolean;
}

export interface DesktopProgress {
  jobId: string;
  phase: "transcoding" | "uploading";
  progress: number; // 0..1
  detail?: string;
}

export interface PickedFile {
  path: string;
  name: string;
  size: number;
}

export interface DharaDesktop {
  apiBase: string;
  version: string;
  platform: string;
  getRefresh(): Promise<string | null>;
  setRefresh(token: string | null): Promise<void>;
  pickFiles(): Promise<PickedFile[]>;
  pathForFile(file: File): string;
  probe(path: string): Promise<ProbeResult>;
  encoders(): Promise<{ hardware: string | null }>;
  transcode(jobId: string, path: string, opts: { heights: number[]; keyHex: string; keyUri: string; segmentSeconds: number }): Promise<TranscodeResult>;
  upload(jobId: string, urls: Record<string, string>): Promise<void>;
  cancel(jobId: string): Promise<void>;
  cleanup(jobId: string): Promise<void>;
  onProgress(cb: (p: DesktopProgress) => void): () => void;
}

declare global {
  interface Window {
    dharaDesktop?: DharaDesktop;
  }
}

export const desktop: DharaDesktop | undefined = typeof window !== "undefined" ? window.dharaDesktop : undefined;
export const isDesktop = Boolean(desktop);
