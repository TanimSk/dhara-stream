import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cx } from "../ui";
import { GLASS, attachGlass } from "./liquidGlass";

// The real player's glyphs (backend/playback/pages/player.html).
const PAUSE = <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="3.8" height="14" rx="1.2" /><rect x="13.7" y="5" width="3.8" height="14" rx="1.2" /></svg>;
const VOL = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" fill="currentColor" /><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
const SETTINGS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></svg>;
const PIP = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><rect x="12" y="11.5" width="6.5" height="5" rx="1.2" fill="currentColor" stroke="none" /></svg>;
const FS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" /></svg>;
const CURSOR = <svg viewBox="0 0 24 24"><path d="M5 3l14 8.2-6.2 1.4 3.6 6.6-2.4 1.3-3.6-6.6L5 18.5z" fill="#fff" stroke="#000" strokeWidth="1.2" strokeLinejoin="round" /></svg>;
const CHEV = <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72c0 .78.84 1.26 1.5.86l10.8-6.86a1 1 0 0 0 0-1.72L9.5 4.28C8.84 3.88 8 4.36 8 5.14z" /></svg>;

const QUALITIES = ["Auto", "720p", "480p", "360p", "240p"];
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
const LOOP = 18;

type Target = "settings" | "speed" | `row:${number}` | null;
interface Demo {
  menu: "quality" | "speed" | null;
  hover: number;
  quality: string;
  speed: number;
  toast: string | null;
  ripple: "l" | "r" | null;
  rippleN: number;
  hidden: boolean;
  target: Target;
  pressed: "settings" | "speed" | null;
  tap: { x: number; id: number } | null;
}

const INITIAL: Demo = { menu: null, hover: -1, quality: "Auto", speed: 1, toast: null, ripple: null, rippleN: 0, hidden: false, target: null, pressed: null, tap: null };

// What happens when, in seconds from the start of each loop. `seek` moves the displayed clock.
type Step = { at: number; set?: Partial<Demo>; seek?: number; tapAt?: number };
const SCRIPT: Step[] = [
  { at: 1.4, set: { target: "settings" } },
  { at: 2.2, set: { pressed: "settings", menu: "quality", hover: 0 } },
  { at: 2.5, set: { pressed: null } },
  { at: 2.9, set: { target: "row:1", hover: 1 } },
  { at: 3.8, set: { menu: null, quality: "720p", toast: "720p", hover: -1 } },
  { at: 4.6, set: { toast: null, target: null } },
  { at: 5.4, tapAt: 0.84 },
  { at: 5.65, tapAt: 0.84, seek: 10, set: { ripple: "r", rippleN: 10 } },
  { at: 6.05, tapAt: 0.84, seek: 10, set: { rippleN: 20 } },
  { at: 6.9, set: { ripple: null } },
  { at: 7.8, tapAt: 0.16 },
  { at: 8.05, tapAt: 0.16, seek: -10, set: { ripple: "l", rippleN: 10 } },
  { at: 8.9, set: { ripple: null } },
  { at: 9.6, set: { target: "speed" } },
  { at: 10.4, set: { pressed: "speed", menu: "speed", hover: 1 } },
  { at: 10.7, set: { pressed: null } },
  { at: 11.1, set: { target: "row:3", hover: 3 } },
  { at: 11.9, set: { menu: null, speed: 1.5, toast: "1.5× speed", hover: -1 } },
  { at: 12.8, set: { toast: null, target: null } },
  { at: 13.4, set: { hidden: true } },
  { at: 16.2, set: { hidden: false } },
  { at: 17.4, set: { speed: 1, quality: "Auto" } },
];

function fmt(t: number) {
  t = Math.max(0, Math.floor(t));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + ":" + String(s).padStart(2, "0");
}

/**
 * A faithful, self-playing copy of the dhara player for the landing page.
 * `scripted` runs the demo of menus, double-tap seeking and speed; otherwise it just plays.
 */
export default function PlayerMock({ src, poster, title, start = 12 * 60 + 41, total = 48 * 60 + 20, scripted = true, className }: {
  src: string; poster: string; title: string; start?: number; total?: number; scripted?: boolean; className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toastRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLSpanElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const [demo, setDemo] = useState<Demo>(INITIAL);
  const [clock, setClock] = useState(start);
  const [visible, setVisible] = useState(false);

  // Play only while on screen.
  useEffect(() => {
    const el = root.current!;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (visible) v.play().catch(() => {});
    else v.pause();
  }, [visible]);

  // The demo timeline.
  useEffect(() => {
    if (!visible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0, last = performance.now(), t = 0, time = clock, fired = new Set<number>(), speed = 1, lastPaint = 0;
    let state = { ...INITIAL };
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;
      if (t >= LOOP) {
        t -= LOOP;
        fired = new Set();
      }
      time += dt * speed;
      if (scripted) {
        SCRIPT.forEach((s, i) => {
          if (fired.has(i) || t < s.at) return;
          fired.add(i);
          if (s.seek) time = Math.max(0, time + s.seek);
          if (s.set) state = { ...state, ...s.set };
          if (s.tapAt !== undefined) state = { ...state, tap: { x: s.tapAt, id: now } };
          speed = state.speed;
          setDemo(state);
        });
      } else {
        const hidden = t % 10 > 4;
        if (hidden !== state.hidden) {
          state = { ...state, hidden };
          setDemo(state);
        }
      }
      if (now - lastPaint > 250) {
        lastPaint = now;
        setClock(time % total);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, scripted, total]);

  // Liquid Glass on the capsule, menu and toast.
  useEffect(() => (bar.current ? attachGlass(bar.current, GLASS.bar) : undefined), []);
  useEffect(() => (menuRef.current ? attachGlass(menuRef.current, GLASS.menu) : undefined), [demo.menu]);
  useEffect(() => (toastRef.current ? attachGlass(toastRef.current, GLASS.toast) : undefined), [demo.toast]);

  // Adaptive tint, sampled from the frame behind the capsule.
  useEffect(() => {
    if (!visible) return;
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 18;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    const id = setInterval(() => {
      const v = video.current;
      if (!v || v.readyState < 2) return;
      try {
        g.drawImage(v, 0, 0, 32, 18);
        const d = g.getImageData(0, 14, 32, 4).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const lum = Math.max(0, Math.min(1, (sum / (d.length / 4) / 255 - 0.08) / 0.55)).toFixed(3);
        root.current?.style.setProperty("--lum", lum);
      } catch {
        clearInterval(id);
      }
    }, 500);
    return () => clearInterval(id);
  }, [visible]);

  // Move the pointer to whatever the script is reaching for.
  useLayoutEffect(() => {
    const el = cursor.current, box = root.current;
    if (!el || !box) return;
    let target: Element | null = null;
    if (demo.target === "settings") target = settingsRef.current;
    else if (demo.target === "speed") target = speedRef.current;
    else if (demo.target?.startsWith("row:")) target = menuRef.current?.querySelectorAll(".item")[Number(demo.target.slice(4))] ?? null;
    if (!target) {
      el.style.opacity = "0";
      return;
    }
    const b = box.getBoundingClientRect(), r = target.getBoundingClientRect();
    el.style.opacity = "1";
    el.style.left = `${r.left - b.left + r.width * 0.55}px`;
    el.style.top = `${r.top - b.top + r.height * 0.5}px`;
  }, [demo.target, demo.menu]);

  const pct = (clock / total) * 100;
  const items = demo.menu === "quality" ? QUALITIES : demo.menu === "speed" ? SPEEDS.map((s) => (s === 1 ? "Normal" : `${s}×`)) : [];
  const selected = demo.menu === "quality" ? QUALITIES.indexOf(demo.quality) : SPEEDS.indexOf(demo.speed);

  return (
    <div ref={root} className={cx("dp", demo.hidden && "hide-ui", className)}>
      <video ref={video} src={src} poster={poster} muted loop playsInline preload="none" aria-hidden />
      <div className="shade" />
      <div className="top">{title}</div>

      <div className="ripple l" style={{ opacity: demo.ripple === "l" ? 1 : 0 }}>
        <span className="chev">{CHEV}{CHEV}{CHEV}</span>
        <span>{demo.ripple === "l" ? demo.rippleN : 10} seconds</span>
      </div>
      <div className="ripple r" style={{ opacity: demo.ripple === "r" ? 1 : 0 }}>
        <span className="chev">{CHEV}{CHEV}{CHEV}</span>
        <span>{demo.ripple === "r" ? demo.rippleN : 10} seconds</span>
      </div>
      {demo.tap && <span key={demo.tap.id} className="tap" style={{ left: `${demo.tap.x * 100}%`, top: "45%" }} />}

      {demo.toast && (
        <div className="toastwrap">
          <div ref={toastRef} className="toast glass dense">{demo.toast}</div>
        </div>
      )}

      <div ref={bar} className="bar glass">
        <span className="btn">{PAUSE}</span>
        <span className="time">{fmt(clock)}</span>
        <span className="scrub">
          <span className="track">
            <span className="buf" style={{ width: `${Math.min(100, pct + 7)}%` }} />
            <span className="prog" style={{ width: `${pct}%` }} />
          </span>
        </span>
        <span className="time dim dur">{fmt(total)}</span>
        <span className="btn volb">{VOL}</span>
        <span ref={speedRef} className={cx("pill", demo.pressed === "speed" && "on")}>{demo.speed}×</span>
        <span ref={settingsRef} className={cx("btn", demo.pressed === "settings" && "on")}>{SETTINGS}</span>
        <span className="btn pipb">{PIP}</span>
        <span className="btn">{FS}</span>
      </div>

      {demo.menu && (
        <div ref={menuRef} className="menu glass dense">
          <h4>{demo.menu === "quality" ? "Quality" : "Speed"}</h4>
          {items.map((label, i) => (
            <div key={label} className={cx("item", demo.hover === i && "hover")}>
              <span>{label}</span>
              <span className="end">
                {demo.menu === "quality" && i === 0 && demo.quality === "Auto" ? "720p" : ""}
                {i === selected && <span className="dot" />}
              </span>
            </div>
          ))}
        </div>
      )}

      {scripted && <div ref={cursor} className="cursor" style={{ opacity: 0, left: "70%", top: "60%" }}>{CURSOR}</div>}
    </div>
  );
}
