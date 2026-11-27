import { useRef, useState } from "react";
import { FileVideo, Lock, MonitorDown, Trash2, UploadCloud, Globe2 } from "lucide-react";

import { useCategories } from "../hooks/queries";
import { desktop } from "../lib/desktop";
import { bytes } from "../lib/format";
import { DEFAULT_QUALITIES, QUALITIES } from "../lib/upload/quality";
import { useUploads, type JobInput } from "../lib/upload/store";
import type { Visibility } from "../lib/types";
import { Button, Field, Input, Modal, Select, Tabs, cx } from "./ui";

interface Picked {
  key: string;
  name: string;
  size: number;
  title: string;
  file?: File;
  path?: string;
}

const titleOf = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 200) || "Untitled";

export default function UploadDialog({ open, onClose, defaultCategory }: { open: boolean; onClose: () => void; defaultCategory?: number | null }) {
  const { data: categories } = useCategories();
  const { add } = useUploads();
  const [files, setFiles] = useState<Picked[]>([]);
  const [category, setCategory] = useState<string>(defaultCategory ? String(defaultCategory) : "");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [heights, setHeights] = useState<number[]>(DEFAULT_QUALITIES);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const addFiles = (list: File[]) => {
    const vids = list.filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(f.name));
    setFiles((xs) => [
      ...xs,
      ...vids.map((f) => ({
        key: `${f.name}-${f.size}-${f.lastModified}`,
        name: f.name,
        size: f.size,
        title: titleOf(f.name),
        file: desktop ? undefined : f,
        path: desktop ? desktop.pathForFile(f) : undefined,
      })),
    ]);
  };

  const pickDesktop = async () => {
    const picked = await desktop!.pickFiles();
    setFiles((xs) => [...xs, ...picked.map((p) => ({ key: p.path, name: p.name, size: p.size, title: titleOf(p.name), path: p.path }))]);
  };

  const close = () => {
    setFiles([]);
    onClose();
  };

  const start = () => {
    const jobs: JobInput[] = files.map((f) => ({
      title: f.title.trim() || titleOf(f.name),
      category: category ? Number(category) : null,
      visibility,
      heights: [...heights].sort((a, b) => b - a),
      file: f.file,
      path: f.path,
      name: f.name,
      size: f.size,
    }));
    add(jobs);
    close();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      width="max-w-2xl"
      title="Upload videos"
      description={
        desktop
          ? "Each video is compressed on this computer into the qualities you pick, encrypted, then uploaded straight to your storage."
          : "Web uploads keep the original quality (no compression). Use the desktop app to create several qualities."
      }
      footer={
        <>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button onClick={start} disabled={!files.length || (desktop && !heights.length)} icon={<UploadCloud className="size-4" />}>
            Upload {files.length > 1 ? `${files.length} videos` : "video"}
          </Button>
        </>
      }
    >
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles([...e.dataTransfer.files]); }}
        className={cx(
          "rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          drag ? "border-clay bg-clay-soft/50" : "border-line-strong bg-sunken/40",
        )}
      >
        <UploadCloud className="size-8 mx-auto text-ink-3" strokeWidth={1.5} />
        <p className="mt-3 text-[14px] font-medium">Drop video files here</p>
        <p className="mt-1 text-[12.5px] text-ink-3">MP4, MOV, MKV, WebM</p>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => (desktop ? pickDesktop() : input.current?.click())}>
          Choose files
        </Button>
        <input ref={input} type="file" accept="video/*,.mkv,.mov" multiple hidden onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>

      {files.length > 0 && (
        <div className="mt-4 max-h-56 overflow-y-auto rounded-2xl border border-line divide-y divide-line">
          {files.map((f, i) => (
            <div key={f.key} className="flex items-center gap-3 px-3.5 py-2.5">
              <FileVideo className="size-4 text-ink-3 shrink-0" />
              <Input
                className="!h-8 !text-[13px]"
                value={f.title}
                aria-label="Title"
                onChange={(e) => setFiles((xs) => xs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
              />
              <span className="text-[12px] text-ink-3 tabular whitespace-nowrap">{bytes(f.size)}</span>
              <button onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))} className="size-7 rounded-lg flex items-center justify-center text-ink-3 hover:bg-sunken hover:text-bad" aria-label="Remove">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">No category</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.visibility === "private" ? " (private)" : ""}</option>)}
          </Select>
        </Field>
        <Field label="Visibility">
          <Tabs
            value={visibility}
            onChange={setVisibility}
            tabs={[
              { value: "public", label: <span className="inline-flex items-center gap-1.5"><Globe2 className="size-3.5" />Public</span> },
              { value: "private", label: <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" />Private</span> },
            ]}
          />
        </Field>
      </div>

      {desktop ? (
        <div className="mt-5">
          <div className="text-[13px] font-medium mb-2">Qualities</div>
          <div className="flex flex-wrap gap-2">
            {QUALITIES.map((q) => {
              const on = heights.includes(q);
              return (
                <button
                  key={q}
                  type="button"
                  onClick={() => setHeights((hs) => (on ? hs.filter((h) => h !== q) : [...hs, q]))}
                  className={cx(
                    "h-8 px-3.5 rounded-full text-[13px] font-medium border transition-colors tabular",
                    on ? "bg-ink text-canvas border-ink" : "bg-surface text-ink-2 border-line hover:border-line-strong",
                  )}
                >
                  {q === 2160 ? "4K" : `${q}p`}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[12px] text-ink-3">Qualities above the source resolution are skipped. More qualities take longer to compress.</p>
        </div>
      ) : (
        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-sunken/70 border border-line px-4 py-3">
          <MonitorDown className="size-4 mt-0.5 text-ink-3 shrink-0" />
          <p className="text-[12.5px] text-ink-2 leading-relaxed">
            In the browser, H.264 videos up to 2 GB are cut into encrypted segments without re-encoding. Other files are uploaded as a single MP4 (up to 5 GB) with lighter protection.
          </p>
        </div>
      )}
    </Modal>
  );
}
