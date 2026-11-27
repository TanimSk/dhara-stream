import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw } from "lucide-react";

import DomainsEditor from "../../components/DomainsEditor";
import {
  Button, Card, CardHeader, CodeBlock, ConfirmModal, CopyField, LoadingBlock, PageHeader, SettingRow, Tabs, Toggle, useToast,
} from "../../components/ui";
import { useAccount } from "../../hooks/queries";
import { get, patch, post } from "../../lib/api";

type Lang = "node" | "php" | "python" | "api";

function snippets(player: string, apiOrigin: string, keyId: string): Record<Lang, string> {
  return {
    node: `import crypto from "node:crypto";

// DHARA_SECRET stays on your server. Never send it to the browser.
export function dharaEmbedUrl(videoId, ttlSeconds = 2 * 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const token = crypto
    .createHmac("sha256", process.env.DHARA_SECRET)
    .update(\`\${videoId}:\${exp}\`)
    .digest("base64url");
  return \`${player}/embed/\${videoId}?token=\${token}&exp=\${exp}\`;
}`,
    php: `<?php
function dhara_embed_url(string $videoId, int $ttl = 7200): string {
    $exp = time() + $ttl;
    $sig = hash_hmac('sha256', "$videoId:$exp", getenv('DHARA_SECRET'), true);
    $token = rtrim(strtr(base64_encode($sig), '+/', '-_'), '=');
    return "${player}/embed/$videoId?token=$token&exp=$exp";
}`,
    python: `import base64, hashlib, hmac, os, time

def dhara_embed_url(video_id: str, ttl: int = 2 * 3600) -> str:
    exp = int(time.time()) + ttl
    sig = hmac.new(os.environ["DHARA_SECRET"].encode(), f"{video_id}:{exp}".encode(), hashlib.sha256).digest()
    token = base64.urlsafe_b64encode(sig).rstrip(b"=").decode()
    return f"${player}/embed/{video_id}?token={token}&exp={exp}"`,
    api: `# Or let dhara sign it (server-to-server only):
curl -X POST ${apiOrigin}/api/v1/playback-token \\
  -H "Authorization: ApiKey ${keyId}:$DHARA_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{"video_id": "VIDEO_ID", "ttl": 7200}'

# {"success": true, "token": "…", "exp": 1767225600, "embed_url": "${player}/embed/VIDEO_ID?token=…&exp=…"}`,
  };
}

export default function Embedding() {
  const { data, isLoading } = useAccount();
  const qc = useQueryClient();
  const toast = useToast();
  const [domains, setDomains] = useState<string[]>([]);
  const [direct, setDirect] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>("node");
  const [rotateOpen, setRotateOpen] = useState(false);

  useEffect(() => {
    if (data) {
      setDomains(data.account.allowed_domains);
      setDirect(data.account.allow_direct);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => patch("/account", { allowed_domains: domains, allow_direct: direct }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account"] });
      toast("Security settings saved");
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const reveal = useMutation({ mutationFn: () => get<{ secret: string }>("/account/api-key"), onSuccess: (d) => setSecret(d.secret) });
  const rotate = useMutation({
    mutationFn: () => post<{ secret: string }>("/account/api-key/rotate"),
    onSuccess: (d) => {
      setSecret(d.secret);
      setRotateOpen(false);
      toast("Secret rotated. Every private link signed with the old one stops working.");
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });

  if (isLoading || !data) return <LoadingBlock />;
  const dirty = JSON.stringify(domains) !== JSON.stringify(data.account.allowed_domains) || direct !== data.account.allow_direct;
  const code = snippets(data.player_origin, data.api_origin, data.account.api_key_id);

  return (
    <>
      <PageHeader title="Embed & security" description="Decide where your videos may play, and sign links for private videos." />
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Allowed domains"
            description="The player only loads inside pages on these sites. Subdomains need their own entry, or use a wildcard like *.school.com."
            action={<Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>Save</Button>}
          />
          <div className="px-6 pb-2">
            <DomainsEditor value={domains} onChange={setDomains} />
            {!domains.length && <p className="mt-3 text-[12.5px] text-warn">No domains yet: your videos only play in this dashboard.</p>}
          </div>
          <div className="px-6 pb-3">
            <SettingRow
              title="Allow direct links"
              description="Let the player open without a referring page (typed-in links, some mobile apps). Leave off unless you need it; with it on, a copied public link keeps working."
              control={<Toggle checked={direct} onChange={setDirect} label="Allow direct links" />}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Playback API key"
            description="Private videos need a signed token. Your server makes it with this secret, so a copied link expires on its own."
            action={<Button variant="secondary" icon={<RefreshCw className="size-3.5" />} onClick={() => setRotateOpen(true)}>Rotate secret</Button>}
          />
          <div className="px-6 pb-6 grid gap-4 sm:grid-cols-2">
            <CopyField label="Key ID" value={data.account.api_key_id} />
            {secret ? (
              <CopyField label="Secret" value={secret} secret />
            ) : (
              <div>
                <div className="text-[13px] font-medium mb-1.5">Secret</div>
                <Button variant="secondary" className="w-full !h-11 !rounded-xl" icon={<KeyRound className="size-4" />} loading={reveal.isPending} onClick={() => reveal.mutate()}>Reveal secret</Button>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Sign a private link" description="Run this on your server when you render a page with a private video, then put the URL in the iframe's src." />
          <div className="px-6 pb-6 space-y-4">
            <Tabs value={lang} onChange={setLang} tabs={[{ value: "node", label: "Node.js" }, { value: "php", label: "PHP" }, { value: "python", label: "Python" }, { value: "api", label: "HTTP API" }]} />
            <CodeBlock language={lang === "api" ? "shell" : lang} code={code[lang]} />
            <CodeBlock language="html" code={`<div style="position:relative;padding-top:56.25%">
  <iframe src="<?= dhara_embed_url($videoId) ?>"
    style="position:absolute;inset:0;width:100%;height:100%;border:0"
    allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen></iframe>
</div>`} />
          </div>
        </Card>

        <Card className="px-6 py-5">
          <h3 className="text-[15px] font-semibold">What protects your videos</h3>
          <ul className="mt-3 space-y-2 text-[13.5px] text-ink-2 leading-relaxed list-disc pl-5">
            <li>The player refuses to load on sites outside your allowed domains, even if someone copies the embed code.</li>
            <li>Private videos only start with a fresh token from your server, and tokens expire.</li>
            <li>Every piece of video is AES-128 encrypted. The key is handed only to the dhara player during a live session.</li>
            <li>Video files sit in your own private storage bucket; links to them expire within hours.</li>
          </ul>
        </Card>
      </div>
      <ConfirmModal
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        onConfirm={() => rotate.mutate()}
        loading={rotate.isPending}
        confirmLabel="Rotate"
        title="Rotate the secret?"
        description="Every private link signed with the current secret stops working right away. Update the secret on your server immediately after."
      />
    </>
  );
}
