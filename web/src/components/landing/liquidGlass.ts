// Liquid Glass refraction for the landing page. A port of the engine in edge/src/player.js so the
// showcase player looks exactly like the real one. Chromium only (backdrop-filter: url()); other
// browsers keep the frosted CSS fallback.

export interface GlassConfig {
  bezel: number; // rim width in px where light bends
  scale: number; // displacement strength
  blur: number;
  arc?: boolean; // circular-arc rim: flat inside, steep at the edge
  disp?: number; // per-channel dispersion
  dense?: boolean;
}

export const LIQUID_GLASS =
  typeof window !== "undefined" && !!(window as any).chrome && typeof CSS !== "undefined" && CSS.supports("backdrop-filter", "url(#a) blur(1px)");

const NS = "http://www.w3.org/2000/svg";
let defs: SVGDefsElement | null = null;
let seq = 0;

function host() {
  if (!defs) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    defs = document.createElementNS(NS, "defs");
    svg.appendChild(defs);
    document.body.appendChild(svg);
  }
  return defs;
}

function lensMap(w: number, h: number, r: number, bezel: number, arc?: boolean) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      const cx = Math.min(Math.max(px, r), w - r), cy = Math.min(Math.max(py, r), h - r);
      const dx = px - cx, dy = py - cy, len = Math.hypot(dx, dy);
      let dist: number, nx = 0, ny = 0;
      if (len > 0) {
        dist = r - len;
        nx = dx / len;
        ny = dy / len;
      } else {
        const dl = px, dr = w - px, dt = py, db = h - py;
        dist = Math.min(dl, dr, dt, db);
        if (dist === dl) nx = -1;
        else if (dist === dr) nx = 1;
        else if (dist === dt) ny = -1;
        else ny = 1;
      }
      const t = Math.max(0, Math.min(1, 1 - dist / bezel));
      const m = arc ? 1 - Math.sqrt(1 - t * t) : t * t * (3 - 2 * t) * t;
      const i = (y * w + x) * 4;
      d[i] = 128 + nx * m * 127;
      d[i + 1] = 128 + ny * m * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

const MATRIX = {
  r: "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0",
  g: "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0",
  b: "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0",
};

function channel(scale: number, keep: "r" | "g" | "b") {
  return (
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="d${keep}"/>` +
    `<feColorMatrix in="d${keep}" type="matrix" values="${MATRIX[keep]}" result="${keep}"/>`
  );
}

/** Applies refraction to `el` and keeps it in sync with its size. Returns a cleanup function. */
export function attachGlass(el: HTMLElement, cfg: GlassConfig) {
  if (!LIQUID_GLASS) return () => {};
  const fid = `lgl-${++seq}`;
  let key = "";
  const build = () => {
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
    const k = `${w}x${h}x${r}`;
    if (k === key) return;
    key = k;
    document.getElementById(fid)?.remove();
    const f = document.createElementNS(NS, "filter");
    f.setAttribute("id", fid);
    for (const [a, v] of Object.entries({ x: "0", y: "0", width: String(w), height: String(h), filterUnits: "userSpaceOnUse", primitiveUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" }))
      f.setAttribute(a, v);
    const disp = cfg.disp ?? 0.03;
    f.innerHTML =
      `<feImage href="${lensMap(w, h, r, cfg.bezel, cfg.arc)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>` +
      channel(cfg.scale, "r") + channel(cfg.scale * (1 - disp), "g") + channel(cfg.scale * (1 - 2 * disp), "b") +
      `<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/>`;
    host().appendChild(f);
    el.style.backdropFilter = `url(#${fid}) blur(${cfg.blur}px) saturate(${cfg.dense ? 190 : 175}%) brightness(1.05)`;
  };
  build();
  const ro = new ResizeObserver(build);
  ro.observe(el);
  return () => {
    ro.disconnect();
    document.getElementById(fid)?.remove();
  };
}

export const GLASS = {
  bar: { bezel: 18, scale: 52, blur: 0.3, arc: true, disp: 0.05 },
  big: { bezel: 16, scale: 34, blur: 0.4, arc: true, disp: 0.05 },
  menu: { bezel: 10, scale: 14, blur: 7, dense: true },
  toast: { bezel: 8, scale: 10, blur: 4, dense: true },
} satisfies Record<string, GlassConfig>;
