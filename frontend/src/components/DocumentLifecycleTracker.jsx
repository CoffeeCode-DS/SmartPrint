import { useEffect, useState, useMemo } from 'react';

/**
 * Document Lifecycle Tracker & Zero-Trace Security Guarantee
 * Transparently displays document progression from ephemeral upload to cryptographic purge.
 *
 * Props:
 * - expiresAt: ISO date string for session TTL countdown
 * - currentStage: 'idle' | 'ingested' | 'spooled' | 'verified' | 'shredded' (optional)
 * - files: Array of files from upload session (used to derive currentStage if not passed explicitly)
 */
export default function DocumentLifecycleTracker({
  expiresAt,
  currentStage,
  files = [],
}) {
  const [timeLeft, setTimeLeft] = useState({ minutes: 15, seconds: 0 });

  useEffect(() => {
    if (!expiresAt) return;

    function calculate() {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setTimeLeft({ minutes: m, seconds: s });
    }

    calculate();
    const interval = setInterval(calculate, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const pad = (n) => String(n).padStart(2, '0');

  // Derive stage index (0 = idle, 1 = ingested, 2 = spooled, 3 = verified, 4 = shredded)
  const activeStageIndex = useMemo(() => {
    if (currentStage) {
      const map = { idle: 0, ingested: 1, spooled: 2, verified: 3, shredded: 4 };
      return map[currentStage] ?? 0;
    }

    if (!files || files.length === 0) return 0;

    const hasShredded = files.some(
      (f) => f.status === 'DELETED' || f.status === 'WITHDRAWN' || f.latestJobStatus === 'COMPLETED'
    );
    const hasAwaitingVerification = files.some((f) =>
      ['AWAITING_VERIFICATION', 'SPOOLER_COMPLETED'].includes(f.latestJobStatus)
    );
    const hasPrinting = files.some((f) =>
      ['PRINTING', 'PROCESSING'].includes(f.latestJobStatus)
    );

    if (hasShredded && files.every((f) =>
      ['DELETED', 'WITHDRAWN'].includes(f.status) || f.latestJobStatus === 'COMPLETED'
    )) {
      return 4;
    }
    if (hasAwaitingVerification) return 3;
    if (hasPrinting) return 2;
    return 1;
  }, [currentStage, files]);

  const stages = [
    { num: 1, icon: '📥', step: '1. Ingest', desc: 'Encrypted buffer', activeText: 'RAM Buffer Active' },
    { num: 2, icon: '🖨️', step: '2. Spool', desc: 'To printer tray', activeText: 'Spooling to Printer' },
    { num: 3, icon: '👁️', step: '3. Verify', desc: 'Hardware check', activeText: 'Physical Check' },
    { num: 4, icon: '🔥', step: '4. Shred', desc: 'Zero-Trace wipe', activeText: 'Cryptographic Wipe' },
  ];

  return (
    <div className="mt-5 p-4 rounded-2xl bg-slate-950/70 border border-slate-800 text-left">
      {/* Header & Auto-Purge Countdown */}
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              activeStageIndex > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
            }`}
          />
          <h4 className="text-xs font-bold uppercase tracking-wider text-white font-mono">
            Zero-Trace Document Lifecycle
          </h4>
          {activeStageIndex === 0 && (
            <span className="text-[10px] text-slate-500 font-mono">(Awaiting Upload)</span>
          )}
        </div>

        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 font-mono text-xs font-bold shadow-xs">
          <span>⏳ Auto-Purge in:</span>
          <span className="text-white">
            {pad(timeLeft.minutes)}:{pad(timeLeft.seconds)}
          </span>
        </div>
      </div>

      {/* Visual 4-Stage Lifecycle Pipeline */}
      <div className="grid grid-cols-4 gap-1.5 my-3.5 text-center">
        {stages.map((item) => {
          const isCompleted = activeStageIndex > item.num;
          const isActive = activeStageIndex === item.num;

          let cardStyle = 'bg-slate-900/40 border-slate-800/50 opacity-40';
          let textColor = 'text-slate-500';
          let iconContent = item.icon;

          if (isCompleted) {
            cardStyle = 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200';
            textColor = 'text-emerald-300';
            iconContent = '✅';
          } else if (isActive) {
            cardStyle =
              'bg-indigo-950/80 border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.35)] ring-1 ring-indigo-400/60';
            textColor = 'text-white font-extrabold';
          }

          return (
            <div
              key={item.num}
              className={`p-2 rounded-xl border flex flex-col items-center justify-center text-[10px] transition-all duration-300 relative ${cardStyle}`}
            >
              {isActive && (
                <span className="absolute -top-2 px-1.5 py-0.2 rounded-full bg-indigo-500 text-[8px] font-mono text-white font-bold uppercase tracking-wider animate-pulse">
                  Live
                </span>
              )}
              <span className={`text-base mb-0.5 ${isActive ? 'scale-110 transform transition-transform' : ''}`}>
                {iconContent}
              </span>
              <span className={`leading-tight ${textColor}`}>{item.step}</span>
              <span className="text-[9px] mt-0.5 hidden sm:block opacity-80">
                {isActive ? item.activeText : item.desc}
              </span>
            </div>
          );
        })}
      </div>

      {/* Explicit Security Deletion Policy */}
      <div className="mt-3 p-2.5 rounded-xl bg-slate-900/60 border border-slate-800/60 text-[11px] text-slate-300 space-y-1">
        <div className="flex items-start gap-1.5">
          <span className="text-emerald-400 font-bold shrink-0">✓</span>
          <span>
            <strong className="text-white">Hardware Confirmation:</strong> Document is immediately shredded from station disk the moment printing finishes.
          </span>
        </div>
        <div className="flex items-start gap-1.5">
          <span className="text-emerald-400 font-bold shrink-0">✓</span>
          <span>
            <strong className="text-white">Customer Control:</strong> Click "Withdraw" or "End Session" to instantly purge all uploaded files on demand.
          </span>
        </div>
        <div className="flex items-start gap-1.5">
          <span className="text-emerald-400 font-bold shrink-0">✓</span>
          <span>
            <strong className="text-white">15-Min Strict TTL:</strong> Unprinted files are automatically erased by the zero-trace memory sweep after 15 minutes.
          </span>
        </div>
      </div>
    </div>
  );
}
