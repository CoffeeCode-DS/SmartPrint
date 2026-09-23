import { useCallback, useEffect, useState } from 'react';
import { listAuditLogs, verifyAuditChain } from '../services/analyticsApi';
import { listStaffUsers, createStaffUser } from '../services/authApi';
import StaffHeader from '../components/StaffHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

const PAGE_SIZE = 20;

function ActionBadge({ action }) {
  const map = {
    FILE_UPLOADED: { bg: 'bg-blue-950/60 text-blue-300 border-blue-500/30', icon: '📥', label: 'File Ingest' },
    SESSION_CREATED: { bg: 'bg-emerald-950/60 text-emerald-300 border-emerald-500/30', icon: '🔑', label: 'Session Init' },
    CLEANUP_SWEEP: { bg: 'bg-purple-950/60 text-purple-300 border-purple-500/30', icon: '🧹', label: 'Memory Sweep' },
    FILE_AUTO_DELETED: { bg: 'bg-rose-950/60 text-rose-300 border-rose-500/30', icon: '🔥', label: 'Zero-Trace Shred' },
    PRINT_JOB_CREATED: { bg: 'bg-amber-950/60 text-amber-300 border-amber-500/30', icon: '🖨️', label: 'Job Queued' },
    PRINT_JOB_COMPLETED: { bg: 'bg-teal-950/60 text-teal-300 border-teal-500/30', icon: '✓', label: 'Job Verified' },
  };

  const style = map[action] || { bg: 'bg-slate-800 text-slate-300 border-slate-700', icon: '📝', label: action };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-mono font-bold border ${style.bg}`}>
      <span>{style.icon}</span>
      <span>{style.label}</span>
    </span>
  );
}

function AuditLogTable() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Tamper-evident hash chain verification state
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);

  const load = useCallback(async (newOffset) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAuditLogs({ limit: PAGE_SIZE, offset: newOffset });
      setLogs(res.auditLogs);
      setTotal(res.total);
      setOffset(newOffset);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(0);
  }, [load]);

  const handleVerifyChain = async () => {
    setVerifying(true);
    try {
      const res = await verifyAuditChain();
      setVerificationResult(res);
    } catch (err) {
      setVerificationResult({ valid: false, reason: err.message });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Card className="overflow-hidden bg-slate-900/90 backdrop-blur-2xl border border-slate-700/80 shadow-[0_16px_45px_rgba(0,0,0,0.6)] text-left">
      <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">🛡️</span>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
              Tamper-Evident SHA-256 Ledger
            </h3>
          </div>
          <p className="text-xs text-slate-300 mt-0.5 font-mono">
            {total} immutable block entries · Cryptographically verified
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={handleVerifyChain}
            disabled={verifying}
            className="text-xs py-1.5 px-3.5 font-semibold text-indigo-300 bg-indigo-500/10 border-indigo-500/30 hover:bg-indigo-500/20 transition-all shadow-xs"
          >
            {verifying ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                Auditing Hashes…
              </span>
            ) : (
              '🛡️ Verify Chain Integrity'
            )}
          </Button>
        </div>
      </div>

      {verificationResult && (
        <div
          className={`px-6 py-3.5 text-xs font-mono border-b flex items-center justify-between ${
            verificationResult.valid
              ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/80 shadow-inner'
              : 'bg-rose-950/70 text-rose-300 border-rose-800/80'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="text-base font-bold">
              {verificationResult.valid ? '✓' : '✕'}
            </span>
            <span>
              {verificationResult.valid
                ? `Cryptographic Integrity Certified: All ${verificationResult.totalRecords} ledger records match zero-knowledge SHA-256 state.`
                : `Security Alert: Chain discrepancy detected at #${verificationResult.brokenAtId}: ${verificationResult.reason}`}
            </span>
          </div>
          <button
            onClick={() => setVerificationResult(null)}
            className="text-[11px] text-slate-400 hover:text-white font-semibold underline ml-3 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && <p className="text-sm font-semibold text-rose-300 bg-rose-950/60 px-6 py-4 border-b border-rose-800/80">{error}</p>}

      {loading && (
        <div className="py-14 text-center">
          <div className="w-6 h-6 mx-auto rounded-full border-2 border-slate-700 border-t-indigo-500 animate-spin" />
          <p className="text-xs text-slate-400 mt-2 font-mono">Loading cryptographic records…</p>
        </div>
      )}

      {!loading && logs.length === 0 && (
        <div className="py-12 text-center text-slate-400">
          <p className="text-sm">No audit ledger entries found.</p>
        </div>
      )}

      <div className="divide-y divide-slate-800">
        {logs.map((log) => (
          <div key={log.id} className="px-6 py-3.5 text-xs hover:bg-slate-800/50 transition-colors">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
              <ActionBadge action={log.action} />
              <span className="text-slate-400 font-mono text-[11px] bg-slate-800 px-2 py-0.5 rounded border border-slate-700/50">
                {new Date(log.createdAt).toLocaleString()}
              </span>
            </div>

            <div className="flex items-center gap-2 text-slate-300 font-mono text-[11px] mt-1.5 flex-wrap">
              <span className="text-slate-400">actor:</span>
              <span className="font-semibold text-white bg-slate-800 px-1.5 py-0.2 rounded border border-slate-700/50">{log.actor}</span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">target:</span>
              <span className="text-slate-300 font-medium">{log.entityType}</span>
              {log.entityId && (
                <span className="text-slate-400 bg-slate-800 px-1.5 py-0.2 rounded border border-slate-700/50">
                  #{log.entityId.slice(0, 10)}…
                </span>
              )}
            </div>

            {(log.logHash || log.log_hash) && (
              <div className="mt-2 text-[10px] text-slate-300 font-mono flex items-center gap-2 bg-slate-950 p-2 rounded-lg border border-slate-800 overflow-x-auto">
                <span className="text-rose-400 font-bold uppercase shrink-0">SHA-256</span>
                <span className="text-slate-200 truncate">{(log.logHash || log.log_hash).slice(0, 24)}…</span>
                <span className="text-slate-500">➔</span>
                <span className="text-slate-400 shrink-0">prev:</span>
                <span className="text-slate-400 truncate">
                  {log.prevHash || log.prev_hash ? `${(log.prevHash || log.prev_hash).slice(0, 20)}…` : 'GENESIS'}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {total > PAGE_SIZE && (
        <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between text-xs bg-slate-950/40">
          <button
            onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            className="text-slate-300 hover:text-white font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
          >
            ← Newer Entries
          </button>
          <span className="text-slate-400 font-mono">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            onClick={() => load(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            className="text-slate-300 hover:text-white font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
          >
            Older Entries →
          </button>
        </div>
      )}
    </Card>
  );
}

function StaffManagement() {
  const [users, setUsers] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('OPERATOR');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const loadUsers = useCallback(() => {
    listStaffUsers().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await createStaffUser({ username, password, role });
      setUsername('');
      setPassword('');
      setSuccess(`Account "${username}" created.`);
      setTimeout(() => setSuccess(null), 3500);
      loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6 bg-slate-900/90 backdrop-blur-xl border border-slate-800 shadow-[0_8px_30px_rgba(0,0,0,0.35)] text-left">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-800">
        <span className="text-lg">👥</span>
        <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
          Authorized Staff
        </h3>
      </div>

      <div className="space-y-2 mb-5">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-200 flex items-center justify-center text-[10px] font-bold font-mono border border-slate-700">
                {u.username.slice(0, 2).toUpperCase()}
              </span>
              <span className="text-xs font-semibold text-white">{u.username}</span>
            </div>
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider border ${
                u.role === 'ADMIN'
                  ? 'bg-purple-950/70 text-purple-300 border-purple-800/80'
                  : 'bg-blue-950/70 text-blue-300 border-blue-800/80'
              }`}
            >
              {u.role}
            </span>
          </div>
        ))}
      </div>

      <div className="pt-4 border-t border-slate-800">
        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono mb-3">
          + Add Staff Account
        </h4>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Username
            </label>
            <Input
              type="text"
              placeholder="e.g. teacher_john"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="text-xs py-2 bg-slate-950 border-slate-700 text-white placeholder-slate-500 focus:border-rose-500"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Password
            </label>
            <Input
              type="password"
              placeholder="Min 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="text-xs py-2 bg-slate-950 border-slate-700 text-white placeholder-slate-500 focus:border-rose-500"
            />
          </div>

          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
              Permission Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20"
            >
              <option value="OPERATOR">OPERATOR (Queue & Print Only)</option>
              <option value="ADMIN">ADMIN (Full Hardware & User Control)</option>
            </select>
          </div>

          {error && <p className="text-xs font-semibold text-rose-300 bg-rose-950/60 p-2.5 rounded-lg border border-rose-800">{error}</p>}
          {success && <p className="text-xs font-semibold text-emerald-300 bg-emerald-950/60 p-2.5 rounded-lg border border-emerald-800">{success}</p>}

          <Button
            type="submit"
            disabled={submitting}
            size="sm"
            className="w-full bg-gradient-to-r from-rose-600 via-rose-500 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-semibold py-2.5 rounded-xl shadow-md mt-1 border border-rose-400/20 transition-all"
          >
            {submitting ? 'Creating Account…' : 'Create Staff Account'}
          </Button>
        </form>
      </div>
    </Card>
  );
}

export default function AuditLog() {
  return (
    <div className="min-h-screen app-gradient-canvas text-slate-100 relative overflow-hidden font-sans">
      {/* Ambient decorative glow */}
      <div className="absolute top-0 right-1/4 w-96 h-96 rounded-full bg-rose-500/[0.05] blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 -left-20 w-80 h-80 rounded-full bg-indigo-500/[0.05] blur-3xl pointer-events-none" />

      <StaffHeader current="Audit & Staff" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-purple-950/60 border border-purple-700/60 text-[11px] font-semibold text-purple-300 font-mono mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            <span>Cryptographic Security Ledger</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Security Audit Trail &amp; Staff Access
          </h1>
          <p className="text-sm text-slate-300 mt-1">
            Immutable SHA-256 hash-chain audit log with operator credential delegation
          </p>
        </div>

        <div className="grid lg:grid-cols-12 gap-6 fade-up">
          <div className="lg:col-span-8">
            <AuditLogTable />
          </div>
          <div className="lg:col-span-4">
            <StaffManagement />
          </div>
        </div>
      </div>
    </div>
  );
}
