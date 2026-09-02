'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { signIn, getSession } from 'next-auth/react';
import { Icon } from '@/components/Icon';

function homeForSurface(surface?: string, roleKey?: string) {
  // Parents use their own app; staff share the admin shell. Teachers land on
  // their attendance screen (their main daily action); others on the dashboard.
  if (roleKey === 'kiosk') return '/admin/kiosk';
  if (surface === 'PARENT') return '/parent';
  if (surface === 'TEACHER') return '/admin/my-attendance';
  return '/admin/dashboard';
}

type OtpAccount = { email: string; displayName: string; roleName: string; surface?: string };
type Mode = 'password' | 'otp';
type OtpStep = 'phone' | 'wa' | 'setpin' | 'role';

async function api(path: string, body: object): Promise<any> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || 'Something went wrong.');
  return json;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPw, setShowPw] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [logoSrc, setLogoSrc] = React.useState('/uploads/Logofinal.png');
  const [logoOk, setLogoOk] = React.useState(true);
  const [schoolName, setSchoolName] = React.useState('Jnana Deepika');
  const [checking, setChecking] = React.useState(true);

  // OTP first-login / forgot-PIN flow
  const [mode, setMode] = React.useState<Mode>('password');
  const [otpStep, setOtpStep] = React.useState<OtpStep>('phone');
  const [otpPhone, setOtpPhone] = React.useState('');
  const [otpCode, setOtpCode] = React.useState('');
  const [newPin, setNewPin] = React.useState('');
  const [newPin2, setNewPin2] = React.useState('');
  const [grantToken, setGrantToken] = React.useState('');
  const [accounts, setAccounts] = React.useState<OtpAccount[]>([]);
  // Reverse WhatsApp verification (user sends us a code)
  const [waId, setWaId] = React.useState('');
  const [waCode, setWaCode] = React.useState('');
  const [waLink, setWaLink] = React.useState('');
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for the inbound code while on the WhatsApp step.
  React.useEffect(() => {
    if (otpStep !== 'wa' || !waId) return;
    const tick = async () => {
      try {
        const r = await fetch(`/api/auth/wa-verify/confirm?id=${encodeURIComponent(waId)}`);
        const d = await r.json();
        if (d.grantToken) {
          if (pollRef.current) clearInterval(pollRef.current);
          setGrantToken(d.grantToken); setOtpStep('setpin');
        } else if (d.verified) {
          if (pollRef.current) clearInterval(pollRef.current);
          setError('We got your message, but this number isn’t registered. Use your PIN or contact the office.');
        }
      } catch {}
    };
    pollRef.current = setInterval(tick, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [otpStep, waId]);

  // Already signed in? Skip the login form and go straight to the home page.
  React.useEffect(() => {
    getSession()
      .then((session) => {
        if (session?.user) router.replace(homeForSurface((session.user as any)?.surface as string | undefined, (session.user as any)?.roleKey as string | undefined));
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [router]);

  // Public branding (school name + uploaded logo) for the login screen.
  React.useEffect(() => {
    fetch('/api/branding')
      .then((r) => r.json())
      .then((b) => {
        if (b?.schoolName) setSchoolName(b.schoolName);
        if (b?.logoUrl) { setLogoSrc(b.logoUrl); setLogoOk(true); }
      })
      .catch(() => {});
  }, []);

  const finishSignIn = async (loginEmail: string, pin: string, surface?: string) => {
    const result = await signIn('credentials', { email: loginEmail, password: pin, redirect: false });
    if (result?.error) { setError(result.error); return; }
    if (result?.ok) {
      const session = await getSession();
      const s = ((session?.user as any)?.surface as string | undefined) ?? surface;
      const rk = (session?.user as any)?.roleKey as string | undefined;
      router.push(homeForSurface(s, rk));
      router.refresh();
    }
  };

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
        const roleKey = (session?.user as any)?.roleKey as string | undefined;
        router.push(homeForSurface(surface, roleKey));
        router.refresh();
      }
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const startOtp = () => {
    setError('');
    setMode('otp');
    setOtpStep('phone');
    // Prefill the phone if they already typed a number in the email/phone field.
    setOtpPhone(/^\+?\d[\d\s-]{6,}$/.test(email.trim()) ? email.trim() : '');
    setOtpCode(''); setNewPin(''); setNewPin2(''); setGrantToken(''); setAccounts([]);
    setWaId(''); setWaCode(''); setWaLink('');
  };
  const backToPassword = () => { setError(''); setMode('password'); };

  const submitPhone = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const { id, code, waLink } = await api('/api/auth/wa-verify/start', { phone: otpPhone });
      setWaId(id); setWaCode(code); setWaLink(waLink);
      setOtpStep('wa');
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  const submitNewPin = async (e: React.FormEvent) => {
    e.preventDefault(); setError('');
    if (newPin !== newPin2) { setError("PINs don't match."); return; }
    setLoading(true);
    try {
      const { accounts } = await api('/api/auth/set-pin', { phone: otpPhone, grantToken, pin: newPin });
      const list: OtpAccount[] = accounts || [];
      if (list.length <= 1) {
        const acc = list[0];
        // Single account → sign straight in with the just-set PIN.
        await finishSignIn(acc?.email ?? otpPhone, newPin, acc?.surface);
      } else {
        setAccounts(list);
        setOtpStep('role');
      }
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  const pickRole = async (acc: OtpAccount) => {
    setLoading(true); setError('');
    try { await finishSignIn(acc.email, newPin, acc.surface); }
    catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  if (checking) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gradient-to-br from-purple-50 via-white to-purple-100/60">
        <Icon name="Loader2" size={28} className="animate-spin text-purple-500" />
      </div>
    );
  }

  const inputCls = 'w-full h-12 pl-10 pr-3 rounded-xl border border-slate-300 bg-white text-[15px] outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 disabled:opacity-60';
  const primaryBtn = 'w-full h-12 rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 text-white font-semibold text-[15px] shadow-md shadow-purple-600/20 hover:from-purple-700 hover:to-purple-800 active:scale-[0.99] transition disabled:opacity-60 flex items-center justify-center gap-2';

  const errorBox = error ? (
    <div className="bg-danger-50 border border-danger-100 rounded-xl p-3 flex items-start gap-2">
      <Icon name="AlertCircle" size={16} className="text-danger-600 mt-0.5 flex-shrink-0" />
      <p className="text-sm text-danger-700">{error}</p>
    </div>
  ) : null;

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
              <img src={logoSrc} alt={schoolName} className="w-full h-full object-contain" onError={() => { if (logoSrc !== '/logo.svg') setLogoSrc('/logo.svg'); else setLogoOk(false); }} />
            ) : (
              <div className="w-full h-full rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
                <Icon name="Flame" size={42} className="text-amber-300" />
              </div>
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-4">{schoolName}</h1>
          <p className="text-sm text-slate-500 mt-1">School ERP · staff &amp; parents</p>
        </div>

        {/* Card */}
        <div className="bg-white/90 backdrop-blur rounded-3xl shadow-xl border border-white/60 p-6 sm:p-7">
          {mode === 'password' ? (
            <>
              <h2 className="text-lg font-semibold text-slate-900">Welcome back</h2>
              <p className="text-sm text-slate-500 mb-5">Sign in to continue</p>

              <form onSubmit={handleLogin} className="space-y-4">
                {errorBox}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Email or phone</label>
                  <div className="relative">
                    <Icon name="User" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" inputMode="text" autoComplete="username" placeholder="Email or phone number"
                      value={email} onChange={(e) => setEmail(e.target.value)} required disabled={loading} className={inputCls} />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">PIN / Password</label>
                  <div className="relative">
                    <Icon name="Lock" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type={showPw ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••"
                      value={password} onChange={(e) => setPassword(e.target.value)} required disabled={loading}
                      className="w-full h-12 pl-10 pr-11 rounded-xl border border-slate-300 bg-white text-[15px] outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 disabled:opacity-60" />
                    <button type="button" onClick={() => setShowPw((s) => !s)} tabIndex={-1}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-600" aria-label={showPw ? 'Hide password' : 'Show password'}>
                      <Icon name={showPw ? 'EyeOff' : 'Eye'} size={18} />
                    </button>
                  </div>
                </div>

                <button type="submit" disabled={loading} className={primaryBtn}>
                  {loading ? <><Icon name="Loader2" size={18} className="animate-spin" /> Signing in…</> : <>Sign in <Icon name="ArrowRight" size={18} /></>}
                </button>
              </form>

              <button type="button" onClick={startOtp}
                className="mt-4 w-full flex items-center justify-center gap-2 text-sm font-medium text-purple-700 hover:text-purple-800">
                <Icon name="MessageCircle" size={16} /> First time here or forgot PIN? Verify by WhatsApp
              </button>
            </>
          ) : (
            <>
              {/* Back to password login */}
              <button type="button" onClick={backToPassword}
                className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
                <Icon name="ArrowLeft" size={16} /> Back to sign in
              </button>

              {otpStep === 'phone' && (
                <form onSubmit={submitPhone} className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Verify your number</h2>
                    <p className="text-sm text-slate-500 mb-1">Enter your registered phone — you'll send us a quick WhatsApp message to verify it's you.</p>
                  </div>
                  {errorBox}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Phone number</label>
                    <div className="relative">
                      <Icon name="Phone" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="tel" inputMode="tel" autoComplete="tel" placeholder="Registered phone number"
                        value={otpPhone} onChange={(e) => setOtpPhone(e.target.value)} required disabled={loading} className={inputCls} />
                    </div>
                  </div>
                  <button type="submit" disabled={loading} className={primaryBtn}>
                    {loading ? <><Icon name="Loader2" size={18} className="animate-spin" /> Starting…</> : <>Verify on WhatsApp <Icon name="ArrowRight" size={18} /></>}
                  </button>
                </form>
              )}

              {otpStep === 'wa' && (
                <div className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Verify on WhatsApp</h2>
                    <p className="text-sm text-slate-500">Tap the button below — it opens WhatsApp with a message already typed. Just press <b>send</b> from <b>{otpPhone}</b>, then come back here.</p>
                  </div>
                  {errorBox}
                  <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-center">
                    <div className="text-xs text-slate-500">Your one-time code</div>
                    <div className="text-2xl font-bold tracking-[0.25em] text-slate-900 mt-0.5">{waCode}</div>
                  </div>
                  <a href={waLink} target="_blank" rel="noopener noreferrer" className={primaryBtn + ' !bg-[#25D366] hover:!bg-[#1da851]'}>
                    <Icon name="MessageCircle" size={18} /> Open WhatsApp &amp; send
                  </a>
                  <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                    <Icon name="Loader2" size={16} className="animate-spin" /> Waiting for your message…
                  </div>
                  <button type="button" onClick={backToPassword} disabled={loading}
                    className="w-full text-sm text-purple-700 hover:text-purple-800">Use my PIN instead</button>
                </div>
              )}

              {otpStep === 'setpin' && (
                <form onSubmit={submitNewPin} className="space-y-4">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Set your PIN</h2>
                    <p className="text-sm text-slate-500 mb-1">Choose a 4–6 digit PIN you'll use to sign in.</p>
                  </div>
                  {errorBox}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">New PIN</label>
                    <div className="relative">
                      <Icon name="KeyRound" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="password" inputMode="numeric" maxLength={6} placeholder="4–6 digits"
                        value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} required disabled={loading} className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Confirm PIN</label>
                    <div className="relative">
                      <Icon name="KeyRound" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="password" inputMode="numeric" maxLength={6} placeholder="Re-enter PIN"
                        value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, ''))} required disabled={loading} className={inputCls} />
                    </div>
                  </div>
                  <button type="submit" disabled={loading || newPin.length < 4} className={primaryBtn}>
                    {loading ? <><Icon name="Loader2" size={18} className="animate-spin" /> Saving…</> : <>Save PIN &amp; sign in <Icon name="ArrowRight" size={18} /></>}
                  </button>
                </form>
              )}

              {otpStep === 'role' && (
                <div className="space-y-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">Choose your role</h2>
                    <p className="text-sm text-slate-500 mb-1">Your number is linked to more than one account.</p>
                  </div>
                  {errorBox}
                  {accounts.map((acc) => (
                    <button key={acc.email} type="button" onClick={() => pickRole(acc)} disabled={loading}
                      className="w-full flex items-center justify-between gap-3 rounded-xl border border-slate-300 bg-white p-4 text-left hover:border-purple-400 hover:bg-purple-50/40 transition disabled:opacity-60">
                      <span>
                        <span className="block font-semibold text-slate-900">{acc.displayName}</span>
                        <span className="block text-sm text-slate-500">{acc.roleName}</span>
                      </span>
                      <Icon name="ChevronRight" size={18} className="text-slate-400" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-6">© {new Date().getFullYear()} Jnana Deepika School</p>
      </div>
    </div>
  );
}
