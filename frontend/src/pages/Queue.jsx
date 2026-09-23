import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listFiles, operatorWithdrawFile } from '../services/fileApi';
import {
  listPrintJobs,
  cancelPrintJob,
  verifyPrintJob,
  retryRemainingPrintJob,
  restartEntirePrintJob,
  switchPrinterJob,
} from '../services/printJobApi';
import { listPrinters, getCompatiblePrinters } from '../services/printerApi';
import { useQueueSocket } from '../hooks/useQueueSocket';
import StatusBadge from '../components/StatusBadge';
import FilePreview from '../components/FilePreview';
import PrintDialog from '../components/PrintDialog';
import StaffHeader from '../components/StaffHeader';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { formatBytes, formatRelativeTime } from '../utils/format';

const ACTIVE_STATUSES = ['PENDING', 'PROCESSING', 'PRINTING', 'SPOOLER_COMPLETED', 'RETRYING'];

const FAILURE_CODES = [
  { code: 'PAPER_JAM', label: 'Paper Jam' },
  { code: 'OUT_OF_PAPER', label: 'Out of Paper' },
  { code: 'LOW_TONER', label: 'Low Toner / Ink' },
  { code: 'COVER_OPEN', label: 'Cover Open' },
  { code: 'OFFLINE', label: 'Printer Offline' },
  { code: 'COMMUNICATION_ERROR', label: 'Communication Error' },
  { code: 'SPOOLER_TIMEOUT', label: 'Spooler Timeout' },
  { code: 'OTHER', label: 'Other Failure' },
];

function jobSettingsSummary(job) {
  if (!job) return null;
  const parts = [`${job.copies}x`, job.paperSize, job.orientation];
  if (job.colorMode === 'color') parts.push('Color');
  if (job.duplex) parts.push('Duplex');
  if (job.pageRange && job.pageRange !== 'all') parts.push(`pages ${job.pageRange}`);
  return parts.join(' · ');
}

function FileIcon({ mimeType }) {
  const isImage = mimeType?.startsWith('image/');
  const isWord = mimeType?.includes('word') || mimeType?.includes('officedocument');
  const isPdf = mimeType === 'application/pdf';

  return (
    <div
      className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-lg ${
        isPdf
          ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
          : isWord
          ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
          : isImage
          ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
          : 'bg-slate-800 text-slate-300 border border-slate-700'
      }`}
    >
      {isImage ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : isWord ? (
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
          <path d="M8.5 17h1.4l1.1-4.5 1.1 4.5h1.4l1.8-7h-1.4l-1.1 4.8-1.1-4.8h-1.4l-1.1 4.8-1.1-4.8H7.3l1.2 7z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

function StatPill({ label, value }) {
  return (
    <div className="flex items-baseline gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900/80 border border-slate-700/80 shadow-xs">
      <span className="font-mono text-xl font-extrabold text-white">{value}</span>
      <span className="text-xs text-slate-300 font-semibold uppercase tracking-wider">{label}</span>
    </div>
  );
}

export default function Queue() {
  const [files, setFiles] = useState([]);
  const [jobsByFileId, setJobsByFileId] = useState({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [actioningId, setActioningId] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [printFile, setPrintFile] = useState(null);

  // Failure modal state
  const [failureModalJob, setFailureModalJob] = useState(null);
  const [failureCode, setFailureCode] = useState('PAPER_JAM');
  const [failureCompletedPages, setFailureCompletedPages] = useState(0);
  const [failureNotes, setFailureNotes] = useState('');

  // Switch printer modal state
  const [switchModalJob, setSwitchModalJob] = useState(null);
  const [printers, setPrinters] = useState([]);
  const [targetPrinterId, setTargetPrinterId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [filesList, jobsList] = await Promise.all([listFiles(), listPrintJobs()]);
      // Exclude physically deleted or withdrawn files from queue view
      const activeFiles = (filesList || []).filter(
        (f) => f.status !== 'DELETED' && f.status !== 'WITHDRAWN'
      );
      setFiles(activeFiles);
      const map = {};
      jobsList.forEach((job) => {
        const existing = map[job.fileId];
        if (!existing || new Date(job.createdAt) > new Date(existing.createdAt)) {
          map[job.fileId] = job;
        }
      });
      setJobsByFileId(map);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    listPrinters().then(setPrinters).catch(() => {});
  }, [refresh]);

  const handleJobEvent = useCallback((eventData) => {
    if (!eventData) return;
    // Real-time file deletion / completion / withdrawal event
    if (eventData.fileId) {
      if (
        eventData.status === 'WITHDRAWN' ||
        eventData.status === 'DELETED' ||
        eventData.status === 'COMPLETED' ||
        (!eventData.printerId && !eventData.id)
      ) {
        setFiles((prev) => prev.filter((f) => f.id !== eventData.fileId));
      }
      if (eventData.status && eventData.id) {
        setJobsByFileId((prev) => ({ ...prev, [eventData.fileId]: eventData }));
      }
    }
  }, []);

  useQueueSocket(handleJobEvent);

  function handleQueued(job) {
    setJobsByFileId((prev) => ({ ...prev, [job.fileId]: job }));
    if (job.status === 'COMPLETED') {
      setFiles((prev) => prev.filter((f) => f.id !== job.fileId));
    }
    setPrintFile(null);
  }

  async function handleVerifySuccess(job) {
    setActioningId(job.id);
    setErrorMsg(null);
    try {
      const updated = await verifyPrintJob(job.id, { verified: true });
      setJobsByFileId((prev) => ({ ...prev, [updated.fileId]: updated }));
      // Immediately remove printed/verified file from Queue view
      setFiles((prev) => prev.filter((f) => f.id !== (updated.fileId || job.file_id || job.fileId)));
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setActioningId(null);
    }
  }

  async function handleConfirmFailure() {
    if (!failureModalJob) return;
    setActioningId(failureModalJob.id);
    setErrorMsg(null);
    try {
      const updated = await verifyPrintJob(failureModalJob.id, {
        verified: false,
        failureCode,
        completedPages: Math.max(0, parseInt(failureCompletedPages, 10) || 0),
        notes: failureNotes.trim() || undefined,
      });
      setJobsByFileId((prev) => ({ ...prev, [updated.fileId]: updated }));
      setFailureModalJob(null);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setActioningId(null);
    }
  }


  async function handleRetryRemaining(job) {
    setActioningId(job.id);
    setErrorMsg(null);
    try {
      const updated = await retryRemainingPrintJob(job.id, {
        completedPages: job.completed_pages || 0,
      });
      setJobsByFileId((prev) => ({ ...prev, [updated.fileId]: updated }));
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setActioningId(null);
    }
  }

  async function handleRestart(job) {
    setActioningId(job.id);
    setErrorMsg(null);
    try {
      const updated = await restartEntirePrintJob(job.id);
      setJobsByFileId((prev) => ({ ...prev, [updated.fileId]: updated }));
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setActioningId(null);
    }
  }

  async function handleOpenSwitch(job) {
    setSwitchModalJob(job);
    try {
      const res = await getCompatiblePrinters({ fileId: job.fileId });
      const compatible = res.compatiblePrinters || [];
      if (compatible.length > 0) {
        const other = compatible.find((p) => p.id !== job.printerId);
        setTargetPrinterId(other ? other.id : compatible[0].id);
      } else if (printers.length > 0) {
        setTargetPrinterId(printers[0].id);
      }
    } catch {
      if (printers.length > 0) setTargetPrinterId(printers[0].id);
    }
  }

  async function handleConfirmSwitch() {
    if (!switchModalJob || !targetPrinterId) return;
    setActioningId(switchModalJob.id);
    setErrorMsg(null);
    try {
      const updated = await switchPrinterJob(switchModalJob.id, {
        newPrinterId: targetPrinterId,
      });
      setJobsByFileId((prev) => ({ ...prev, [updated.fileId]: updated }));
      setSwitchModalJob(null);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setActioningId(null);
    }
  }

  async function handleCancel(job) {
    if (!window.confirm('Cancel this print job? This cannot be undone.')) return;
    setActioningId(job.id);
    setErrorMsg(null);
    try {
      const updated = await cancelPrintJob(job.id);
      setJobsByFileId((prev) => ({ ...prev, [updated.fileId]: updated }));
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setActioningId(null);
    }
  }

  async function handleWithdrawFile(file) {
    if (!window.confirm(`Permanently withdraw and delete "${file.originalName}" from server?`)) return;
    setActioningId(file.id);
    setErrorMsg(null);
    try {
      await operatorWithdrawFile(file.id);
    } catch (err) {
      // If already deleted or removed on disk, don't show scary error
      const msg = (err.message || '').toLowerCase();
      if (!msg.includes('not found') && !msg.includes('already removed')) {
        setErrorMsg(err.message);
      }
    } finally {
      // ALWAYS purge the file from UI state immediately
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
      setActioningId(null);
    }
  }

  const stats = useMemo(() => {
    const jobs = Object.values(jobsByFileId);
    return {
      total: files.length,
      active: jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).length,
      awaitingVerification: jobs.filter((j) => j.status === 'AWAITING_VERIFICATION').length,
      completed: jobs.filter((j) => j.status === 'COMPLETED').length,
      failed: jobs.filter((j) => j.status === 'FAILED').length,
    };
  }, [files, jobsByFileId]);

  const [activeTab, setActiveTab] = useState('ALL');

  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      const job = jobsByFileId[f.id];
      if (activeTab === 'ACTIVE') return job && ACTIVE_STATUSES.includes(job.status);
      if (activeTab === 'VERIFY') return job && job.status === 'AWAITING_VERIFICATION';
      if (activeTab === 'COMPLETED') return job && job.status === 'COMPLETED';
      if (activeTab === 'FAILED') return job && job.status === 'FAILED';
      // In default 'ALL' tab: hide completed files so they are removed from the queue
      return !job || job.status !== 'COMPLETED';
    });
  }, [files, jobsByFileId, activeTab]);

  return (
    <div className="min-h-screen app-gradient-canvas text-slate-100 relative overflow-hidden font-sans">
      {/* Ambient decorative glow */}
      <div className="absolute top-0 right-1/4 w-96 h-96 rounded-full bg-rose-500/10 blur-3xl pointer-events-none" />
      <div className="absolute top-1/2 -left-20 w-80 h-80 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

      <StaffHeader current="Queue" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 relative z-10">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-6 pb-2 border-b border-slate-800/60">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3">
                <span>🖨️ Print Queue Station</span>
              </h1>
              {printers.length > 0 && (
                <span className="text-xs bg-emerald-500/10 text-emerald-400 font-semibold px-3 py-1 rounded-full border border-emerald-500/30 flex items-center gap-1.5 shadow-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Default Connected: <strong>{(printers.find((p) => p.isDefault) || printers[0])?.name}</strong></span>
                </span>
              )}
            </div>
            <p className="text-sm text-slate-300 mt-1.5 font-medium">
              Real-time document ingestion, physical inspection & hardware recovery pipeline
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              to="/dashboard"
              className="text-xs font-semibold text-slate-300 hover:text-white bg-slate-900/90 hover:bg-slate-800 px-3.5 py-2 rounded-xl border border-slate-700/80 transition-colors inline-flex items-center gap-1.5 shadow-xs"
            >
              <span>← Print Station</span>
            </Link>
            {!loading && files.length > 0 && (
              <>
                <StatPill label="files" value={stats.total} />
                <StatPill label="active" value={stats.active} />
                {stats.awaitingVerification > 0 && (
                  <div className="flex items-baseline gap-2 px-3.5 py-1.5 bg-amber-950/60 rounded-xl border border-amber-500/40 shadow-xs">
                    <span className="font-mono text-xl font-extrabold text-amber-300">{stats.awaitingVerification}</span>
                    <span className="text-xs text-amber-300 font-bold uppercase tracking-wider">verify needed</span>
                  </div>
                )}
                <StatPill label="done" value={stats.completed} />
                {stats.failed > 0 && <StatPill label="failed" value={stats.failed} />}
              </>
            )}
          </div>
        </div>

        {/* Filter Navigation Tabs */}
        {!loading && files.length > 0 && (
          <div className="flex items-center gap-2 mb-6 p-1.5 bg-slate-900/90 rounded-2xl border border-slate-800 shadow-md w-fit overflow-x-auto max-w-full">
            {[
              { id: 'ALL', label: 'All Files', count: stats.total },
              { id: 'ACTIVE', label: 'Active', count: stats.active },
              { id: 'VERIFY', label: 'Needs Verification', count: stats.awaitingVerification },
              { id: 'COMPLETED', label: 'Completed', count: stats.completed },
              { id: 'FAILED', label: 'Failed', count: stats.failed },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-rose-600 to-rose-700 text-white shadow-md shadow-rose-600/30'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-mono font-bold ${
                    activeTab === tab.id
                      ? 'bg-black/30 text-white'
                      : 'bg-slate-800 text-slate-300 border border-slate-700/60'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        )}

        {errorMsg && (
          <div className="mb-5 rounded-2xl bg-rose-950/70 border border-rose-800/80 px-4 py-3 text-sm text-rose-200 font-semibold shadow-md">
            ⚠️ {errorMsg}
          </div>
        )}

        {loading && (
          <div className="py-20 text-center">
            <div className="w-8 h-8 mx-auto rounded-full border-2 border-slate-700 border-t-rose-500 animate-spin" />
            <p className="mt-4 text-sm text-slate-400 font-medium">Loading print queue documents…</p>
          </div>
        )}

        {!loading && files.length === 0 && (
          <Card className="p-16 text-center bg-slate-900/80 border border-slate-800">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-800 flex items-center justify-center text-2xl mb-3">
              📄
            </div>
            <h3 className="text-base font-bold text-white">No documents in queue</h3>
            <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
              No files have been uploaded yet. Scan the station QR code to upload documents.
            </p>
          </Card>
        )}

        {!loading && files.length > 0 && filteredFiles.length === 0 && (
          <Card className="p-12 text-center border-dashed bg-slate-900/50 border-slate-800">
            <p className="text-sm text-slate-400 font-medium">No documents match the "{activeTab.toLowerCase()}" filter.</p>
          </Card>
        )}

        <div className="space-y-3.5">
          {filteredFiles.map((file) => {
            const job = jobsByFileId[file.id];
            const isActioning = actioningId === file.id || actioningId === job?.id;

            return (
              <Card
                key={file.id}
                hoverable
                className="p-4 sm:p-6 rounded-2xl bg-slate-900/90 border border-slate-700/80 backdrop-blur-xl flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5 shadow-[0_12px_36px_rgba(0,0,0,0.45)] hover:border-slate-600 transition-all"
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  <FileIcon mimeType={file.mimeType} />

                  <div className="min-w-0 flex-1">
                    <p className="text-base sm:text-lg font-bold text-white truncate" title={file.originalName}>
                      {file.originalName}
                    </p>
                    <p className="text-xs text-slate-300 mt-1 font-mono flex items-center gap-2">
                      <span className="text-emerald-400 font-semibold">{formatBytes(file.sizeBytes)}</span>
                      <span>·</span>
                      <span>{formatRelativeTime(file.uploadedAt)}</span>
                      {file.duplicateOf && (
                        <span className="text-amber-300 font-semibold bg-amber-950/60 border border-amber-800/60 px-2 py-0.5 rounded text-[11px]">
                          Duplicate
                        </span>
                      )}
                    </p>
                    {job && (
                      <p className="text-xs text-slate-300 mt-1.5 flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-rose-300 bg-rose-950/50 border border-rose-800/40 px-2.5 py-0.5 rounded-md font-mono">
                          🖨️ {job.printerName}
                        </span>
                        <span>·</span>
                        <span className="text-slate-300">{jobSettingsSummary(job)}</span>
                      </p>
                    )}
                    {job?.failure_code && (
                      <p className="text-xs text-rose-300 font-semibold mt-1.5 bg-rose-950/60 border border-rose-800/80 px-3 py-1 rounded-lg inline-block">
                        ⚠️ Failure: {job.failure_code}
                        {job.completed_pages ? ` (${job.completed_pages} pages printed)` : ''}
                      </p>
                    )}
                    {job?.errorMessage && !job?.failure_code && (
                      <p className="text-xs text-rose-300 mt-1.5 bg-rose-950/60 border border-rose-800/80 px-3 py-1 rounded-lg">
                        {job.errorMessage}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap w-full sm:w-auto justify-end sm:justify-start pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-800">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPreviewFile(file)}
                    className="text-xs font-semibold px-3 py-2 bg-slate-800/90 hover:bg-slate-750 text-white border-slate-700 shadow-xs flex-1 sm:flex-initial"
                  >
                    👁️ Preview
                  </Button>

                  {job && <StatusBadge status={job.status} />}

                  {!job && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => setPrintFile(file)}
                        className="text-xs font-bold px-4 py-2 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white shadow-md shadow-rose-600/30"
                      >
                        🖨️ Print
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleWithdrawFile(file)}
                        disabled={isActioning}
                        className="text-xs font-semibold px-3 py-2 text-rose-300 hover:text-white hover:bg-rose-950/50 border border-rose-800/50"
                      >
                        🗑️ Withdraw
                      </Button>
                    </>
                  )}

                  {/* Awaiting Physical Verification Controls */}
                  {job?.status === 'AWAITING_VERIFICATION' && (
                    <div className="flex items-center gap-2 bg-amber-950/60 p-1.5 rounded-xl border border-amber-500/40">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleVerifySuccess(job)}
                        disabled={isActioning}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-1.5 shadow-xs"
                      >
                        ✓ Verified
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setFailureModalJob(job);
                          setFailureCode('PAPER_JAM');
                          setFailureCompletedPages(job.completed_pages || 0);
                          setFailureNotes('');
                        }}
                        disabled={isActioning}
                        className="text-rose-300 border-rose-800/80 bg-rose-950/40 hover:bg-rose-900/60 text-xs font-semibold px-3 py-1.5"
                      >
                        ✕ Failed
                      </Button>
                    </div>
                  )}

                  {/* Failed Print Recovery Controls */}
                  {job?.status === 'FAILED' && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {job.completed_pages > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRetryRemaining(job)}
                          disabled={isActioning}
                          title={`Resume printing from page ${job.completed_pages + 1}`}
                          className="text-xs font-bold text-slate-200 border-slate-700 hover:bg-slate-800"
                        >
                          Resume ({job.completed_pages}p done)
                        </Button>
                      )}
                      <Button
                        variant="seal"
                        size="sm"
                        onClick={() => handleRestart(job)}
                        disabled={isActioning}
                        className="text-xs font-bold"
                      >
                        🔄 Restart
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenSwitch(job)}
                        disabled={isActioning}
                        className="text-xs font-semibold text-slate-200 border-slate-700 hover:bg-slate-800"
                      >
                        🔀 Switch Printer
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCancel(job)}
                        disabled={isActioning}
                        className="text-xs text-rose-300 hover:bg-rose-950/50 border border-rose-800/40"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}

                  {job?.status === 'PENDING' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancel(job)}
                      disabled={isActioning}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Cancel
                    </Button>
                  )}

                  {job && ACTIVE_STATUSES.includes(job.status) && job.status !== 'PENDING' && (
                    <span className="text-xs text-amber-300 font-mono font-bold animate-pulse">printing…</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Operator Physical Failure Reporting Modal */}
      {failureModalJob && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 px-4">
          <div className="bg-slate-900/95 border border-slate-800 text-slate-100 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 fade-up">
            <h3 className="text-base font-bold text-white">Report Physical Print Failure</h3>
            <p className="text-xs text-slate-400">
              Reporting a failure preserves the document on the server and allows retry or printer switching.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">
                Failure Reason
              </label>
              <select
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-rose-500"
                value={failureCode}
                onChange={(e) => setFailureCode(e.target.value)}
              >
                {FAILURE_CODES.map((fc) => (
                  <option key={fc.code} value={fc.code}>
                    {fc.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">
                Completed Pages (Partial Print, 0 if none)
              </label>
              <input
                type="number"
                min="0"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-rose-500"
                value={failureCompletedPages}
                onChange={(e) => setFailureCompletedPages(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">
                Notes
              </label>
              <input
                type="text"
                placeholder="Optional operator notes"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-rose-500"
                value={failureNotes}
                onChange={(e) => setFailureNotes(e.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setFailureModalJob(null)} className="text-slate-400 hover:text-white">
                Cancel
              </Button>
              <Button variant="seal" size="sm" onClick={handleConfirmFailure}>
                Submit Failure Report
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Switch Printer Modal */}
      {switchModalJob && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 px-4">
          <div className="bg-slate-900/95 border border-slate-800 text-slate-100 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4 fade-up">
            <h3 className="text-base font-bold text-white">Switch Printer & Resume</h3>
            <p className="text-xs text-slate-400">
              Transfer job to an alternative active printer without requiring the customer to re-upload.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 uppercase tracking-wider">
                Target Printer
              </label>
              <select
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-rose-500"
                value={targetPrinterId}
                onChange={(e) => setTargetPrinterId(e.target.value)}
              >
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setSwitchModalJob(null)} className="text-slate-400 hover:text-white">
                Cancel
              </Button>
              <Button variant="seal" size="sm" onClick={handleConfirmSwitch}>
                Switch & Print
              </Button>
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <FilePreview
          fileId={previewFile.id}
          mimeType={previewFile.mimeType}
          originalName={previewFile.originalName}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {printFile && (
        <PrintDialog file={printFile} onClose={() => setPrintFile(null)} onQueued={handleQueued} />
      )}
    </div>
  );
}
