import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Search } from "lucide-react";

import BucketStatus from "../../components/BucketStatus";
import DomainsEditor from "../../components/DomainsEditor";
import {
  Badge, Button, Card, CopyField, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Select, Textarea, useToast,
} from "../../components/ui";
import { useAdminClients } from "../../hooks/queries";
import { post } from "../../lib/api";
import { bytes, date } from "../../lib/format";
import type { AdminClient } from "../../lib/types";

function NewClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", notes: "" });
  const [domains, setDomains] = useState<string[]>([]);
  const [created, setCreated] = useState<{ client: AdminClient; password: string | null } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const create = useMutation({
    mutationFn: () => post<{ client: AdminClient; password: string | null }>("/admin/clients", { ...form, allowed_domains: domains }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      setCreated(d);
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const close = () => {
    setForm({ name: "", email: "", password: "", notes: "" });
    setDomains([]);
    const c = created;
    setCreated(null);
    onClose();
    if (c) navigate(`/admin/clients/${c.client.id}`);
  };

  if (created) {
    const b = created.client.bucket;
    return (
      <Modal open={open} onClose={close} title="Client created" footer={<Button onClick={close}>Done</Button>}>
        <div className="space-y-4">
          <CopyField label="Sign-in email" value={created.client.owner_email ?? form.email} mono={false} />
          {created.password && <CopyField label="Temporary password (shown once)" value={created.password} />}
          <div className="flex items-center justify-between rounded-2xl bg-sunken/60 border border-line px-4 py-3">
            <div>
              <div className="text-[13px] font-medium">Storage bucket</div>
              <div className="text-[12.5px] text-ink-3 font-mono">{b?.name}</div>
            </div>
            <BucketStatus bucket={b} />
          </div>
          {b?.status === "failed" && <p className="text-[12.5px] text-bad leading-relaxed">{b.error}</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="New client"
      description="Creates their login and a private R2 bucket in your Cloudflare account."
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.name.trim() || !form.email.trim()}>Create client</Button></>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="Client name"><Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bright Coaching Center" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Login email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Password" hint="Leave empty to generate one."><Input type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        </div>
        <Field label="Allowed domains" hint="Where their videos may be embedded. They can change this later."><span /></Field>
        <DomainsEditor value={domains} onChange={setDomains} />
        <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="!min-h-16" /></Field>
      </form>
    </Modal>
  );
}

export default function AdminClients() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const status = params.get("status") ?? "";
  const { data, isLoading } = useAdminClients({ q, status });
  const creating = params.get("new") === "1";
  const setCreating = (on: boolean) => {
    const n = new URLSearchParams(params);
    if (on) n.set("new", "1");
    else n.delete("new");
    setParams(n, { replace: true });
  };

  return (
    <>
      <PageHeader title="Clients" description="Each client has its own login, bucket, domains and API key." actions={<Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>New client</Button>} />
      <div className="flex flex-wrap gap-2 mb-5">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-4" />
          <Input className="pl-9" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select className="!w-auto" value={status} onChange={(e) => { const n = new URLSearchParams(params); if (e.target.value) n.set("status", e.target.value); else n.delete("status"); setParams(n); }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : !data?.results.length ? (
        <Card><EmptyState icon={<Building2 className="size-6" />} title={q || status ? "No matches" : "No clients yet"} description="Create a client to give them a login and storage." /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-[12px] text-ink-3 border-b border-line">
                <th className="font-medium px-6 py-3">Client</th>
                <th className="font-medium px-3 py-3">Bucket</th>
                <th className="font-medium px-3 py-3 text-right">Videos</th>
                <th className="font-medium px-3 py-3 text-right">Storage</th>
                <th className="font-medium px-6 py-3 text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.results.map((c) => (
                <tr key={c.id} className="hover:bg-sunken/50">
                  <td className="px-6 py-3.5">
                    <Link to={`/admin/clients/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    {c.status === "suspended" && <Badge tone="bad" className="ml-2">Suspended</Badge>}
                    <div className="text-[12.5px] text-ink-3">{c.owner_email}</div>
                  </td>
                  <td className="px-3 py-3.5"><BucketStatus bucket={c.bucket} /></td>
                  <td className="px-3 py-3.5 text-right tabular">{c.video_count}</td>
                  <td className="px-3 py-3.5 text-right tabular">{bytes(c.storage_bytes)}</td>
                  <td className="px-6 py-3.5 text-right text-ink-3">{date(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <NewClientModal open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
