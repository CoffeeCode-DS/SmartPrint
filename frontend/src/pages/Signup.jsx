import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import SmartPrintLogo from '../components/SmartPrintLogo';

export default function Signup() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { signup } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await signup(username, password, inviteCode);
      navigate('/queue', { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to create account.');
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
            <span>🛡️ Operator & Staff Delegation</span>
          </div>
          <h2 className="text-3xl font-bold leading-tight tracking-tight text-white">
            Create your personal staff credentials.
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            Gain immediate operator access to the real-time print spooler, physical confirmation verification pipeline, and station hardware control.
          </p>
        </div>

        <div className="relative font-mono text-xs text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Multi-User Staff Network Ready</span>
        </div>
      </div>

      {/* Right: sign up form */}
      <div className="flex items-center justify-center p-6 relative">
        <div className="max-w-md w-full p-8 rounded-3xl bg-slate-900/90 backdrop-blur-2xl border border-slate-700/80 shadow-[0_20px_60px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.1)]">
          <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
            <SmartPrintLogo size="md" showText={true} />
          </div>

          <h1 className="text-2xl font-extrabold tracking-tight text-white">Staff Sign Up</h1>
          <p className="text-xs text-slate-300 mt-1.5 font-medium">
            Register a personal operator account for the print station console.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5 font-mono">
                Username
              </label>
              <Input
                type="text"
                placeholder="e.g. teacher_alex"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                className="text-xs bg-slate-950 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Password (min 8 chars)
              </label>
              <Input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="text-xs bg-slate-950 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Confirm Password
              </label>
              <Input
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="text-xs bg-slate-950 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                Staff Invite Code / Station Key
              </label>
              <Input
                type="password"
                placeholder="Enter operator registration key"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
                className="text-xs bg-slate-950 border-slate-700 text-white"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Required for station registration. Provided by station administrator.
              </p>
            </div>

            {error && (
              <p className="text-xs text-rose-300 bg-rose-950/60 border border-rose-800/80 rounded-xl px-3.5 py-2.5">
                ⚠️ {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-r from-rose-600 via-rose-500 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-bold py-3 rounded-xl shadow-lg mt-2"
              size="lg"
            >
              {submitting ? 'Creating account…' : 'Create Staff Account'}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800 text-center space-y-3">
            <p className="text-xs text-slate-400">
              Already have an account?{' '}
              <Link to="/login" className="text-rose-400 font-semibold hover:underline ml-1">
                Sign In →
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
