import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button, Card, CardHeader, Field, Input, PageHeader, useToast } from "../components/ui";
import { post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { desktop } from "../lib/desktop";

export default function Settings() {
  const { user } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const change = useMutation({
    mutationFn: () => post("/auth/password", { current_password: current, new_password: next }),
    onSuccess: () => {
      toast("Password changed");
      setCurrent("");
      setNext("");
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6 max-w-2xl">
        <Card className="px-6 py-5 space-y-1 text-[14px]">
          <div><span className="text-ink-3">Signed in as</span> {user?.email}</div>
          {user?.client && <div><span className="text-ink-3">Account</span> {user.client.name}</div>}
          {desktop && <div className="text-ink-3 text-[12.5px] pt-2">dhara desktop {desktop.version} · {desktop.platform}</div>}
        </Card>
        <Card>
          <CardHeader title="Change password" />
          <form className="px-6 pb-6 space-y-4" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
            <Field label="New password" hint="At least 8 characters."><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
            <div className="flex justify-end"><Button type="submit" disabled={!current || next.length < 8} loading={change.isPending}>Change password</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
