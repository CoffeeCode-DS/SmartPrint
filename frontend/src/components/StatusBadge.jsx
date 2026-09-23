const STYLES = {
  ACTIVE: { bg: 'bg-sage-dim', text: 'text-sage', dot: 'bg-sage' },
  COMPLETED: { bg: 'bg-sage-dim', text: 'text-sage', dot: 'bg-sage' },
  USED: { bg: 'bg-ink/[0.06]', text: 'text-ink/60', dot: 'bg-ink/40' },
  EXPIRED: { bg: 'bg-ink/[0.06]', text: 'text-ink/60', dot: 'bg-ink/40' },
  CANCELLED: { bg: 'bg-ink/[0.06]', text: 'text-ink/60', dot: 'bg-ink/40' },
  WITHDRAWN: { bg: 'bg-ink/[0.06]', text: 'text-ink/50', dot: 'bg-ink/30' },
  PENDING: { bg: 'bg-amber-dim', text: 'text-amber', dot: 'bg-amber' },
  PROCESSING: { bg: 'bg-amber-dim', text: 'text-amber', dot: 'bg-amber animate-pulse' },
  RETRYING: { bg: 'bg-amber-dim', text: 'text-amber', dot: 'bg-amber animate-pulse' },
  PRINTING: { bg: 'bg-amber-dim', text: 'text-amber', dot: 'bg-amber animate-pulse' },
  SPOOLER_COMPLETED: { bg: 'bg-blue-50 text-blue-700', text: 'text-blue-700', dot: 'bg-blue-500 animate-pulse' },
  AWAITING_VERIFICATION: { bg: 'bg-indigo-50 border border-indigo-200 text-indigo-700', text: 'text-indigo-700', dot: 'bg-indigo-600 animate-pulse' },
  DELETION_PENDING: { bg: 'bg-amber-dim', text: 'text-amber', dot: 'bg-amber' },
  MAINTENANCE: { bg: 'bg-amber-50 text-amber-800 border border-amber-200', text: 'text-amber-800', dot: 'bg-amber-600' },
  OFFLINE: { bg: 'bg-ink/[0.08]', text: 'text-ink/50', dot: 'bg-ink/30' },
  FAILED: { bg: 'bg-seal-dim', text: 'text-seal', dot: 'bg-seal' },
};

const DEFAULT = { bg: 'bg-ink/[0.06]', text: 'text-ink/60', dot: 'bg-ink/40' };

export default function StatusBadge({ status }) {
  const style = STYLES[status] || DEFAULT;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium tracking-wide uppercase ${style.bg} ${style.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
      {status}
    </span>
  );
}
