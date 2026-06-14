'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { signIn, getSession } from 'next-auth/react';
import { Icon } from '@/components/Icon';

function homeForSurface(surface?: string) {
  // Parents use their own app; all staff (admin/teacher/accountant/custom) share the admin shell.
  return surface === 'PARENT' ? '/parent' : '/admin/dashboard';
}

const DEMO = [
  { label: 'Admin', email: 'admin@jnanadeepika.edu', password: 'Admin@123' },
  { label: 'Teacher', email: 'teacher@jnanadeepika.edu', password: 'Teacher@123' },
  { label: 'Accountant', email: 'accountant@jnanadeepika.edu', password: 'Account@123' },
  { label: 'Parent', email: 'parent@jnanadeepika.edu', password: 'Parent@123' },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPw, setShowPw] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [logoSrc, setLogoSrc] = React.useState('/uploads/Logofinal.png');
  const [logoOk, setLogoOk] = React.useState(true);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) setError(result.error);
      else if (result?.ok) {
        const session = await getSession();
        const surface = (session?.user as any)?.surface as string | undefined;
        router.push(homeForSurface(surface));
        router.refresh();
      }
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden bg-gradient-to-br from-purple-50 via-white to-purple-100/60 px-4 py-8">
      {/* decorative brand blobs */}
      <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-purple-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-28 -left-24 w-80 h-80 rounded-full bg-purple-400/20 blur-3xl" />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-24 h-24 rounded-full bg-white shadow-lg ring-4 ring-white flex items-center justify-center overflow-hidden">
            {logoOk ? (
              // Drop your logo at /public/logo.png to show it here.
              <img src={logoSrc} alt="Jnana Deepika" className="w-full h-full object-contain" onError={() => { if (logoSrc !== '/logo.svg') setLogoSrc('/logo.svg'); else setLogoOk(false); }} />
            ) : (
              <div className="w-full h-full rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
                <Icon name="Flame" size={42} className="text-amber-300" />
              </div>
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-4">Jnana Deepika</h1>
          <p className="text-sm text-slate-500 mt-1">School ERP · staff &amp; parents</p>
        </div>

        {/* Card */}
        <div className="bg-white/90 backdrop-blur rounded-3xl shadow-xl border border-white/60 p-6 sm:p-7">
          <h2 className="text-lg font-semibold text-slate-900">Welcome back</h2>
          <p className="text-sm text-slate-500 mb-5">Sign in to continue</p>

          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div className="bg-danger-50 border border-danger-100 rounded-xl p-3 flex items-start gap-2">
                <Icon name="AlertCircle" size={16} className="text-danger-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-danger-700">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email or phone</label>
              <div className="relative">
                <Icon name="User" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  inputMode="text"
                  autoComplete="username"
                  placeholder="Email or phone number"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="w-full h-12 pl-10 pr-3 rounded-xl border border-slate-300 bg-white text-[15px] outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 disabled:opacity-60"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
              <div className="relative">
                <Icon name="Lock" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="w-full h-12 pl-10 pr-11 rounded-xl border border-slate-300 bg-white text-[15px] outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 disabled:opacity-60"
                />
                <button type="button" onClick={() => setShowPw((s) => !s)} tabIndex={-1}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600" aria-label={showPw ? 'Hide password' : 'Show password'}>
                  <Icon name={showPw ? 'EyeOff' : 'Eye'} size={18} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold text-[15px] shadow-md shadow-purple-600/20 hover:from-purple-700 hover:to-purple-800 active:scale-[0.99] transition disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? <><Icon name="Loader2" size={18} className="animate-spin" /> Signing in…</> : <>Sign in <Icon name="ArrowRight" size={18} /></>}
            </button>
          </form>

          {/* Demo logins — collapsible, for testing */}
          <details className="mt-5 group">
            <summary className="cursor-pointer list-none text-xs font-medium text-slate-400 hover:text-slate-600 flex items-center justify-center gap-1 select-none">
              <Icon name="ChevronDown" size={13} className="transition-transform group-open:rotate-180" /> Demo logins
            </summary>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {DEMO.map((d) => (
                <button key={d.label} type="button" onClick={() => { setEmail(d.email); setPassword(d.password); }}
                  className="text-left p-2.5 rounded-xl border border-slate-200 hover:border-purple-300 hover:bg-purple-50/50 transition">
                  <div className="text-[13px] font-medium text-slate-700">{d.label}</div>
                  <div className="text-[10px] text-slate-400 truncate">{d.email}</div>
                </button>
              ))}
            </div>
          </details>
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-6">© {new Date().getFullYear()} Jnana Deepika School</p>
      </div>
    </div>
  );
}
