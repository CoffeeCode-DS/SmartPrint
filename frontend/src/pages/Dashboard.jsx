import { useCallback, useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  createSession,
  getSession,
  getSessionQr,
  extendSession,
} from '../services/sessionApi';
import { getSessionFiles, uploadFileToSession, listFiles } from '../services/fileApi';
import { listNotifications } from '../services/notificationApi';
import { listPrinters, printTestPage, setPrinterStatus, removePrinter, setDefaultPrinter } from '../services/printerApi';
import { createPrintJob } from '../services/printJobApi';
import { getSystemHealth, getConsistencyReport } from '../services/systemApi';
import PrintDialog from '../components/PrintDialog';
import FilePreview from '../components/FilePreview';
import ConnectPrinterModal from '../components/ConnectPrinterModal';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { formatBytes, formatRelativeTime } from '../utils/format';
import { useCountdown } from '../hooks/useCountdown';
import { useSessionSocket } from '../hooks/useSessionSocket';
import { useQueueSocket } from '../hooks/useQueueSocket';
import { useAuth } from '../context/AuthContext';
import SmartPrintLogo from '../components/SmartPrintLogo';

const STORAGE_KEY = 'printsafe_session_id';

const DEFAULT_DEMO_PRINTER = {
  id: 'demo-smartprint-laserjet',
  name: 'SmartPrint Demo Printer (Connected)',
  isDefault: true,
  status: 'READY',
  portName: 'DEMO_PORT',
  driverName: 'SmartPrint Virtual Spooler Driver',
  capabilities: {
    color: true,
    duplex: true,
    paperSizes: ['A4', 'Letter', 'Legal', 'A3'],
    maxCopies: 99,
    orientations: ['portrait', 'landscape'],
  },
};

function playChime(type = 'upload') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'upload') {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else {
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.08);
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.16);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch {
    // audio policy
  }
}

function FileIcon({ mimeType }) {
  const isImage = mimeType?.startsWith('image/');
  const isWord = mimeType?.includes('word') || mimeType?.includes('officedocument');
  const isPdf = mimeType === 'application/pdf';

  return (
    <div
      className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-md ${
        isPdf
          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
          : isWord
          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
          : isImage
          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
          : 'bg-slate-800 text-slate-300 border border-slate-700'
      }`}
    >
      {isImage ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-5 h-5">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : isWord ? (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
          <path d="M8.5 17h1.4l1.1-4.5 1.1 4.5h1.4l1.8-7h-1.4l-1.1 4.8-1.1-4.8h-1.4l-1.1 4.8-1.1-4.8H7.3l1.2 7z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-5 h-5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [extending, setExtending] = useState(false);
  const [activity, setActivity] = useState([]); // persisted + live notifications
  const [files, setFiles] = useState([]); // uploaded files for this station session
  const [printFile, setPrintFile] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isDirectUploading, setIsDirectUploading] = useState(false);
  const [quickPrintingId, setQuickPrintingId] = useState(null);

  const fileInputRef = useRef(null);

  // Connected printers hardware monitoring
  const [printers, setPrinters] = useState([]);
  const [printersLoading, setPrintersLoading] = useState(false);
  const [testPrintLoading, setTestPrintLoading] = useState({});
  const [testPrintMsg, setTestPrintMsg] = useState(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  // System health & consistency monitoring
  const [systemHealth, setSystemHealth] = useState(null);
  const [consistencyReport, setConsistencyReport] = useState(null);
  const [checkingConsistency, setCheckingConsistency] = useState(false);

  const loadSystemHealth = useCallback(async () => {
    try {
      const data = await getSystemHealth();
      setSystemHealth(data);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    loadSystemHealth();
  }, [loadSystemHealth]);

  const handleSetPrinterStatus = async (printerId, newStatus) => {
    try {
      await setPrinterStatus(printerId, newStatus);
      await loadPrinters();
    } catch (err) {
      setTestPrintMsg({ type: 'error', text: err.message || 'Failed to update printer status.' });
    }
  };

  const handleRemovePrinter = async (printerId) => {
    if (!window.confirm('Remove this printer from the station?')) return;
    try {
      await removePrinter(printerId);
      await loadPrinters();
      setTestPrintMsg({ type: 'success', text: 'Printer removed successfully.' });
      setTimeout(() => setTestPrintMsg(null), 3000);
    } catch (err) {
      setTestPrintMsg({ type: 'error', text: err.message || 'Failed to remove printer.' });
    }
  };

  const handleSetDefaultPrinter = async (printerId) => {
    try {
      await setDefaultPrinter(printerId);
      await loadPrinters();
      setTestPrintMsg({ type: 'success', text: 'Default printer updated.' });
      setTimeout(() => setTestPrintMsg(null), 3000);
    } catch (err) {
      setTestPrintMsg({ type: 'error', text: err.message || 'Failed to set default printer.' });
    }
  };

  const handleRunConsistencyCheck = async () => {
    setCheckingConsistency(true);
    try {
      const rep = await getConsistencyReport();
      setConsistencyReport(rep);
    } catch (err) {
      setTestPrintMsg({ type: 'error', text: err.message || 'Consistency check failed.' });
    } finally {
      setCheckingConsistency(false);
    }
  };

  const loadPrinters = useCallback(async () => {
    setPrintersLoading(true);
    try {
      const list = await listPrinters();
      if (Array.isArray(list) && list.length > 0) {
        setPrinters(list);
      } else {
        setPrinters([DEFAULT_DEMO_PRINTER]);
      }
    } catch {
      setPrinters([DEFAULT_DEMO_PRINTER]);
    } finally {
      setPrintersLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrinters();
  }, [loadPrinters]);

  const handleTestPrint = async (printerId) => {
    setTestPrintLoading((prev) => ({ ...prev, [printerId]: true }));
    setTestPrintMsg(null);
    try {
      const res = await printTestPage(printerId);
      setTestPrintMsg({ type: 'success', text: res.message || `Test page sent to printer.` });
      setTimeout(() => setTestPrintMsg(null), 4000);
    } catch (err) {
      setTestPrintMsg({ type: 'error', text: err.message || 'Failed to send test page.' });
      setTimeout(() => setTestPrintMsg(null), 4000);
    } finally {
      setTestPrintLoading((prev) => ({ ...prev, [printerId]: false }));
    }
  };

  const { formatted, isExpired } = useCountdown(session?.expiresAt);
  const {
    connected: socketConnected,
    peerConnected,
    uploadProgress,
    lastUpload,
    lastValidationError,
    sessionEvent,
    notifications: liveNotifications,
  } = useSessionSocket(phase === 'ready' ? session?.id : null, 'viewer');

  const loadFiles = useCallback(async (sessionId) => {
    try {
      if (user) {
        const allFiles = await listFiles();
        setFiles(
          (allFiles || []).filter(
            (f) =>
              f.status !== 'DELETED' &&
              f.status !== 'WITHDRAWN' &&
              f.latestJobStatus !== 'COMPLETED'
          )
        );
        return;
      }
      const sid = sessionId || session?.id;
      if (!sid) return;
      const list = await getSessionFiles(sid);
      setFiles(
        (list || []).filter(
          (f) =>
            f.status !== 'DELETED' &&
            f.status !== 'WITHDRAWN' &&
            f.latestJobStatus !== 'COMPLETED'
        )
      );
    } catch {
      // non-critical
    }
  }, [session?.id, user]);

  // Merge freshly-pushed socket notifications into the activity feed
  useEffect(() => {
    if (liveNotifications.length === 0) return;
    setActivity((prev) => {
      const existingIds = new Set(prev.map((n) => n.id));
      const fresh = liveNotifications.filter((n) => !existingIds.has(n.id));
      return fresh.length ? [...fresh, ...prev].slice(0, 20) : prev;
    });
  }, [liveNotifications]);

  // When a file upload is completed, reload the files list
  useEffect(() => {
    if (lastUpload && session?.id) {
      loadFiles(session.id);
    }
  }, [lastUpload, session?.id, loadFiles]);

  // Listen to print queue events to update job status live
  const handleJobEvent = useCallback((job) => {
    if (!job || !job.fileId) return;
    if (job.status === 'COMPLETED' || job.status === 'DELETED') {
      setFiles((prev) => prev.filter((f) => f.id !== job.fileId));
      return;
    }
    setFiles((prev) =>
      prev.map((f) =>
        f.id === job.fileId
          ? { ...f, latestJobId: job.id, latestJobStatus: job.status }
          : f
      )
    );
  }, []);

  useQueueSocket(handleJobEvent);

  // Load notification history and files on ready
  useEffect(() => {
    if (phase !== 'ready' || !session?.id) return;
    let cancelled = false;
    listNotifications(session.id)
      .then((history) => {
        if (!cancelled) setActivity(history);
      })
      .catch(() => {});
    loadFiles(session.id);
    return () => {
      cancelled = true;
    };
  }, [phase, session?.id, loadFiles]);

  const loadQr = useCallback(async (sessionId) => {
    const { qrDataUrl: url, session: s } = await getSessionQr(sessionId);
    setQrDataUrl(url);
    setSession(s);
  }, []);

  const startFreshSession = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const newSession = await createSession({ oneTime: false });
      localStorage.setItem(STORAGE_KEY, newSession.id);
      await loadQr(newSession.id);
      setFiles([]);
      setPhase('ready');
    } catch (err) {
      setError(err.message);
      setPhase('error');
    }
  }, [loadQr]);

  // On mount: recover existing multi-use session or create a new one
  useEffect(() => {
    (async () => {
      const storedId = localStorage.getItem(STORAGE_KEY);
      if (!storedId) {
        await startFreshSession();
        return;
      }
      try {
        const existing = await getSession(storedId);
        if (existing.status === 'ACTIVE' && existing.oneTime === false) {
          await loadQr(storedId);
          setPhase('ready');
        } else {
          localStorage.removeItem(STORAGE_KEY);
          await startFreshSession();
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        await startFreshSession();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to socket session events
  useEffect(() => {
    if (!sessionEvent || !session) return;
    if (sessionEvent.type === 'EXPIRED') {
      setSession((s) => (s ? { ...s, status: 'EXPIRED' } : s));
    } else if (sessionEvent.type === 'CANCELLED') {
      setSession((s) => (s ? { ...s, status: 'CANCELLED' } : s));
    } else if (sessionEvent.type === 'EXTENDED' && sessionEvent.expiresAt) {
      setSession((s) =>
        s ? { ...s, expiresAt: sessionEvent.expiresAt, extendedCount: s.extendedCount + 1 } : s
      );
    }
  }, [sessionEvent, session]);

  async function handleExtend() {
    if (!session) return;
    setExtending(true);
    try {
      const updated = await extendSession(session.id);
      setSession(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setExtending(false);
    }
  }

  const handleCopyMobileUrl = async () => {
    if (!session?.id) return;
    const mobileUrl = `${window.location.origin}/upload/${session.id}`;
    try {
      await navigator.clipboard.writeText(mobileUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // fallback
    }
  };

  const handleDirectUpload = async (e) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0 || !session?.id) return;
    setIsDirectUploading(true);
    try {
      for (const file of selectedFiles) {
        await uploadFileToSession(session.id, file);
      }
      playChime('upload');
      await loadFiles(session.id);
    } catch (err) {
      setError(err.message || 'Direct upload failed.');
      setTimeout(() => setError(null), 4000);
    } finally {
      setIsDirectUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleQuickPrint = async (file) => {
    if (!file) return;
    setQuickPrintingId(file.id);
    try {
      const targetPrinter =
        printers.find((p) => p.isDefault && p.status === 'READY') ||
        printers.find((p) => p.isDefault) ||
        printers.find((p) => p.status === 'READY') ||
        printers[0];
      const job = await createPrintJob(file.id, {
        printerId: targetPrinter ? targetPrinter.id : undefined,
        settings: {
          copies: 1,
          color: false,
          duplex: false,
          paperSize: 'A4',
        },
      });
      playChime('print');
      handleJobEvent(job);
      await loadFiles(session.id);
      // Directly redirect to Queue review page as requested
      navigate('/queue');
    } catch (err) {
      setTestPrintMsg({ type: 'error', text: err.message || 'Quick print failed.' });
      setTimeout(() => setTestPrintMsg(null), 4000);
    } finally {
      setQuickPrintingId(null);
    }
  };

  return (
    <div className="min-h-screen app-gradient-canvas text-slate-100 px-4 py-6 sm:py-8 relative overflow-hidden font-sans">
      {/* Ambient mesh gradient lights */}
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-rose-500/10 blur-3xl pointer-events-none" />
      <div className="absolute top-1/4 -right-32 w-96 h-96 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 left-1/3 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

      {/* Top Header */}
      <header className="max-w-5xl mx-auto flex items-center justify-between pb-4 sm:pb-6 mb-4 sm:mb-6 border-b border-slate-700/80 relative z-10 flex-wrap gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link to="/" className="inline-block group">
            <SmartPrintLogo size="md" showText={true} />
          </Link>
          <span className="text-[11px] sm:text-xs bg-emerald-500/15 text-emerald-300 font-bold px-2.5 py-0.5 rounded-full border border-emerald-500/30 shadow-xs">
            Zero-Trace Print Station
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-xs bg-slate-900/90 border border-slate-700 px-3 py-1.5 rounded-xl text-slate-200 font-mono shadow-xs">
                👤 {user.username} ({user.role})
              </span>
              <Link
                to="/queue"
                className="text-xs font-bold text-white bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 px-3.5 py-1.5 rounded-xl transition-all inline-flex items-center gap-1.5 shadow-md shadow-rose-600/30 border border-rose-400/30"
              >
                <span>Queue</span>
                <span>→</span>
              </Link>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-300 font-mono hidden md:inline">
                Demo: <code className="text-rose-400 font-bold">admin / changeme123</code>
              </span>
              <Link
                to="/signup"
                className="text-xs font-semibold text-rose-300 hover:text-white bg-rose-950/60 hover:bg-rose-900/80 px-3 py-1.5 rounded-xl border border-rose-500/40 transition-colors inline-flex items-center gap-1 shadow-xs"
              >
                <span>Sign Up</span>
              </Link>
              <Link
                to="/login"
                className="text-xs font-semibold text-white bg-slate-900/90 hover:bg-slate-800 px-3.5 py-1.5 rounded-xl border border-slate-700 hover:border-slate-600 transition-colors inline-flex items-center gap-1.5 shadow-xs"
              >
                <span>Sign In</span>
                <span>→</span>
              </Link>
            </div>
          )}
        </div>
      </header>

      {/* Main Grid */}
      <main className="max-w-5xl mx-auto relative z-10">
        {phase === 'loading' && (
          <div className="py-24 text-center">
            <div className="w-8 h-8 mx-auto rounded-full border-2 border-slate-700 border-t-rose-500 animate-spin" />
            <p className="mt-4 text-slate-400 text-sm font-medium">Initializing print station…</p>
          </div>
        )}

        {phase === 'error' && (
          <Card className="max-w-md mx-auto p-8 text-center bg-slate-900/90 backdrop-blur-xl shadow-2xl border-slate-800">
            <p className="text-rose-300 text-sm font-semibold bg-rose-950/60 border border-rose-800/80 rounded-xl px-4 py-3">{error}</p>
            <Button onClick={startFreshSession} className="mt-4 w-full">
              Try again
            </Button>
          </Card>
        )}

        {phase === 'ready' && (
          <div className="grid lg:grid-cols-12 gap-6 sm:gap-8 items-start">
            {/* Left Card: QR Code & Status */}
            <Card className="lg:col-span-5 p-6 sm:p-7 text-center relative overflow-hidden bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span className="text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider">
                    Scan to Upload
                  </span>
                </div>
                <span className="text-xs text-slate-400 bg-slate-800/80 px-2.5 py-0.5 rounded-full border border-slate-700/60">
                  {isExpired ? (
                    <span className="text-rose-400 font-medium">expired</span>
                  ) : (
                    <>expires in <span className="font-mono font-semibold text-rose-400">{formatted}</span></>
                  )}
                </span>
              </div>

              {/* Station PIN Badge */}
              <div className="mb-3 flex items-center justify-center gap-2">
                <span className="text-[11px] text-slate-400 font-medium">Station Code:</span>
                <span className="font-mono font-bold tracking-widest text-xs px-2.5 py-1 rounded-md bg-slate-950/80 border border-rose-500/30 text-rose-400">
                  #{session?.id ? session.id.slice(0, 6).toUpperCase() : '------'}
                </span>
                <button
                  type="button"
                  onClick={handleCopyMobileUrl}
                  className="text-[11px] font-mono px-2 py-0.5 rounded text-slate-400 hover:text-slate-200 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 transition-colors"
                  title="Copy direct mobile upload link"
                >
                  {copiedLink ? '✓ Copied!' : '📋 Copy Link'}
                </button>
              </div>

              {/* QR Code Container: Pure white inset so phone cameras scan instantly */}
              <div className="flex justify-center my-3">
                <div className="relative p-4 rounded-2xl bg-white border-2 border-rose-500/30 shadow-2xl group">
                  <span className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-rose-500 rounded-tl-md" />
                  <span className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-rose-500 rounded-tr-md" />
                  <span className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-rose-500 rounded-bl-md" />
                  <span className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-rose-500 rounded-br-md" />
                  
                  {qrDataUrl ? (
                    <div className="relative overflow-hidden rounded-lg">
                      <img src={qrDataUrl} alt="Scan to upload" className="w-48 h-48 sm:w-52 sm:h-52" />
                      {/* Subtle laser scan line */}
                      <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-rose-500/70 to-transparent animate-pulse pointer-events-none" style={{ animationDuration: '2.5s' }} />
                    </div>
                  ) : (
                    <div className="w-48 h-48 sm:w-52 sm:h-52 flex items-center justify-center bg-slate-100 rounded-lg">
                      <span className="text-xs text-slate-500 animate-pulse">Generating Station QR…</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Connection Status */}
              <div className="mt-3 flex items-center justify-center gap-2 text-xs font-mono">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    socketConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-600'
                  }`}
                />
                <span className={socketConnected ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                  {socketConnected ? 'Station Live' : 'Connecting to station…'}
                </span>
                {peerConnected && (
                  <span className="text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded-full font-sans font-medium text-[11px]">
                    📱 Phone Connected
                  </span>
                )}
              </div>

              {/* Upload Progress Bar */}
              {uploadProgress !== null && (
                <div className="mt-4 p-3 rounded-xl bg-slate-800/60 border border-slate-700/60">
                  <div className="flex justify-between text-xs font-mono text-slate-300 mb-1.5">
                    <span>Receiving document…</span>
                    <span className="font-semibold text-rose-400">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-rose-500 to-rose-600 h-2 transition-all duration-300 ease-out rounded-full shadow-inner"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {lastValidationError && (
                <div className="mt-4 rounded-xl bg-rose-950/60 px-4 py-2.5 text-left border border-rose-800/80">
                  <p className="text-xs text-rose-300 font-medium">⚠️ {lastValidationError.message}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={handleExtend}
                  disabled={extending || session.extendedCount >= session.maxExtensions}
                  className="text-xs py-2 border-slate-700 hover:border-slate-600 text-slate-200"
                >
                  {session.extendedCount >= session.maxExtensions
                    ? 'Max Time Reached'
                    : extending
                    ? 'Extending…'
                    : `+Extend (+${session.maxExtensions - session.extendedCount})`}
                </Button>
                <Button
                  variant="ghost"
                  onClick={startFreshSession}
                  className="text-xs py-2 text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700"
                >
                  🔄 New QR
                </Button>
              </div>

              <p className="mt-3.5 text-[11px] text-slate-400 leading-relaxed">
                Scan with standard camera or iPhone/Android QR scanner. No app download needed.
              </p>
            </Card>

            {/* Right Card: Uploaded Documents & Direct Print Actions */}
            <div className="lg:col-span-7 space-y-6">
              <Card className="p-6 bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-4 flex-wrap gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-white flex items-center gap-2">
                      <span>Ready to Print</span>
                      <span className="font-mono text-xs bg-slate-800 px-2 py-0.5 rounded-full text-slate-300 border border-slate-700">
                        {files.length} {files.length === 1 ? 'doc' : 'docs'}
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Documents uploaded via mobile scan or direct upload
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleDirectUpload}
                      multiple
                      accept=".pdf,.doc,.docx,image/*"
                      className="hidden"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isDirectUploading}
                      className="text-xs font-semibold border-rose-500/40 text-rose-300 hover:bg-rose-500 hover:text-white transition-all shadow-xs"
                    >
                      {isDirectUploading ? (
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-3 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
                          Uploading…
                        </span>
                      ) : (
                        <span>📎 Direct Upload</span>
                      )}
                    </Button>
                  </div>
                </div>

                {files.length === 0 ? (
                  <div className="py-14 px-4 text-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-950/40">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-slate-800/60 flex items-center justify-center text-slate-400 text-xl">
                      📄
                    </div>
                    <p className="text-sm font-semibold text-slate-300">No documents received yet</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                      Scan the station QR code with your phone or click <span className="text-rose-400 font-medium">"Direct Upload"</span> above to load a document.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
                    {files.map((file) => (
                      <div
                        key={file.id}
                        className="p-3.5 sm:p-4 rounded-xl bg-slate-800/50 hover:bg-slate-800/80 border border-slate-700/60 hover:border-slate-600 flex items-center justify-between gap-3 sm:gap-4 transition-all shadow-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <FileIcon mimeType={file.mimeType} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-white truncate" title={file.originalName}>
                              {file.originalName}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                              <span className="font-mono">{formatBytes(file.sizeBytes)}</span>
                              <span>·</span>
                              <span>{formatRelativeTime(file.uploadedAt)}</span>
                            </p>
                          </div>
                        </div>

                        {/* Status & Actions */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {file.latestJobStatus === 'COMPLETED' ? (
                            <span className="text-xs text-emerald-400 font-medium bg-emerald-950/60 px-2.5 py-1 rounded-md border border-emerald-700/60">
                              ✓ Printed
                            </span>
                          ) : file.latestJobStatus === 'PRINTING' ? (
                            <span className="text-xs text-amber-400 font-medium bg-amber-950/60 px-2.5 py-1 rounded-md border border-amber-700/60 animate-pulse">
                              Printing…
                            </span>
                          ) : file.latestJobStatus === 'PROCESSING' || file.latestJobStatus === 'PENDING' ? (
                            <span className="text-xs text-slate-300 bg-slate-800 px-2.5 py-1 rounded-md border border-slate-700">
                              Queued
                            </span>
                          ) : (
                            <>
                              {/* 1-Click Print */}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleQuickPrint(file)}
                                disabled={quickPrintingId === file.id}
                                className="text-xs font-semibold bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)]"
                                title="1-Click standard A4 print"
                              >
                                {quickPrintingId === file.id ? '⚡ Printing…' : '⚡ 1-Click Print'}
                              </Button>

                              {/* Configure Print */}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setPrintFile(file)}
                                className="text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 shadow-2xs"
                              >
                                🖨️ Options
                              </Button>
                            </>
                          )}

                          {/* Preview Button */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPreviewFile(file)}
                            className="text-xs px-2.5 border border-slate-700/80 text-slate-300 hover:text-white hover:bg-slate-800"
                            title="Preview file"
                          >
                            👁️
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Connected Printers Hardware Card */}
              <Card className="p-6 text-left bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800/80 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                      Connected Printer Fleet ({printers.length})
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={loadPrinters}
                      disabled={printersLoading}
                      className="text-xs text-slate-400 hover:text-white font-medium transition-colors px-2 py-1 rounded-lg hover:bg-slate-800"
                    >
                      {printersLoading ? 'Scanning…' : '🔄 Refresh'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsConnectModalOpen(true)}
                      className="text-xs font-semibold text-rose-300 hover:text-white bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 px-2.5 py-1 rounded-lg transition-all shadow-xs"
                    >
                      + Add Hardware
                    </button>
                  </div>
                </div>

                {testPrintMsg && (
                  <div
                    className={`mb-4 p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                      testPrintMsg.type === 'success'
                        ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/80 shadow-xs'
                        : 'bg-rose-950/60 text-rose-300 border border-rose-800/80 shadow-xs'
                    }`}
                  >
                    <span>{testPrintMsg.type === 'success' ? '✓' : '⚠️'}</span>
                    <span>{testPrintMsg.text}</span>
                  </div>
                )}

                {printers.length === 0 ? (
                  <p className="text-xs text-slate-400 py-4 text-center">No printers currently detected.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {printers.map((p) => (
                      <div
                        key={p.id}
                        className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between ${
                          p.isDefault
                            ? 'bg-gradient-to-br from-slate-800/90 to-slate-850/90 border-rose-500/40 shadow-md ring-1 ring-rose-500/30'
                            : 'bg-slate-800/50 border-slate-700/60 hover:bg-slate-800/80'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1.5 mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="w-6 h-6 rounded-lg bg-slate-700/60 flex items-center justify-center text-xs shrink-0 text-slate-200">
                                🖨️
                              </span>
                              <span className="font-bold text-xs text-white truncate">{p.name}</span>
                            </div>
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold shrink-0 ${
                                p.status === 'READY'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                  : p.status === 'BUSY' || p.status === 'PRINTING'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                  : 'bg-slate-800 text-slate-400 border border-slate-700'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  p.status === 'READY'
                                    ? 'bg-emerald-400 animate-pulse'
                                    : p.status === 'BUSY' || p.status === 'PRINTING'
                                    ? 'bg-amber-400'
                                    : 'bg-slate-500'
                                }`}
                              />
                              {p.status}
                            </span>
                          </div>

                          {(p.isDemo || p.id === 'demo-smartprint-laserjet') && (
                            <div className="mb-2">
                              <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold px-2 py-0.5 rounded-md inline-flex items-center gap-1 font-mono">
                                <span>⚡</span> DEMO SPOOLER (VIRTUAL)
                              </span>
                            </div>
                          )}

                          {p.isDefault && !(p.isDemo || p.id === 'demo-smartprint-laserjet') && (
                            <div className="mb-2">
                              <span className="text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold px-2 py-0.5 rounded-md inline-flex items-center gap-1">
                                <span>★</span> DEFAULT PRINTER
                              </span>
                            </div>
                          )}

                          <div className="text-[11px] text-slate-400 flex items-center gap-2 font-mono mt-1">
                            <span className={p.capabilities?.color ? 'text-emerald-400 font-medium' : ''}>
                              Color: {p.capabilities?.color ? 'Yes' : 'No'}
                            </span>
                            <span>·</span>
                            <span className={p.capabilities?.duplex ? 'text-emerald-400 font-medium' : ''}>
                              Duplex: {p.capabilities?.duplex ? 'Yes' : 'No'}
                            </span>
                          </div>
                        </div>

                        <div className="mt-3 pt-2.5 border-t border-slate-700/60 space-y-2">
                          {/* Row 1: Status + actions */}
                          <div className="flex items-center justify-between gap-2">
                            <select
                              value={p.status === 'MAINTENANCE' ? 'MAINTENANCE' : p.status === 'OFFLINE' ? 'OFFLINE' : 'AVAILABLE'}
                              onChange={(e) => handleSetPrinterStatus(p.id, e.target.value)}
                              className="text-[11px] bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-slate-200 font-medium outline-none focus:ring-1 focus:ring-rose-500"
                              title="Hardware Availability Mode"
                            >
                              <option value="AVAILABLE">Online</option>
                              <option value="MAINTENANCE">Maintenance</option>
                              <option value="OFFLINE">Offline</option>
                            </select>

                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[11px] py-1 px-3 h-7 font-semibold text-slate-300 hover:text-white border-slate-700 hover:bg-slate-750"
                              disabled={p.status === 'OFFLINE' || p.status === 'MAINTENANCE' || testPrintLoading[p.id]}
                              onClick={() => handleTestPrint(p.id)}
                            >
                              {testPrintLoading[p.id] ? 'Sending…' : '📄 Test Page'}
                            </Button>
                          </div>

                          {/* Row 2: Set Default + Remove */}
                          <div className="flex items-center gap-2">
                            {!p.isDefault && (
                              <button
                                type="button"
                                onClick={() => handleSetDefaultPrinter(p.id)}
                                className="flex-1 text-[11px] font-semibold text-amber-300 hover:text-white bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-2 py-1 rounded-lg transition-all"
                                title="Set as default printer for print jobs"
                              >
                                ★ Set as Default
                              </button>
                            )}
                            {p.isDefault && (
                              <span className="flex-1 text-center text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded-lg">
                                ★ Default Printer
                              </span>
                            )}
                            {p.id !== 'demo-smartprint-laserjet' && (
                              <button
                                type="button"
                                onClick={() => handleRemovePrinter(p.id)}
                                className="text-[11px] font-semibold text-rose-400 hover:text-white hover:bg-rose-500/20 border border-rose-500/30 px-2 py-1 rounded-lg transition-all"
                                title="Remove this printer"
                              >
                                🗑 Remove
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* System Health & Consistency Monitoring */}
              <Card className="p-6 text-left bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800/80 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                      Telemetry & Storage Health
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={loadSystemHealth}
                      className="text-xs text-slate-400 hover:text-white font-medium transition-colors px-2 py-1 rounded-lg hover:bg-slate-800"
                    >
                      🔄 Refresh
                    </button>
                    <button
                      type="button"
                      onClick={handleRunConsistencyCheck}
                      disabled={checkingConsistency}
                      className="text-xs font-semibold text-indigo-300 hover:text-white bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 px-2.5 py-1 rounded-lg transition-all shadow-xs"
                    >
                      {checkingConsistency ? 'Auditing…' : '🔍 Storage Audit'}
                    </button>
                  </div>
                </div>

                {systemHealth && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono mb-3">
                    <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/60">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">Database</p>
                      <p className="font-bold text-white mt-1 flex items-center gap-1.5">
                        <span className="text-emerald-400">●</span> {systemHealth.database?.journalMode || 'WAL'}
                      </p>
                    </div>
                    <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/60">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">Free Disk</p>
                      <p className="font-bold text-white mt-1">
                        {systemHealth.storage?.freeMb != null ? `${systemHealth.storage.freeMb} MB` : '100% OK'}
                      </p>
                    </div>
                    <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/60">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">WebSockets</p>
                      <p className="font-bold text-white mt-1">
                        {systemHealth.sockets?.connectedClients ?? 0} active
                      </p>
                    </div>
                    <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/60">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">Auto Sweeper</p>
                      <p className="font-bold text-emerald-400 mt-1">
                        Active (60s)
                      </p>
                    </div>
                  </div>
                )}

                {consistencyReport && (
                  <div className="p-3.5 rounded-xl bg-slate-800/50 text-xs font-mono border border-slate-700/80 space-y-1">
                    <p className="text-white font-bold flex items-center gap-1.5">
                      {consistencyReport.consistent ? '✓ System State Cryptographically Consistent' : '⚠️ Storage Inconsistencies Found'}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Orphan disk files: {consistencyReport.orphanedDiskFiles?.length || 0} · 
                      Missing DB files: {consistencyReport.missingDiskFiles?.length || 0} · 
                      Stale jobs: {consistencyReport.staleJobs?.length || 0}
                    </p>
                  </div>
                )}
              </Card>

              {/* Station Activity Feed */}
              {activity.length > 0 && (
                <Card className="p-6 text-left bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-800/80">
                    <span className="w-2 h-2 rounded-full bg-slate-400" />
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider font-mono">
                      Station Live Event Timeline
                    </h3>
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-2 pr-1">
                    {activity.map((n) => (
                      <div key={n.id} className="text-xs text-slate-300 flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-800/50 transition-colors">
                        <span className="text-slate-400 font-mono text-[11px] shrink-0 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700/50">
                          {new Date(n.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span className="truncate font-medium text-slate-200">{n.message}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Connect Printer Modal */}
      <ConnectPrinterModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onPrinterAdded={() => loadPrinters()}
      />

      {/* Print Configuration Dialog */}
      {printFile && (
        <PrintDialog
          file={printFile}
          onClose={() => setPrintFile(null)}
          onQueued={(job) => {
            const fid = job?.fileId || printFile?.id;
            setPrintFile(null);
            if (fid) {
              setFiles((prev) => prev.filter((f) => f.id !== fid));
            }
            handleJobEvent(job);
            loadFiles();
          }}
        />
      )}

      {/* Preview Modal */}
      {previewFile && (
        <FilePreview
          fileId={previewFile.id}
          mimeType={previewFile.mimeType}
          originalName={previewFile.originalName}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}
