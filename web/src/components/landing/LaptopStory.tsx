import { useRef } from "react";

import { LogoMark } from "../ui";
import PlayerMock from "./PlayerMock";
import { useScrollProgress } from "./motion";

const MEDIA = "/media";

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const range = (p: number, a: number, b: number) => clamp((p - a) / (b - a));

// Scroll stages (0..1 across the pinned section).
const LID = [0, 0.2] as const;
const UPLOAD = [0.24, 0.42] as const;
const ENCODE = [0.43, 0.54] as const;
const PLAYER = [0.6, 0.67] as const;

const CAPTIONS = [
  { from: 0, to: 0.22, title: "One calm home for every video.", sub: "Upload, organize and stream from a single dashboard." },
  { from: 0.22, to: 0.43, title: "Drop in a video.", sub: "Uploads run in parallel and resume if the connection drops." },
  { from: 0.43, to: 0.6, title: "Compressed on your computer.", sub: "Pick 1080p, 720p, 480p. The desktop app does the work." },
  { from: 0.6, to: 1.01, title: "Streaming. Instantly.", sub: "Straight from Cloudflare, encrypted, on your site only." },
];

const RUNGS = ["720p", "480p", "360p", "240p"];

/**
 * Pinned scroll story: the laptop opens, a video uploads and encodes on its screen, then plays.
 * Everything is written straight to the DOM from scroll progress, so React never re-renders mid-scroll.
 */
export default function LaptopStory() {
  const els = useRef<Record<string, HTMLElement | null>>({});
  const reg = (k: string) => (el: HTMLElement | null) => {
    els.current[k] = el;
  };

  const ref = useScrollProgress<HTMLElement>(
    (p) => {
      const e = els.current;
      // Lid: closed (folded flat toward the viewer) -> upright.
      const o = ease(range(p, ...LID));
      if (e.lid) e.lid.style.transform = o >= 1 ? "none" : `rotateX(${(-90 * (1 - o)).toFixed(2)}deg)`;
      if (e.laptop) e.laptop.style.transform = `translateY(${(-(1 - o) * 12).toFixed(2)}vh) scale(${(0.86 + o * 0.14).toFixed(4)})`;
      if (e.power) e.power.style.opacity = String(1 - range(p, 0.12, 0.22));

      // Upload tray.
      const u = range(p, ...UPLOAD);
      const enc = range(p, ...ENCODE);
      const ready = p >= ENCODE[1];
      if (e.tray) {
        e.tray.style.opacity = String(range(p, 0.2, 0.25) * (1 - range(p, PLAYER[0] - 0.02, PLAYER[0] + 0.02)));
        e.tray.style.transform = `translateY(${(1 - range(p, 0.2, 0.26)) * 14}px)`;
      }
      if (e.upBar) e.upBar.style.width = `${(u * 100).toFixed(1)}%`;
      if (e.upText) e.upText.textContent = u < 1 ? `${(u * 1.8).toFixed(1)} GB of 1.8 GB · 24 MB/s` : "Uploaded · 1.8 GB";
      if (e.trayTitle) e.trayTitle.textContent = u < 1 ? "Uploading 1 file" : ready ? "Ready to stream" : "Encoding";
      if (e.encode) e.encode.style.opacity = String(0.35 + 0.65 * range(p, ENCODE[0] - 0.02, ENCODE[0]));
      RUNGS.forEach((_, i) => {
        const r = clamp(enc * 1.6 - i * 0.2);
        const bar = e[`rung${i}`];
        if (bar) bar.style.width = `${(r * 100).toFixed(1)}%`;
        const check = e[`check${i}`];
        if (check) check.style.opacity = r >= 1 ? "1" : "0";
      });
      if (e.ready) e.ready.style.opacity = ready ? "1" : "0";

      // Player takes over the screen.
      const pl = range(p, ...PLAYER);
      if (e.player) {
        e.player.style.opacity = String(pl);
        e.player.style.transform = `scale(${(0.96 + pl * 0.04).toFixed(4)})`;
      }

      // Captions crossfade.
      CAPTIONS.forEach((c, i) => {
        const el = e[`cap${i}`];
        if (!el) return;
        const fadeIn = i === 0 ? 1 : range(p, c.from, c.from + 0.03);
        const fadeOut = 1 - range(p, c.to - 0.03, c.to);
        const a = Math.min(fadeIn, fadeOut);
        el.style.opacity = String(a);
        el.style.transform = `translateY(${((1 - a) * 12).toFixed(1)}px)`;
      });
    },
    { mode: "sticky" },
  );

  return (
    <section id="product" ref={ref} className="relative h-[480vh] bg-black scroll-mt-14">
      <div className="sticky top-0 h-[100svh] overflow-hidden flex flex-col items-center justify-center px-4">
        <div className="absolute left-1/2 top-[55%] -translate-x-1/2 -translate-y-1/2 h-[70vh] w-[1100px] max-w-[150vw] rounded-full bg-[radial-gradient(closest-side,rgba(255,170,110,0.13),transparent)] blur-2xl pointer-events-none" />

        {/* Captions */}
        <div className="relative h-[124px] sm:h-[150px] w-full max-w-3xl text-center">
          {CAPTIONS.map((c, i) => (
            <div key={c.title} ref={reg(`cap${i}`)} className="absolute inset-x-0 top-0" style={{ opacity: i === 0 ? 1 : 0 }}>
              <h2 className="text-[34px] sm:text-[60px] leading-[1.02] font-semibold tracking-[-0.045em] text-white">{c.title}</h2>
              <p className="mt-3 sm:mt-4 text-[15px] sm:text-[18px] text-white/55">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Laptop */}
        <div ref={reg("laptop")} className="relative mt-6 sm:mt-10 w-[min(1000px,92vw,calc((100svh_-_260px)*1.5))] will-change-transform" style={{ transform: "translateY(-12vh) scale(0.86)" }}>
          <div className="[perspective:2400px] [perspective-origin:50%_-30%]">
            <div ref={reg("lid")} className="relative origin-bottom [transform-style:preserve-3d] will-change-transform" style={{ transform: "rotateX(-90deg)" }}>
              {/* Screen side */}
              <div className="relative rounded-[14px] sm:rounded-[22px] bg-[#0c0c0e] p-[1.3%] pb-[1.6%] ring-1 ring-white/[0.12] [backface-visibility:hidden] shadow-[0_80px_160px_-60px_rgba(255,160,90,0.35)]">
                <span className="absolute top-[0.55%] left-1/2 -translate-x-1/2 size-[5px] rounded-full bg-white/15" />
                <div className="relative aspect-[1424/788] overflow-hidden rounded-[5px] sm:rounded-[8px] bg-[#f7f7f4] [container-type:inline-size]">
                  <img src={`${MEDIA}/dashboard.webp`} alt="" width={2848} height={1576} className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />

                  {/* Upload tray, styled like the dashboard's real one */}
                  <div ref={reg("tray")} className="absolute right-[2.2cqw] bottom-[2.2cqw] w-[31cqw] rounded-[1.6cqw] bg-white border border-[#e7e6e1] shadow-[0_1.2cqw_3cqw_-1cqw_rgba(20,20,18,0.25)] p-[1.5cqw] text-[#1d1d1f]" style={{ opacity: 0 }}>
                    <div className="flex items-center justify-between">
                      <span ref={reg("trayTitle")} className="text-[1.25cqw] font-semibold">Uploading 1 file</span>
                      <span ref={reg("ready")} className="flex items-center gap-[0.5cqw] text-[1cqw] font-semibold text-[#2f8f5b] transition-opacity duration-300" style={{ opacity: 0 }}>
                        <span className="size-[0.7cqw] rounded-full bg-[#2f8f5b]" /> Ready
                      </span>
                    </div>
                    <div className="mt-[1.1cqw] flex items-baseline justify-between gap-[1cqw]">
                      <span className="text-[1.1cqw] font-medium truncate">launch-film.mp4</span>
                      <span ref={reg("upText")} className="text-[0.95cqw] text-[#8a8a8f] tabular-nums whitespace-nowrap">0.0 GB of 1.8 GB</span>
                    </div>
                    <div className="mt-[0.7cqw] h-[0.45cqw] rounded-full bg-[#f1f1ed] overflow-hidden">
                      <div ref={reg("upBar")} className="h-full rounded-full bg-[#1d1d1f]" style={{ width: 0 }} />
                    </div>
                    <div ref={reg("encode")} className="mt-[1.3cqw] space-y-[0.7cqw]" style={{ opacity: 0.35 }}>
                      {RUNGS.map((q, i) => (
                        <div key={q} className="flex items-center gap-[0.9cqw]">
                          <span className="w-[3.2cqw] text-[0.95cqw] font-semibold tabular-nums">{q}</span>
                          <div className="flex-1 h-[0.4cqw] rounded-full bg-[#f1f1ed] overflow-hidden">
                            <div ref={reg(`rung${i}`)} className="h-full rounded-full bg-[#1d1d1f]" style={{ width: 0 }} />
                          </div>
                          <svg ref={reg(`check${i}`) as any} viewBox="0 0 24 24" className="size-[1.2cqw] text-[#2f8f5b] transition-opacity duration-300" style={{ opacity: 0 }} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* The video playing in the real player */}
                  <div ref={reg("player")} className="absolute inset-0" style={{ opacity: 0 }}>
                    <PlayerMock src={`${MEDIA}/fiber-hero.mp4`} poster={`${MEDIA}/fiber-hero.jpg`} title="Launch film" start={4} total={2 * 60 + 18} scripted={false} className="absolute inset-0" />
                  </div>

                  {/* Screen off while the lid is closed */}
                  <div ref={reg("power")} className="absolute inset-0 bg-black pointer-events-none" />
                </div>
              </div>
              {/* Back of the lid */}
              <div className="absolute inset-0 rounded-[14px] sm:rounded-[22px] [backface-visibility:hidden] [transform:rotateY(180deg)] bg-[linear-gradient(160deg,#5a5a60,#2c2c30_45%,#1a1a1d)] ring-1 ring-white/10 flex items-center justify-center">
                <LogoMark className="size-[7%] opacity-50" />
              </div>
            </div>
          </div>
          {/* Base */}
          <div className="relative mx-auto -mt-px h-[10px] sm:h-[16px] w-[112%] -ml-[6%] rounded-b-[22px] bg-gradient-to-b from-[#4a4a4f] via-[#2a2a2e] to-[#141416] shadow-[0_20px_40px_-10px_rgba(0,0,0,0.8)]">
            <span className="absolute left-1/2 top-0 -translate-x-1/2 h-[4px] sm:h-[6px] w-[14%] rounded-b-[8px] bg-[#1a1a1d]" />
          </div>
        </div>
      </div>
    </section>
  );
}
