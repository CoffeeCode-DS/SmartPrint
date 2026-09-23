import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import SmartPrintLogo from '../components/SmartPrintLogo';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from || '/dashboard';

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 app-gradient-canvas text-slate-100">
      {/* Left: brand panel */}
      <div className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden border-r border-slate-800/60">
        <div className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-rose-500/10 blur-3xl pointer-events-none" />
        <div className="absolute -left-32 bottom-0 w-96 h-96 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

        <Link to="/" className="relative group inline-block">
          <SmartPrintLogo size="md" showText={true} />
        </Link>

        <div className="relative max-w-sm space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-mono font-medium">
            <span>🛡️ Enterprise Zero-Trace Security</span>
          </div>
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-white">
            Every session, every job, every file — accounted for.
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            Staff access to the live print queue, connected printer fleet, analytics telemetry, and
            cryptographic audit trails behind every document that touches this station.
          </p>
        </div>

        <div className="relative font-mono text-xs text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Station Spooler Engine Online</span>
        </div>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center p-6 relative">
        <div className="max-w-md w-full p-8 rounded-3xl bg-slate-900/90 backdrop-blur-2xl border border-slate-700/80 shadow-[0_20px_60px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.1)]">
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <SmartPrintLogo size="md" showText={true} />
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight text-white">Staff Sign In</h1>
          <p className="text-xs text-slate-300 mt-1.5 font-medium">
            Operator or administrator access to the print station console.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 font-mono">Username</label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 font-mono">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <p className="text-xs text-rose-300 bg-rose-950/80 border border-rose-500/40 rounded-xl px-3.5 py-2.5 font-semibold">⚠️ {error}</p>
            )}

            <Button type="submit" variant="seal" disabled={submitting} className="w-full" size="lg">
              {submitting ? 'Signing in…' : 'Sign in to Console'}
            </Button>

            {import.meta.env.DEV && (
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={async () => {
                  setUsername('admin');
                  setPassword('changeme123');
                  setSubmitting(true);
                  setError(null);
                  try {
                    await login('admin', 'changeme123');
                    navigate(from, { replace: true });
                  } catch (err) {
                    setError(err.message);
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="w-full text-xs font-mono border-dashed border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
              >
                ⚡ [DEV ONLY] 1-Click Sign In (admin / changeme123)
              </Button>
            )}
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800 text-center space-y-3">
            <p className="text-xs text-slate-400">
              Don't have an operator account?{' '}
              <Link to="/signup" className="text-rose-400 font-semibold hover:underline ml-1">
                Sign Up Here →
              </Link>
            </p>

            <Link
              to="/"
              className="inline-flex items-center text-xs text-slate-500 hover:text-white transition-colors"
            >
              ← Return to Home / Print Station
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
