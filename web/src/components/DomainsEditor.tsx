import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button, Input } from "./ui";

/** Chip editor for allowed domains ("school.com", "*.school.com"). */
export default function DomainsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const addDraft = () => {
    const parts = draft.split(/[\s,]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean);
    if (parts.length) onChange([...new Set([...value, ...parts])]);
    setDraft("");
  };
  return (
    <div>
      <div className="flex gap-2">
        <Input
          placeholder="school.com or *.school.com"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addDraft();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={addDraft} icon={<Plus className="size-4" />}>Add</Button>
      </div>
      {value.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {value.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full bg-sunken border border-line text-[13px] font-mono">
              {d}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== d))} className="size-5 rounded-full flex items-center justify-center text-ink-3 hover:bg-line hover:text-ink" aria-label={`Remove ${d}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
