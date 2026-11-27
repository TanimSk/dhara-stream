import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PlayCircle, Search, UploadCloud } from "lucide-react";

import UploadDialog from "../../components/UploadDialog";
import { VideoCard } from "../../components/VideoBits";
import { Button, EmptyState, Input, LoadingBlock, PageHeader, Select, Stat, Card, cx } from "../../components/ui";
import { useAccount, useCategories, useVideos } from "../../hooks/queries";
import { bytes, hours } from "../../lib/format";

export default function Videos() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const visibility = params.get("visibility") ?? "";
  const page = Number(params.get("p") ?? 1);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [upload, setUpload] = useState(false);
  const { data: account } = useAccount();
  const { data: categories } = useCategories();
  const { data, isLoading } = useVideos({ category, visibility, q: params.get("q") ?? "", p: page });

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "p") next.delete("p");
    setParams(next, { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(() => q !== (params.get("q") ?? "") && set("q", q), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const stats = account?.stats;
  const bucketReady = account?.account.bucket_status === "ready";

  return (
    <>
      <PageHeader
        title="Videos"
        description="Everything you've uploaded. Public videos play on your allowed domains; private ones need a signed link."
        actions={<Button onClick={() => setUpload(true)} disabled={!bucketReady} icon={<UploadCloud className="size-4" />}>Upload</Button>}
      />

      {account && !bucketReady && (
        <Card className="mb-6 px-5 py-4 !bg-warn-soft !border-warn/20 text-[13.5px] text-warn">
          Your storage is still being set up ({account.account.bucket_status}). Uploads open as soon as your admin finishes it.
        </Card>
      )}

      {stats && (
        <Card className="mb-8 grid grid-cols-2 sm:grid-cols-4 divide-x divide-line">
          <Stat className="px-5 py-4" label="Videos" value={stats.videos} />
          <Stat className="px-5 py-4" label="Watch time stored" value={hours(stats.seconds)} />
          <Stat className="px-5 py-4" label="Storage" value={bytes(stats.storage_bytes)} />
          <Stat className="px-5 py-4" label="Private" value={stats.private} />
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-4" />
          <Input className="pl-9" placeholder="Search titles" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="!w-auto" value={category} onChange={(e) => set("category", e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          <option value="none">Uncategorized</option>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select className="!w-auto" value={visibility} onChange={(e) => set("visibility", e.target.value)} aria-label="Visibility">
          <option value="">Any visibility</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </Select>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : !data?.results.length ? (
        <Card>
          <EmptyState
            icon={<PlayCircle className="size-6" />}
            title={params.toString() ? "No videos match" : "No videos yet"}
            description={params.toString() ? "Try another filter." : "Upload your first video. It's encrypted before it ever leaves your computer."}
            action={!params.toString() && bucketReady ? <Button onClick={() => setUpload(true)} icon={<UploadCloud className="size-4" />}>Upload a video</Button> : undefined}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {data.results.map((v) => <VideoCard key={v.id} v={v} />)}
          </div>
          {data.num_pages > 1 && (
            <div className="mt-10 flex items-center justify-center gap-1.5">
              {Array.from({ length: data.num_pages }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => set("p", String(n))}
                  className={cx("size-9 rounded-full text-[13px] font-medium tabular", n === data.current_page ? "bg-ink text-canvas" : "text-ink-2 hover:bg-sunken")}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <UploadDialog open={upload} onClose={() => setUpload(false)} defaultCategory={category && category !== "none" ? Number(category) : null} />
    </>
  );
}
