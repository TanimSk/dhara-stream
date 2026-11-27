import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, AlertTriangle } from "lucide-react";

import BucketStatus from "../../components/BucketStatus";
import { Badge, Button, Card, CardHeader, LoadingBlock, PageHeader, Stat } from "../../components/ui";
import { useAdminClients } from "../../hooks/queries";
import { get } from "../../lib/api";
import { bytes, relative } from "../../lib/format";

interface Overview {
  clients: number;
  active_clients: number;
  videos: number;
  storage_bytes: number;
  hours: number;
  buckets_failed: number;
}

export default function AdminOverview() {
  const { data } = useQuery({ queryKey: ["admin", "overview"], queryFn: () => get<Overview>("/admin/overview") });
  const { data: recent } = useAdminClients({});
  if (!data) return <LoadingBlock />;
  return (
    <>
      <PageHeader title="Overview" description="Every client, their storage, and what needs attention." actions={<Link to="/admin/clients?new=1"><Button>New client</Button></Link>} />
      {data.buckets_failed > 0 && (
        <Card className="mb-6 px-5 py-4 flex items-center gap-3 !bg-bad-soft !border-bad/20">
          <AlertTriangle className="size-4 text-bad" />
          <span className="text-[13.5px] text-bad flex-1">{data.buckets_failed} client bucket{data.buckets_failed === 1 ? "" : "s"} failed to provision.</span>
          <Link to="/admin/clients" className="text-[13px] font-medium text-bad underline">Review</Link>
        </Card>
      )}
      <Card className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-line">
        <Stat className="px-5 py-5" label="Clients" value={data.clients} sub={`${data.active_clients} active`} />
        <Stat className="px-5 py-5" label="Videos" value={data.videos} />
        <Stat className="px-5 py-5" label="Hours stored" value={data.hours} />
        <Stat className="px-5 py-5" label="Storage" value={bytes(data.storage_bytes)} />
      </Card>
      <Card className="mt-6">
        <CardHeader title="Recent clients" action={<Link to="/admin/clients" className="text-[13px] font-medium text-ink-2 hover:text-ink inline-flex items-center gap-1">All clients <ArrowRight className="size-3.5" /></Link>} />
        <div className="divide-y divide-line border-t border-line">
          {recent?.results.slice(0, 6).map((c) => (
            <Link key={c.id} to={`/admin/clients/${c.id}`} className="flex items-center gap-4 px-6 py-3.5 hover:bg-sunken/50">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium truncate">{c.name}</div>
                <div className="text-[12.5px] text-ink-3 truncate">{c.owner_email} · added {relative(c.created_at)}</div>
              </div>
              {c.status === "suspended" && <Badge tone="bad">Suspended</Badge>}
              <BucketStatus bucket={c.bucket} />
              <span className="w-20 text-right text-[13px] text-ink-3 tabular">{c.video_count} videos</span>
            </Link>
          ))}
          {recent && !recent.results.length && <p className="px-6 py-8 text-center text-[13.5px] text-ink-3">No clients yet.</p>}
        </div>
      </Card>
    </>
  );
}
