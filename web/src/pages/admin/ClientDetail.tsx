import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, RefreshCw, Trash2 } from "lucide-react";

import BucketStatus from "../../components/BucketStatus";
import DomainsEditor from "../../components/DomainsEditor";
import {
  Badge, Button, Card, CardHeader, ConfirmModal, CopyField, Field, Input, LoadingBlock, Modal, SettingRow, Textarea, Toggle, useToast,
} from "../../components/ui";
import { useAdminClient } from "../../hooks/queries";
import { del, patch, post, put } from "../../lib/api";
import { bytes, date } from "../../lib/format";

function ManualBucketModal({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ name: "", account_id: "", access_key_id: "", secret_access_key: "" });
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => put(`/admin/clients/${id}/bucket`, f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast("Bucket saved");
      onClose();
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enter bucket credentials"
      description="For a bucket you created yourself in Cloudflare. Use an R2 API token scoped to this bucket with Object Read & Write. Remember to add a CORS rule for the player and dashboard origins."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={Object.values(f).some((v) => !v.trim())}>Save</Button></>}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bucket name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Account ID"><Input value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })} className="font-mono" /></Field>
        </div>
        <Field label="Access key ID"><Input value={f.access_key_id} onChange={(e) => setF({ ...f, access_key_id: e.target.value })} className="font-mono" /></Field>
        <Field label="Secret access key"><Input type="password" autoComplete="off" value={f.secret_access_key} onChange={(e) => setF({ ...f, secret_access_key: e.target.value })} className="font-mono" /></Field>
      </div>
    </Modal>
  );
}

export default function AdminClientDetail() {
  const { id = "" } = useParams();
  const { data: c, isLoading } = useAdminClient(id);
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [domains, setDomains] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [manual, setManual] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [password, setPassword] = useState<string | null>(null);

  useEffect(() => {
    if (c) {
      setDomains(c.allowed_domains);
      setNotes(c.notes);
    }
  }, [c]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin"] });
  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => patch(`/admin/clients/${id}`, body),
    onSuccess: () => { refresh(); toast("Saved"); },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const provision = useMutation({
    mutationFn: () => post<{ message: string }>(`/admin/clients/${id}/provision`),
    onSuccess: (d) => { refresh(); toast(d.message, d.message.startsWith("Bucket ready") ? "ok" : "bad"); },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const reset = useMutation({
    mutationFn: () => post<{ password: string }>(`/admin/clients/${id}/reset-password`),
    onSuccess: (d) => setPassword(d.password),
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const remove = useMutation({
    mutationFn: () => del<{ warnings: string[] }>(`/admin/clients/${id}`),
    onSuccess: (d) => {
      refresh();
      toast(d.warnings?.length ? `Deleted, with warnings: ${d.warnings.join("; ")}` : "Client deleted", d.warnings?.length ? "bad" : "ok");
      navigate("/admin/clients");
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });

  if (isLoading || !c) return <LoadingBlock />;
  const b = c.bucket;
  const suspended = c.status === "suspended";

  return (
    <>
      <Link to="/admin/clients" className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink mb-5"><ArrowLeft className="size-4" />Clients</Link>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8 animate-fade-up">
        <div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.025em]">{c.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
            {suspended ? <Badge tone="bad" dot>Suspended</Badge> : <Badge tone="ok" dot>Active</Badge>}
            <span>{c.owner_email}</span>·<span>since {date(c.created_at)}</span>·<span>{c.video_count} videos, {bytes(c.storage_bytes)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => reset.mutate()} loading={reset.isPending}>Reset password</Button>
          <Button variant={suspended ? "primary" : "danger"} onClick={() => update.mutate({ status: suspended ? "active" : "suspended" })}>{suspended ? "Reactivate" : "Suspend"}</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <Card>
          <CardHeader
            title="Storage bucket"
            description="Private R2 bucket in your Cloudflare account. Credentials never leave the server."
            action={<BucketStatus bucket={b} />}
          />
          <div className="px-6 pb-6 space-y-3">
            {b && (
              <div className="rounded-2xl bg-sunken/60 border border-line px-4 py-3 text-[13px] space-y-1">
                <div><span className="text-ink-3">Name</span> <span className="font-mono">{b.name}</span></div>
                {b.account_id && <div><span className="text-ink-3">Account</span> <span className="font-mono">{b.account_id}</span></div>}
                {b.access_key_id && <div className="truncate"><span className="text-ink-3">Access key</span> <span className="font-mono">{b.access_key_id}</span></div>}
                <div><span className="text-ink-3">Set up</span> {b.manual ? "manually" : "automatically"}</div>
              </div>
            )}
            {b?.status === "failed" && <p className="text-[12.5px] text-bad leading-relaxed">{b.error}</p>}
            <div className="flex flex-wrap gap-2">
              {b?.status !== "ready" && <Button icon={<RefreshCw className="size-3.5" />} loading={provision.isPending} onClick={() => provision.mutate()}>Retry provisioning</Button>}
              <Button variant="secondary" onClick={() => setManual(true)}>Enter credentials manually</Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Playback security" description="The client can change these too." action={<Button size="sm" onClick={() => update.mutate({ allowed_domains: domains })} disabled={JSON.stringify(domains) === JSON.stringify(c.allowed_domains)}>Save domains</Button>} />
          <div className="px-6 pb-2"><DomainsEditor value={domains} onChange={setDomains} /></div>
          <div className="px-6 pb-3">
            <SettingRow title="Allow direct links" description="Play without a referring page." control={<Toggle checked={c.allow_direct} onChange={(v) => update.mutate({ allow_direct: v })} label="Allow direct links" />} />
          </div>
          <div className="px-6 pb-6"><CopyField label="API key ID" value={c.api_key_id} /></div>
        </Card>

        <Card>
          <CardHeader title="Notes" action={<Button size="sm" variant="secondary" onClick={() => update.mutate({ notes })} disabled={notes === c.notes}>Save</Button>} />
          <div className="px-6 pb-6"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contract, contact person, anything useful." /></div>
        </Card>

        <Card className="!border-bad/25">
          <CardHeader title="Delete client" description="Deletes their login, every video in their bucket, the bucket itself and its access token." />
          <div className="px-6 pb-6"><Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmDelete(true)}>Delete client</Button></div>
        </Card>
      </div>

      <ManualBucketModal id={id} open={manual} onClose={() => setManual(false)} />
      <Modal open={!!password} onClose={() => setPassword(null)} title="New temporary password" description="Share it with the client. It isn't shown again." footer={<Button onClick={() => setPassword(null)}>Done</Button>}>
        {password && <CopyField value={password} />}
      </Modal>
      <ConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title={`Delete ${c.name}?`}
        description="All their videos stop playing and are permanently deleted from storage. This can't be undone."
      />
    </>
  );
}
