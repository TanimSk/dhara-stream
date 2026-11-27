import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ShieldCheck } from "lucide-react";

import { homeFor } from "../App";
import { useDarkTheme } from "../components/landing/motion";
import { Button, Field, Input, Logo } from "../components/ui";
import { useAuth } from "../lib/auth";
import { isDesktop } from "../lib/desktop";

export default function Login() {
  useDarkTheme();
  const { user, ready, signIn } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || !user) return;
    const next = params.get("next");
    const home = homeFor(user.role);
    navigate(next && next.startsWith(home) ? next : home, { replace: true });
  }, [ready, user, params, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(email, password);
    } catch (err: any) {
      setError(err.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="px-6 h-16 flex items-center" style={isDesktop ? ({ WebkitAppRegion: "drag", paddingLeft: 88 } as any) : undefined}>
        {isDesktop ? <Logo /> : <Link to="/"><Logo /></Link>}
      </header>
      <main className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[400px] animate-fade-up">
          <div className="text-center mb-10">
            <h1 className="text-[40px] sm:text-[48px] leading-[1.02] font-semibold tracking-[-0.045em]">Welcome back.</h1>
            <p className="mt-3 text-[15px] text-ink-3">Sign in with the account your dhara admin created for you.</p>
          </div>
          <form onSubmit={submit} className="bg-surface border border-line rounded-3xl shadow-card p-7 space-y-4">
            <Field label="Email">
              <Input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p className="text-[13px] text-bad">{error}</p>}
            <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
          </form>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-[12.5px] text-ink-3">
            <ShieldCheck className="size-3.5" /> No account? Ask your dhara administrator.
          </p>
        </div>
      </main>
    </div>
  );
}
