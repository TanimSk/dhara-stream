import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderClosed, Globe2, Lock, Pencil, Plus, Trash2 } from "lucide-react";

import { Badge, Button, Card, ConfirmModal, EmptyState, Field, Input, LoadingBlock, Modal, PageHeader, Tabs, Textarea, useToast } from "../../components/ui";
import { useCategories } from "../../hooks/queries";
import { del, patch, post } from "../../lib/api";
import type { Category, Visibility } from "../../lib/types";

function CategoryModal({ open, onClose, category }: { open: boolean; onClose: () => void; category: Category | null }) {
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [visibility, setVisibility] = useState<Visibility>(category?.visibility ?? "public");
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => (category ? patch(`/categories/${category.id}`, { name, description, visibility }) : post("/categories", { name, description, visibility })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
      toast(category ? "Category saved" : "Category created");
      onClose();
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={category ? "Edit category" : "New category"}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>Save</Button></>}
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
        <Field label="Name"><Input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Physics, Members only" /></Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Visibility" hint="A private category makes every video in it private, whatever the video's own setting.">
          <Tabs value={visibility} onChange={setVisibility} tabs={[{ value: "public", label: "Public" }, { value: "private", label: "Private" }]} />
        </Field>
      </form>
    </Modal>
  );
}

export default function Categories() {
  const { data, isLoading } = useCategories();
  const [editing, setEditing] = useState<Category | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (c: Category) => del(`/categories/${c.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["videos"] });
      toast("Category deleted");
      setDeleting(null);
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });

  return (
    <>
      <PageHeader title="Categories" description="Group videos by course, series or audience. Make a whole category private in one switch." actions={<Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>New category</Button>} />
      {isLoading ? (
        <LoadingBlock />
      ) : !data?.length ? (
        <Card><EmptyState icon={<FolderClosed className="size-6" />} title="No categories yet" description="Create one, then file videos into it when you upload." action={<Button icon={<Plus className="size-4" />} onClick={() => setEditing(null)}>New category</Button>} /></Card>
      ) : (
        <Card className="divide-y divide-line">
          {data.map((c) => (
            <div key={c.id} className="flex items-center gap-4 px-6 py-4">
              <div className="size-10 rounded-xl bg-sunken border border-line flex items-center justify-center text-ink-3"><FolderClosed className="size-[18px]" strokeWidth={1.7} /></div>
              <div className="min-w-0 flex-1">
                <Link to={`/app?category=${c.id}`} className="text-[14.5px] font-medium hover:underline">{c.name}</Link>
                <div className="text-[12.5px] text-ink-3 truncate">{c.description || `${c.video_count} video${c.video_count === 1 ? "" : "s"}`}</div>
              </div>
              {c.visibility === "private" ? <Badge tone="clay"><Lock className="size-3" />Private</Badge> : <Badge><Globe2 className="size-3" />Public</Badge>}
              <span className="hidden sm:block w-20 text-right text-[13px] text-ink-3 tabular">{c.video_count} videos</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => setEditing(c)}><Pencil className="size-3.5" /></Button>
                <Button variant="ghost" size="sm" aria-label="Delete" onClick={() => setDeleting(c)}><Trash2 className="size-3.5" /></Button>
              </div>
            </div>
          ))}
        </Card>
      )}
      {editing !== undefined && <CategoryModal open onClose={() => setEditing(undefined)} category={editing} />}
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        loading={remove.isPending}
        title={`Delete "${deleting?.name}"?`}
        description="Its videos aren't deleted. They become uncategorized and keep their own visibility."
      />
    </>
  );
}
