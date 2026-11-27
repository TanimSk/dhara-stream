import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, FolderClosed, Globe2, HardDrive, KeyRound, Lock, MonitorDown, Plus, ShieldCheck, UserX } from "lucide-react";

import { useAuth } from "../lib/auth";
import { Button, Logo, cx } from "../components/ui";
import StreamCanvas from "../components/landing/StreamCanvas";
import LaptopStory from "../components/landing/LaptopStory";
import PlayerMock from "../components/landing/PlayerMock";
import { CodeView, type Lang } from "../components/landing/Code";
import { Reveal, useDarkTheme, useInView, useReducedMotion, useScrollProgress } from "../components/landing/motion";

const MEDIA = "/media";

const FAQ = [
  { q: "How do private videos work?", a: "Mark a video, or a whole category, private. Your website signs each viewer's link with your secret key (a few lines of code we give you) and links expire when you choose. Viewers never need a dhara account." },
  { q: "Can viewers download or share the videos?", a: "Every video is cut into small encrypted pieces, the decryption key is only handed to the dhara player, links expire, and the player only loads on domains you allow. That stops copied links, hotlinking and casual downloading. No platform can fully prevent screen recording." },
  { q: "Why a desktop app?", a: "Compressing video is heavy work. The dhara app does it on your own computer, using its graphics chip when it can, into exactly the qualities you pick. Then it uploads several pieces at once, straight to your storage." },
  { q: "Can I upload from the browser?", a: "Yes. The web dashboard uploads without compressing: H.264 videos are packaged and encrypted right in your browser and keep their original quality. Use the desktop app when you want several qualities." },
  { q: "Where are my videos stored?", a: "In your own private storage bucket on Cloudflare R2, separate from every other customer. Viewers stream straight from Cloudflare's network, never through a middleman server." },
];

/** A silent, looping background film. Shows the poster only for reduced motion. */
function Film({ name, className }: { name: string; className?: string }) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLVideoElement>(null);
  const [wrap, inView] = useInView<HTMLDivElement>("200px");
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (reduced) v.pause();
    else if (inView) v.play().catch(() => {});
  }, [reduced, inView]);
  return (
    <div ref={wrap} className={cx("absolute inset-0 overflow-hidden", className)}>
      <video
        ref={ref}
        className="absolute inset-0 h-full w-full object-cover"
        src={inView ? `${MEDIA}/${name}.mp4` : undefined}
        poster={`${MEDIA}/${name}.jpg`}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden
      />
    </div>
  );
}

// ---------- Nav ----------

function Nav() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cx("fixed inset-x-0 top-0 z-40 transition-all duration-500", scrolled ? "bg-black/70 backdrop-blur-2xl border-b border-white/[0.07]" : "border-b border-transparent")}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link to="/" aria-label="dhara home"><Logo /></Link>
        <nav className="hidden md:flex items-center gap-8 text-[13px] text-white/70">
          <a href="#product" className="hover:text-white transition-colors">Product</a>
          <a href="#speed" className="hover:text-white transition-colors">Speed</a>
          <a href="#privacy" className="hover:text-white transition-colors">Privacy</a>
          <a href="#developers" className="hover:text-white transition-colors">Developers</a>
          <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
        </nav>
        <div className="flex items-center gap-1.5">
          {user ? (
            <Link to={user.role === "master" ? "/admin" : "/app"}><Button size="sm">Open dashboard</Button></Link>
          ) : (
            <Link to="/login"><Button size="sm">Sign in</Button></Link>
          )}
        </div>
      </div>
    </header>
  );
}

// ---------- Hero ----------

function Hero() {
  const film = useRef<HTMLDivElement>(null);
  const ref = useScrollProgress<HTMLElement>(
    (p, el) => {
      if (film.current) film.current.style.transform = `scale(${1 + p * 0.14})`;
      const content = el.querySelector<HTMLElement>("[data-hero-content]");
      if (content) {
        content.style.opacity = String(1 - p * 1.4);
        content.style.transform = `translateY(${-p * 80}px)`;
      }
    },
    { start: 0, end: -1 },
  );

  return (
    <section ref={ref} className="relative h-[100svh] min-h-[640px] overflow-hidden bg-black">
      <div ref={film} className="absolute inset-0 will-change-transform">
        <Film name="fiber-hero" />
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_50%,rgba(0,0,0,0.55),rgba(0,0,0,0.75))]" />
      <div className="absolute inset-x-0 bottom-0 h-[35%] bg-gradient-to-b from-transparent to-black" />
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />

      <div data-hero-content className="relative h-full flex flex-col items-center justify-center px-4 text-center">
        <h1 className="blur-in text-[56px] leading-[0.95] sm:text-[108px] font-semibold tracking-[-0.055em] text-white" style={{ animationDelay: "200ms" }}>
          Your videos,
          <br />
          <span className="text-glow">flowing.</span>
        </h1>
        <p className="blur-in mt-7 max-w-xl text-[17px] sm:text-[21px] leading-snug text-white/75 tracking-[-0.01em]" style={{ animationDelay: "420ms" }}>
          Compress on your computer. Stream encrypted, from your own storage, on your website only.
        </p>
        <div className="blur-in mt-10 flex flex-col sm:flex-row items-center gap-3" style={{ animationDelay: "620ms" }}>
          <Link to="/login">
            <Button size="lg" className="!bg-white !text-black hover:!opacity-90 !px-7">Sign in</Button>
          </Link>
          <a href="#product" className="group inline-flex items-center gap-1.5 h-12 px-5 text-[15px] font-medium text-white/80 hover:text-white">
            See it in action <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------- Upload once ----------

const LADDER = [
  { q: "1080p", w: 100, note: "Big screens" },
  { q: "720p", w: 72, note: "Laptops and tablets" },
  { q: "480p", w: 48, note: "Most phones" },
  { q: "360p", w: 30, note: "The weakest signal" },
];

function UploadOnce() {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <section className="bg-black px-4 sm:px-6 py-24 sm:py-36">
      <div className="mx-auto max-w-6xl grid gap-14 lg:gap-20 lg:grid-cols-2 items-center">
        <Reveal className="order-2 lg:order-1 min-w-0">
          <p className="text-[15px] font-semibold text-[#ffb36b]">The desktop app</p>
          <h2 className="mt-3 text-[40px] sm:text-[56px] leading-[1.02] font-semibold tracking-[-0.045em] text-white">Your computer does the heavy lifting.</h2>
          <p className="mt-5 text-[17px] text-white/60 leading-relaxed max-w-lg">
            Pick the qualities you want and the dhara app compresses them in one pass, encrypts every piece, and uploads them in parallel. Viewers get the sharpest picture their connection can carry.
          </p>
          <div ref={ref} className="mt-10 space-y-5 max-w-lg">
            {LADDER.map(({ q, w, note }, i) => (
              <div key={q}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[17px] font-semibold text-white tabular">{q}</span>
                  <span className="text-[13px] text-white/45">{note}</span>
                </div>
                <div className="mt-2 h-[3px] rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#ffd9a8] to-[#f0a586] transition-[width] duration-[1400ms] ease-[cubic-bezier(.2,.7,.2,1)]"
                    style={{ width: inView ? `${w}%` : "0%", transitionDelay: `${i * 140}ms` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={120} className="order-1 lg:order-2">
          <div className="relative aspect-[4/5] sm:aspect-square rounded-[32px] overflow-hidden ring-1 ring-white/10">
            <Film name="fiber-burst" className="scale-[1.35]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            <p className="absolute bottom-6 left-6 right-6 text-[15px] text-white/80">Compressed here, streamed everywhere.</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ---------- Speed ----------

function Speed() {
  const film = useRef<HTMLDivElement>(null);
  const ref = useScrollProgress<HTMLElement>(
    (p) => {
      if (film.current) film.current.style.transform = `translateY(${(p - 0.5) * -12}%) scale(1.25)`;
    },
    { start: 1, end: -1 },
  );
  return (
    <section id="speed" ref={ref} className="relative bg-black scroll-mt-14">
      <div className="relative h-[85svh] min-h-[560px] overflow-hidden">
        <div ref={film} className="absolute inset-0 will-change-transform">
          <Film name="light-trails" />
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(55%_50%_at_50%_50%,rgba(0,0,0,0.78),rgba(0,0,0,0.25)_75%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black to-transparent" />
        <Reveal className="relative h-full flex flex-col items-center justify-center text-center px-6">
          <h2 className="text-[48px] sm:text-[88px] leading-[0.98] font-semibold tracking-[-0.055em] text-white">
            Fast. <span className="text-glow">Really fast.</span>
          </h2>
          <p className="mt-6 max-w-2xl text-[17px] sm:text-[20px] text-white/70 leading-relaxed">
            Every piece streams straight from Cloudflare's network, never through a middleman. Short segments start instantly, and a weak signal means a lighter picture, never a frozen stream.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ---------- Player ----------

const PLAYER_FEATURES = ["0.75× to 2× speed", "Double-tap to skip", "Remembers where each viewer stopped", "Picture in picture", "Keyboard shortcuts", "Quality picked automatically"];

function Player() {
  return (
    <section className="bg-black px-4 sm:px-6 py-24 sm:py-36">
      <Reveal className="mx-auto max-w-3xl text-center">
        <h2 className="text-[40px] sm:text-[64px] leading-[1.02] font-semibold tracking-[-0.045em] text-white">A player your viewers love.</h2>
        <p className="mt-5 text-[17px] sm:text-[19px] text-white/60 leading-relaxed">Liquid glass controls that stay out of the way of the picture.</p>
      </Reveal>
      <Reveal delay={120} className="mt-14 sm:mt-20 mx-auto max-w-5xl">
        <div className="rounded-[22px] sm:rounded-[30px] p-1.5 sm:p-2 bg-gradient-to-b from-white/[0.14] to-white/[0.03] shadow-[0_60px_140px_-50px_rgba(140,120,255,0.45)]">
          <div className="relative aspect-video overflow-hidden rounded-[18px] sm:rounded-[24px]">
            <PlayerMock src={`${MEDIA}/light-trails.mp4`} poster={`${MEDIA}/light-trails.jpg`} title="Keynote · Opening film" className="absolute inset-0" />
          </div>
        </div>
      </Reveal>
      <div className="mt-12 mx-auto max-w-4xl flex flex-wrap justify-center gap-2.5">
        {PLAYER_FEATURES.map((f, i) => (
          <Reveal key={f} delay={i * 60}>
            <span className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-white/[0.06] ring-1 ring-white/[0.08] text-[14px] text-white/80">
              <Check className="size-3.5 text-[#ffb36b]" strokeWidth={2.6} />
              {f}
            </span>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ---------- Privacy ----------

const PRIVACY = [
  { icon: Lock, title: "Signed links", body: "Your server signs every private link, and it expires when you say. A shared URL stops working in hours, not never.", detail: "/embed/7b1e…?token=9fK2…&exp=1767225600" },
  { icon: Globe2, title: "Locked to your website", body: "The player refuses to load anywhere but your domains, even if someone copies the embed code.", detail: "yourdomain.com · allowed" },
  { icon: ShieldCheck, title: "Encrypted pieces", body: "Every segment is AES-128 encrypted before it leaves your computer. A downloaded piece is just noise without the player's key.", detail: "#EXT-X-KEY:METHOD=AES-128" },
  { icon: UserX, title: "No viewer accounts", body: "Your viewers never sign up with us. We never see their names, numbers or emails.", detail: "0 viewer records stored" },
];

function Privacy() {
  return (
    <section id="privacy" className="bg-black px-4 sm:px-6 py-24 sm:py-36 scroll-mt-14">
      <div className="mx-auto max-w-6xl">
        <Reveal className="max-w-3xl">
          <p className="text-[15px] font-semibold text-[#ffb36b]">Privacy</p>
          <h2 className="mt-3 text-[40px] sm:text-[64px] leading-[1.02] font-semibold tracking-[-0.045em] text-white">Your videos stay yours.</h2>
        </Reveal>
        <div className="mt-14 grid gap-4 sm:grid-cols-2">
          {PRIVACY.map(({ icon: Icon, title, body, detail }, i) => (
            <Reveal key={title} delay={i * 90}>
              <div className="group h-full rounded-[28px] bg-[#0d0d0f] ring-1 ring-white/[0.08] p-8 sm:p-10 transition-colors duration-500 hover:bg-[#121214]">
                <Icon className="size-7 text-[#ffb36b]" strokeWidth={1.6} />
                <h3 className="mt-8 text-[24px] font-semibold tracking-[-0.025em] text-white">{title}</h3>
                <p className="mt-3 text-[16px] leading-relaxed text-white/55">{body}</p>
                <div className="mt-8 inline-flex items-center h-9 px-3.5 rounded-full bg-white/[0.05] ring-1 ring-white/[0.07] font-mono text-[12px] text-white/50">{detail}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------- Developers ----------

const SAMPLES: { id: string; label: string; file: string; lang: Lang; code: string }[] = [
  {
    id: "sign",
    label: "Sign a link",
    file: "embed.js",
    lang: "js",
    code: `import crypto from "node:crypto";

// Runs on your server. The secret never reaches the browser.
export function dharaEmbedUrl(videoId, ttl = 2 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const token = crypto
    .createHmac("sha256", process.env.DHARA_SECRET)
    .update(\`\${videoId}:\${exp}\`)
    .digest("base64url");
  return \`https://play.dhara.app/embed/\${videoId}?token=\${token}&exp=\${exp}\`;
}`,
  },
  {
    id: "python",
    label: "Python",
    file: "embed.py",
    lang: "python",
    code: `import base64, hashlib, hmac, os, time

def dhara_embed_url(video_id, ttl=2 * 3600):
    exp = int(time.time()) + ttl
    msg = f"{video_id}:{exp}".encode()
    sig = hmac.new(os.environ["DHARA_SECRET"].encode(), msg, hashlib.sha256).digest()
    tok = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"https://play.dhara.app/embed/{video_id}?token={tok}&exp={exp}"`,
  },
  {
    id: "api",
    label: "HTTP API",
    file: "terminal",
    lang: "shell",
    code: `curl -X POST https://dhara.app/api/v1/playback-token \\
  -H "Authorization: ApiKey dk_3f9a…:$DHARA_SECRET" \\
  -d '{"video_id": "7b1e2c90-…", "ttl": 7200}'

# {"success": true, "exp": 1767225600,
#  "embed_url": "https://play.dhara.app/embed/7b1e2c90-…?token=…"}`,
  },
  {
    id: "embed",
    label: "Embed",
    file: "index.html",
    lang: "html",
    code: `<!-- Paste on any page of your allowed domains -->
<iframe
  src="https://play.dhara.app/embed/7b1e2c90?token=9fK&exp=1767225600"
  width="960" height="540"
  allow="autoplay; fullscreen; picture-in-picture"
  allowfullscreen
></iframe>`,
  },
];

const CAPABILITIES = [
  { icon: MonitorDown, title: "Desktop app", detail: "Mac · Windows" },
  { icon: HardDrive, title: "Your own bucket", detail: "Cloudflare R2" },
  { icon: ShieldCheck, title: "Signed playback", detail: "HMAC-SHA256 tokens" },
  { icon: Lock, title: "Encrypted HLS", detail: "AES-128 segments" },
  { icon: FolderClosed, title: "Categories", detail: "Public or private" },
  { icon: KeyRound, title: "API key", detail: "Rotate any time" },
];

const ENDPOINTS: [string, string, string][] = [
  ["POST", "/playback-token", "Sign a viewer's link"],
  ["GET", "/videos", "List and filter"],
  ["PATCH", "/videos/{id}", "Rename, move, privacy"],
  ["GET", "/categories", "Your categories"],
  ["DELETE", "/videos/{id}", "Remove everywhere"],
];

const METHOD_COLOR: Record<string, string> = {
  GET: "text-[#67b7a4] bg-[#67b7a4]/10",
  POST: "text-[#ffb36b] bg-[#ffb36b]/10",
  PATCH: "text-[#d0a8ff] bg-[#d0a8ff]/10",
  DELETE: "text-[#ff8170] bg-[#ff8170]/10",
};

function Developers() {
  const [tab, setTab] = useState(SAMPLES[0].id);
  const sample = SAMPLES.find((s) => s.id === tab)!;
  return (
    <section id="developers" className="bg-black px-4 sm:px-6 py-24 sm:py-36 scroll-mt-14">
      <div className="mx-auto max-w-6xl">
        <Reveal className="max-w-3xl">
          <p className="text-[15px] font-semibold text-[#ffb36b]">Developers</p>
          <h2 className="mt-3 text-[40px] sm:text-[64px] leading-[1.02] font-semibold tracking-[-0.045em] text-white">Built to plug in.</h2>
          <p className="mt-5 text-[17px] sm:text-[19px] text-white/60 leading-relaxed">Sign a link in a few lines, paste one iframe, done.</p>
        </Reveal>

        <div className="mt-14 grid gap-6 lg:grid-cols-[0.9fr_1.1fr] items-start">
          <Reveal className="min-w-0 space-y-6">
            <div className="grid grid-cols-2 gap-3">
              {CAPABILITIES.map(({ icon: Icon, title, detail }) => (
                <div key={title} className="rounded-[20px] bg-[#0d0d0f] ring-1 ring-white/[0.08] p-5">
                  <Icon className="size-5 text-[#ffb36b]" strokeWidth={1.7} />
                  <div className="mt-4 text-[15px] font-semibold text-white">{title}</div>
                  <div className="mt-1 font-mono text-[12px] text-white/45">{detail}</div>
                </div>
              ))}
            </div>
            <div className="rounded-[20px] bg-[#0d0d0f] ring-1 ring-white/[0.08] divide-y divide-white/[0.06]">
              {ENDPOINTS.map(([m, path, what]) => (
                <div key={m + path} className="flex items-center gap-3 px-5 h-12">
                  <span className={cx("w-[58px] text-center rounded-md py-0.5 font-mono text-[11px] font-semibold", METHOD_COLOR[m])}>{m}</span>
                  <code className="font-mono text-[12.5px] text-white/85 truncate">{path}</code>
                  <span className="ml-auto text-[12.5px] text-white/40 whitespace-nowrap hidden sm:block">{what}</span>
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={120} className="min-w-0">
            <div className="rounded-[24px] bg-[#0d0d0f] ring-1 ring-white/[0.08] overflow-hidden">
              <div className="flex items-center gap-2 px-5 h-11 border-b border-white/[0.06]">
                <span className="size-2.5 rounded-full bg-[#ff5f57]/80" /><span className="size-2.5 rounded-full bg-[#febc2e]/80" /><span className="size-2.5 rounded-full bg-[#28c840]/80" />
                <span className="ml-3 text-[12px] text-white/40 font-medium font-mono">{sample.file}</span>
              </div>
              <div className="flex gap-1 px-3 pt-3 overflow-x-auto" role="tablist">
                {SAMPLES.map((s) => (
                  <button
                    key={s.id}
                    role="tab"
                    aria-selected={tab === s.id}
                    onClick={() => setTab(s.id)}
                    className={cx("h-8 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors", tab === s.id ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white/80")}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="min-h-[360px]">
                <CodeView code={sample.code} lang={sample.lang} />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ---------- FAQ ----------

function Faq() {
  return (
    <section id="faq" className="bg-black px-4 sm:px-6 py-24 scroll-mt-14">
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <h2 className="text-[40px] sm:text-[56px] leading-[1.02] font-semibold tracking-[-0.045em] text-white text-center">Questions.</h2>
        </Reveal>
        <Reveal delay={100} className="mt-12 divide-y divide-white/[0.08] border-y border-white/[0.08]">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group py-6 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex items-center justify-between gap-6 cursor-pointer list-none text-[17px] sm:text-[19px] font-medium text-white tracking-[-0.01em]">
                {q}
                <span className="size-8 shrink-0 rounded-full ring-1 ring-white/15 flex items-center justify-center text-white/60 transition-transform duration-300 group-open:rotate-45">
                  <Plus className="size-4" strokeWidth={2} />
                </span>
              </summary>
              <p className="mt-4 text-[16px] leading-relaxed text-white/55 pr-12">{a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

// ---------- CTA (kept as designed) ----------

function Cta() {
  return (
    <section className="bg-black px-4 sm:px-6 py-24">
      <Reveal className="relative mx-auto max-w-6xl rounded-[32px] bg-[#1d1d1f] text-white px-6 py-20 sm:p-24 text-center overflow-hidden">
        <StreamCanvas variant="dark" labels={false} className="opacity-70" />
        <div className="absolute inset-0 bg-[radial-gradient(45%_70%_at_50%_50%,rgba(29,29,31,0.92),rgba(29,29,31,0.35)_70%,transparent)]" />
        <div className="relative">
          <h2 className="font-display text-[46px] sm:text-[66px] leading-[1.0]">Start streaming this week.</h2>
          <p className="mt-4 text-[16px] text-white/65 max-w-lg mx-auto">Your dhara admin sets up your account and storage. Sign in, upload a video, and embed it on your site in minutes.</p>
          <Link to="/login" className="inline-block mt-9 group">
            <Button size="lg" variant="secondary" className="!bg-white !text-[#1d1d1f] !border-white">
              Sign in <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

export default function Landing() {
  useDarkTheme();
  return (
    <div className="min-h-dvh bg-black text-white overflow-x-clip">
      <Nav />
      <Hero />
      <LaptopStory />
      <UploadOnce />
      <Speed />
      <Player />
      <Privacy />
      <Developers />
      <Faq />
      <Cta />
      <footer className="bg-black border-t border-white/[0.07]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-[13px] text-white/40">
          <Logo className="scale-90 origin-left" />
          <p>Compressed at home. Streaming everywhere.</p>
          <p>© {new Date().getFullYear()} dhara</p>
        </div>
      </footer>
    </div>
  );
}
