import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock, Trash2 } from "lucide-react";

import { StatusBadge, Thumb, VisibilityBadge } from "../../components/VideoBits";
import {
  Badge, Button, Card, CardHeader, CodeBlock, ConfirmModal, CopyField, Field, Input, LoadingBlock, Select, Tabs, Textarea, useToast,
} from "../../components/ui";
import { useCategories, useVideo } from "../../hooks/queries";
import { del, get, patch } from "../../lib/api";
import { bytes, date, duration } from "../../lib/format";
import type { Visibility } from "../../lib/types";

interface EmbedInfo {
  embed_url: string;
  preview_url: string;
  iframe: string;
  private: boolean;
  key_id: string;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-t border-line first:border-t-0 text-[13.5px]">
      <span className="text-ink-3">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export default function VideoDetail() {
  const { id = "" } = useParams();
  const { data: v, isLoading } = useVideo(id);
  const { data: categories } = useCategories();
  const { data: embed } = useQuery({
    queryKey: ["videos", "embed", id],
    queryFn: () => get<EmbedInfo>(`/videos/${id}/embed`),
    enabled: v?.status === "ready",
    staleTime: 30 * 60_000,
  });
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: "", description: "", category: "", visibility: "public" as Visibility });
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (v) setForm({ title: v.title, description: v.description, category: v.category ? String(v.category) : "", visibility: v.visibility });
  }, [v]);

  const save = useMutation({
    mutationFn: () => patch(`/videos/${id}`, { ...form, category: form.category ? Number(form.category) : null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["videos"] });
      toast("Saved");
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const remove = useMutation({
    mutationFn: () => del(`/videos/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["videos"] });
      qc.invalidateQueries({ queryKey: ["account"] });
      toast("Video deleted");
      navigate("/app");
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });

  if (isLoading || !v) return <LoadingBlock />;
  const dirty = form.title !== v.title || form.description !== v.description || form.category !== (v.category ? String(v.category) : "") || form.visibility !== v.visibility;

  return (
    <>
      <Link to="/app" className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink mb-5"><ArrowLeft className="size-4" />Videos</Link>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6 animate-fade-up">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] break-words">{v.title}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5"><StatusBadge v={v} /><VisibilityBadge v={v} />{v.category_name && <Badge>{v.category_name}</Badge>}</div>
        </div>
        <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirm(true)}>Delete</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] items-start">
        <div className="space-y-6 min-w-0">
          {v.status === "ready" && embed ? (
            <div className="relative aspect-video rounded-3xl overflow-hidden bg-black shadow-card">
              <iframe
                src={embed.preview_url}
                title={v.title}
                className="absolute inset-0 h-full w-full border-0"
                allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="relative">
              <Thumb v={v} className="!rounded-3xl" />
              <div className="absolute inset-0 flex items-center justify-center text-[14px] font-medium text-ink-2">
                {v.status === "failed" ? "This upload failed. Delete it and upload again." : v.status === "uploading" ? "Still uploading…" : null}
              </div>
            </div>
          )}

          {embed && (
            <Card>
              <CardHeader
                title="Embed"
                description={
                  embed.private ? (
                    <span className="inline-flex items-start gap-1.5"><Lock className="size-3.5 mt-0.5 shrink-0" />Private: your server replaces TOKEN and EXP with a signed token. See <Link to="/app/embedding" className="underline">Embed &amp; security</Link>.</span>
                  ) : "Paste this on any page of your allowed domains."
                }
              />
              <div className="px-6 pb-6 space-y-4">
                <CodeBlock language="html" code={embed.iframe} />
                <CopyField label="Video ID" value={v.id} />
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <form className="px-6 pb-6 space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <Field label="Title"><Input value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
              <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
              <Field label="Category">
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="">No category</option>
                  {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.visibility === "private" ? " (private)" : ""}</option>)}
                </Select>
              </Field>
              <Field label="Visibility" hint={v.visibility === "public" && v.effective_visibility === "private" ? "Private because its category is private." : undefined}>
                <Tabs value={form.visibility} onChange={(x) => setForm({ ...form, visibility: x })} tabs={[{ value: "public", label: "Public" }, { value: "private", label: "Private" }]} />
              </Field>
              <div className="flex justify-end"><Button type="submit" disabled={!dirty || !form.title.trim()} loading={save.isPending}>Save changes</Button></div>
            </form>
          </Card>
          <Card className="px-6 py-3">
            <Row label="Qualities" value={v.qualities.length ? v.qualities.map((q) => `${q}p`).join(" · ") : v.source === "mp4" ? "Original (MP4)" : "-"} />
            <Row label="Duration" value={duration(v.duration)} />
            <Row label="Resolution" value={v.width ? `${v.width}×${v.height}` : "-"} />
            <Row label="Size" value={bytes(v.size_bytes)} />
            <Row label="Protection" value={v.source === "hls" ? "AES-128 encrypted HLS" : "Signed MP4 link"} />
            <Row label="Uploaded from" value={v.uploaded_via === "desktop" ? "Desktop app" : "Web"} />
            <Row label="File" value={<span className="truncate max-w-[180px] inline-block align-bottom">{v.original_filename || "-"}</span>} />
            <Row label="Added" value={date(v.created_at)} />
          </Card>
        </div>
      </div>

      <ConfirmModal
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Delete this video?"
        description="It's removed from your storage and stops playing everywhere it's embedded. This can't be undone."
      />
    </>
  );
}
