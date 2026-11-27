import type { Bucket } from "../lib/types";
import { Badge } from "./ui";

export default function BucketStatus({ bucket }: { bucket: Bucket | null }) {
  if (!bucket) return <Badge tone="warn" dot>No bucket</Badge>;
  if (bucket.status === "ready") return <Badge tone="ok" dot>Ready</Badge>;
  if (bucket.status === "failed") return <Badge tone="bad" dot>Failed</Badge>;
  return <Badge tone="warn" dot>Provisioning</Badge>;
}
