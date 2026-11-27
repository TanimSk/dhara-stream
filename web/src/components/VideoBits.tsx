import { Clock, Globe2, Lock, PlayCircle } from "lucide-react";
import { Link } from "react-router-dom";

import { duration, relative } from "../lib/format";
import type { Video } from "../lib/types";
import { Badge, Spinner, cx } from "./ui";

export function VisibilityBadge({ v }: { v: Video }) {
  return v.effective_visibility === "private" ? (
    <Badge tone="clay"><Lock className="size-3" />Private{v.visibility === "public" ? " (category)" : ""}</Badge>
  ) : (
    <Badge tone="neutral"><Globe2 className="size-3" />Public</Badge>
  );
}

export function StatusBadge({ v }: { v: Video }) {
  if (v.status === "ready") return null;
  if (v.status === "failed") return <Badge tone="bad" dot>Failed</Badge>;
  return <Badge tone="warn"><Spinner className="size-3 !text-warn" />Uploading</Badge>;
}

export function Thumb({ v, className }: { v: Video; className?: string }) {
  return (
    <div className={cx("relative aspect-video rounded-2xl overflow-hidden bg-sunken border border-line", className)}>
      {v.thumbnail_url ? (
        <img src={v.thumbnail_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-ink-4"><PlayCircle className="size-8" strokeWidth={1.4} /></div>
      )}
      {v.status === "ready" && v.duration > 0 && (
        <span className="absolute bottom-2 right-2 rounded-md bg-black/70 text-white text-[11.5px] font-medium px-1.5 py-0.5 tabular">{duration(v.duration)}</span>
      )}
    </div>
  );
}

export function VideoCard({ v }: { v: Video }) {
  return (
    <Link to={`/app/videos/${v.id}`} className="group block">
      <Thumb v={v} className="transition-shadow group-hover:shadow-card" />
      <div className="mt-2.5 px-0.5">
        <div className="text-[14px] font-medium leading-snug line-clamp-2 group-hover:underline decoration-ink-4 underline-offset-2">{v.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge v={v} />
          <VisibilityBadge v={v} />
          {v.qualities[0] && <Badge tone="neutral">{v.qualities[0] >= 2160 ? "4K" : `${v.qualities[0]}p`}</Badge>}
          <span className="text-[12px] text-ink-3 inline-flex items-center gap-1 ml-auto"><Clock className="size-3" />{relative(v.created_at)}</span>
        </div>
      </div>
    </Link>
  );
}
