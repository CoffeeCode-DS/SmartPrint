import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getSession, endSession, createSession } from '../services/sessionApi';
import { getSessionFiles, withdrawFile } from '../services/fileApi';
import StatusBadge from '../components/StatusBadge';
import UploadForm from '../components/UploadForm';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import SmartPrintLogo from '../components/SmartPrintLogo';
import DocumentLifecycleTracker from '../components/DocumentLifecycleTracker';
import { formatBytes } from '../utils/format';
import { useSessionSocket } from '../hooks/useSessionSocket';

export default function Upload() {
  const { sessionId: paramSessionId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = paramSessionId || searchParams.get('session');

  const [phase, setPhase] = useState('loading'); // loading | valid | invalid
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [withdrawingId, setWithdrawingId] = useState(null);
  const [endingSession, setEndingSession] = useState(false);

  const { emitUploadStarted, emitUploadProgress, printJobEvent } = useSessionSocket(
    phase === 'valid' ? sessionId : null,
    'uploader'
  );

  const loadFiles = useCallback(async () => {
    try {
      const files = await getSessionFiles(sessionId);
      setUploadedFiles(files);
    } catch {
      // non-critical
    }
  }, [sessionId]);

  // Real-time: refresh files when print job status changes
  useEffect(() => {
    if (printJobEvent) loadFiles();
  }, [printJobEvent, loadFiles]);

  // Polling fallback every 8s in case socket events are missed
  useEffect(() => {
    if (phase !== 'valid') return;
    const poll = setInterval(loadFiles, 8000);
    return () => clearInterval(poll);
  }, [phase, loadFiles]);

  const handleWithdraw = async (fileId) => {
    if (!window.confirm('Withdraw this document? It will be removed immediately from the station.')) return;
    try {
      setWithdrawingId(fileId);
      await withdrawFile(sessionId, fileId);
      loadFiles();
    } catch (err) {
      alert(err.message || 'Failed to withdraw file.');
    } finally {
      setWithdrawingId(null);
    }
  };

  const handleEndSession = async () => {
    if (
      !window.confirm(
        'Are you sure you want to end your session? Any unprinted documents will be safely erased from the station.'
      )
    ) {
      return;
    }
    try {
      setEndingSession(true);
      await endSession(sessionId, 'Customer finished');
      setPhase('invalid');
      setSession((prev) => ({ ...prev, status: 'USED' }));
    } catch (err) {
      alert(err.message || 'Failed to end session.');
    } finally {
      setEndingSession(false);
    }
  };

  const handleStartNewSession = async () => {
    try {
      setPhase('loading');
      setError(null);
      const newSess = await createSession({ oneTime: false });
      navigate(`/upload/${newSess.id}`, { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to start fresh upload session');
      setPhase('invalid');
    }
  };

  useEffect(() => {
    let cancelled = false;

    if (!sessionId || sessionId === 'new') {
      (async () => {
        try {
          const s = await createSession({ oneTime: false });
          if (!cancelled) {
            navigate(`/upload/${s.id}`, { replace: true });
          }
        } catch (err) {
          if (!cancelled) {
            setError(err.message || 'Failed to initialize upload session');
            setPhase('invalid');
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const s = await getSession(sessionId);
        if (cancelled) return;
        setSession(s);
        if (s.status === 'ACTIVE') {
          setPhase('valid');
          loadFiles();
        } else {
          setPhase('invalid');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setPhase('invalid');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, loadFiles, navigate]);

  const handleFileUploaded = () => {
    loadFiles();
  };

  return (
    <div className="min-h-screen flex items-center justify-center app-gradient-canvas px-4 py-10 text-slate-100 relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="absolute top-1/4 -right-20 w-80 h-80 rounded-full bg-rose-500/15 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 -left-20 w-80 h-80 rounded-full bg-indigo-500/15 blur-[120px] pointer-events-none" />

      <Card className="max-w-md w-full p-6 sm:p-8 text-center fade-up bg-slate-900/90 backdrop-blur-2xl border border-slate-700/80 shadow-[0_20px_60px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.1)] relative z-10">
        <div className="flex justify-center mb-1">
          <SmartPrintLogo size="sm" showText={true} />
        </div>
        <p className="mt-1 text-xs text-slate-300 font-mono font-medium">Zero-Trace Mobile Document Upload</p>

        {phase === 'loading' && (
          <div className="mt-10 py-8">
            <div className="w-9 h-9 mx-auto rounded-full border-2 border-slate-700 border-t-rose-500 animate-spin" />
            <p className="mt-4 text-slate-200 text-sm font-semibold">Connecting to secure station…</p>
          </div>
        )}

        {phase === 'invalid' && (
          <div className="mt-7">
            {session && (
              <div className="flex justify-center mb-3">
                <StatusBadge status={session.status} />
              </div>
            )}
            <p className="text-rose-300 text-sm font-semibold bg-rose-950/60 border border-rose-800/80 rounded-xl px-4 py-3">
              {error ||
                (session?.status === 'EXPIRED'
                  ? '⏳ This session has reached its 15-minute limit and expired.'
                  : session?.status === 'USED'
                  ? '🔒 This session has ended and files were erased.'
                  : '⚠️ This session is not valid.')}
            </p>
            <p className="mt-3 text-xs text-slate-400">
              Please scan the active QR code shown on the station screen or tap below.
            </p>
            <div className="mt-4">
              <Button
                variant="seal"
                onClick={handleStartNewSession}
                className="w-full text-xs font-semibold py-2.5 shadow-md"
              >
                🔄 Start Fresh Upload Session
              </Button>
            </div>
          </div>
        )}

        {phase === 'valid' && (
          <div className="mt-6 text-left">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                Station Connected
              </span>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-bold bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Active
                </span>
                <button
                  type="button"
                  onClick={handleEndSession}
                  disabled={endingSession}
                  className="text-xs text-rose-400 font-semibold hover:underline ml-2"
                >
                  {endingSession ? 'Ending…' : 'End Session'}
                </button>
              </div>
            </div>

            <UploadForm
              sessionId={sessionId}
              onUploaded={handleFileUploaded}
              onUploadStarted={emitUploadStarted}
              onUploadProgress={emitUploadProgress}
            />

            {uploadedFiles.length > 0 && (
              <div className="mt-5 pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
                    Active Files ({uploadedFiles.length})
                  </p>
                  <span className="text-[11px] text-emerald-400 font-mono font-medium">RAM-buffered</span>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {uploadedFiles.map((file) => (
                    <div
                      key={file.id}
                      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-white truncate">{file.originalName}</p>
                        <p className="text-slate-400 mt-0.5 font-mono text-[11px]">
                          {formatBytes(file.sizeBytes)} · Zero-trace memory
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {file.status === 'WITHDRAWN' ? (
                          <span className="text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md italic font-mono text-[11px]">
                            Withdrawn
                          </span>
                        ) : file.status === 'DELETED' || ['COMPLETED', 'AWAITING_VERIFICATION', 'SPOOLER_COMPLETED'].includes(file.latestJobStatus) ? (
                          <span className="text-emerald-300 font-bold bg-emerald-950/90 border border-emerald-600/80 px-2.5 py-1 rounded-md text-xs flex items-center gap-1 shadow-sm">
                            ✅ Print Successful
                          </span>
                        ) : file.latestJobStatus === 'PRINTING' || file.latestJobStatus === 'PROCESSING' ? (
                          <span className="text-amber-300 font-bold bg-amber-950/80 border border-amber-800/80 px-2 py-0.5 rounded-md animate-pulse text-[11px]">
                            Printing…
                          </span>
                        ) : file.latestJobStatus === 'FAILED' ? (
                          <span className="text-rose-300 font-bold bg-rose-950/80 border border-rose-800/80 px-2 py-0.5 rounded-md text-[11px]">
                            ✕ Print Failed
                          </span>
                        ) : (
                          <>
                            <span className="text-slate-300 bg-slate-800/80 px-2 py-0.5 rounded-md font-mono text-[11px]">
                              Ready
                            </span>
                            <button
                              type="button"
                              onClick={() => handleWithdraw(file.id)}
                              disabled={withdrawingId === file.id}
                              className="text-rose-400 hover:text-white font-semibold text-[11px] px-2 py-1 rounded-lg border border-rose-800/60 bg-rose-950/30 hover:bg-rose-900/60 transition-colors"
                              title="Withdraw and immediately delete this file from station"
                            >
                              {withdrawingId === file.id ? '…' : 'Withdraw'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 pt-2.5 border-t border-slate-800 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEndSession}
                    disabled={endingSession}
                    className="text-xs text-rose-300 border-rose-800/60 bg-rose-950/30 hover:bg-rose-900/50 font-semibold"
                  >
                    {endingSession ? 'Ending Session…' : 'Finished? End Session & Shred Files'}
                  </Button>
                </div>
              </div>
            )}

            {/* Real-time Customer Document Lifecycle & Trust Tracker */}
            <DocumentLifecycleTracker
              expiresAt={session?.expiresAt || session?.expires_at}
              files={uploadedFiles}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
