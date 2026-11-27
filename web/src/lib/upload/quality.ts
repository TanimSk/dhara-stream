export const QUALITIES = [2160, 1440, 1080, 720, 480, 360, 240] as const;
export const DEFAULT_QUALITIES = [1080, 720, 480];

/** Quality label of a source: its short side, snapped down to the nearest standard step. */
export function labelFor(width: number, height: number): number {
  const short = Math.min(width, height);
  return QUALITIES.find((q) => q <= short + 8) ?? 240;
}

/** Qualities that make sense for this source (never upscale). */
export function offeredFor(width: number, height: number): number[] {
  const top = labelFor(width, height);
  return QUALITIES.filter((q) => q <= top);
}

/** Bitrate targets (video kbps) per quality, tuned for lecture-style and general content. */
export const VIDEO_KBPS: Record<number, number> = { 2160: 14000, 1440: 8000, 1080: 4500, 720: 2500, 480: 1100, 360: 700, 240: 400 };
