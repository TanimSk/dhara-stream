import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, ChevronUp, RotateCw, X } from "lucide-react";

import { useUploads, type Job } from "../lib/upload/store";
import { ProgressBar, Spinner, cx } from "./ui";

const LABEL: Record<Job["phase"], string> = {
  queued: "Waiting",
  probing: "Reading file",
  transcoding: "Compressing",
  uploading: "Uploading",
  finalizing: "Finishing",
  done: "Ready",
  error: "Failed",
  canceled: "Canceled",
};

function Row({ job }: { job: Job }) {
  const { cancel, dismiss } = useUploads();
  const active = !["done", "error", "canceled"].includes(job.phase);
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="size-5 shrink-0 flex items-center justify-center">
          {job.phase === "done" ? <Check className="size-4 text-ok" /> : job.phase === "error" ? <X className="size-4 text-bad" /> : active ? <Spinner className="size-4" /> : <X className="size-4 text-ink-4" />}
        </span>
        <div className="min-w-0 flex-1">
          {job.videoId && job.phase === "done" ? (
            <Link to={`/app/videos/${job.videoId}`} className="block text-[13px] font-medium truncate hover:underline">{job.title}</Link>
          ) : (
            <div className="text-[13px] font-medium truncate">{job.title}</div>
          )}
          <div className={cx("text-[12px] truncate", job.phase === "error" ? "text-bad" : "text-ink-3")}>
            {job.phase === "error" ? job.error : `${LABEL[job.phase]}${job.detail ? ` · ${job.detail}` : ""}${active && job.progress > 0 ? ` · ${Math.round(job.progress * 100)}%` : ""}`}
          </div>
        </div>
        <button
          onClick={() => (active ? cancel(job.id) : dismiss(job.id))}
          className="size-7 rounded-lg flex items-center justify-center text-ink-3 hover:bg-sunken hover:text-ink"
          aria-label={active ? "Cancel" : "Dismiss"}
          title={active ? "Cancel" : "Dismiss"}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {active && job.phase !== "queued" && (
        <ProgressBar className="mt-2" value={job.progress * 100} tone={job.phase === "transcoding" ? "clay" : "ink"} />
      )}
    </div>
  );
}

export default function UploadTray() {
  const { jobs, busy, clearFinished } = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  if (!jobs.length) return null;
  const active = jobs.filter((j) => !["done", "error", "canceled"].includes(j.phase)).length;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[360px] max-w-[calc(100vw-32px)] rounded-2xl border border-line bg-surface shadow-float overflow-hidden animate-fade-up">
      <div className="flex items-center justify-between px-4 h-11 border-b border-line">
        <span className="text-[13px] font-semibold">{busy ? `Uploading ${active} video${active === 1 ? "" : "s"}` : "Uploads finished"}</span>
        <div className="flex items-center gap-1">
          {!busy && (
            <button onClick={clearFinished} className="h-7 px-2 rounded-lg text-[12px] text-ink-3 hover:bg-sunken hover:text-ink inline-flex items-center gap-1">
              <RotateCw className="size-3" /> Clear
            </button>
          )}
          <button onClick={() => setCollapsed((c) => !c)} className="size-7 rounded-lg flex items-center justify-center text-ink-3 hover:bg-sunken" aria-label="Toggle">
            {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </div>
      </div>
      {!collapsed && <div className="max-h-[320px] overflow-y-auto divide-y divide-line">{jobs.map((j) => <Row key={j.id} job={j} />)}</div>}
    </div>
  );
}
