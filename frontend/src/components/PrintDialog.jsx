import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPrinters, refreshPrinters, getCompatiblePrinters } from '../services/printerApi';
import {
  createPrintJob,
  getPrintJob,
  verifyPrintJob,
  retryRemainingPrintJob,
  restartEntirePrintJob,
  switchPrinterJob,
  cancelPrintJob,
} from '../services/printJobApi';
import { useQueueSocket } from '../hooks/useQueueSocket';
import DocumentPreviewPane from './DocumentPreviewPane';
import ConnectPrinterModal from './ConnectPrinterModal';
import Button from './ui/Button';

const CUSTOM_RANGE_PATTERN = /^(\d+(-\d+)?)(,\d+(-\d+)?)*$/;

const FAILURE_CODES = [
  { code: 'PAPER_JAM', label: 'Paper Jam', description: 'Paper is jammed in the feed or rollers' },
  { code: 'OUT_OF_PAPER', label: 'Out of Paper', description: 'Paper tray empty or feed failed' },
  { code: 'LOW_TONER', label: 'Low Toner / Ink', description: 'Toner or ink ran out mid-job' },
  { code: 'COVER_OPEN', label: 'Cover / Door Open', description: 'Printer door was opened' },
  { code: 'OFFLINE', label: 'Printer Offline', description: 'Printer powered off or disconnected' },
  { code: 'COMMUNICATION_ERROR', label: 'Communication Error', description: 'Connection dropped during print' },
  { code: 'SPOOLER_TIMEOUT', label: 'Spooler Timeout', description: 'Spooler response timed out' },
  { code: 'OTHER', label: 'Other Failure', description: 'Miscellaneous mechanical or print error' },
];

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

function StatusDot({ status }) {
  const color =
    status === 'READY'
      ? 'bg-sage'
      : status === 'BUSY' || status === 'PRINTING'
      ? 'bg-amber'
      : 'bg-ink/25';
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />;
}

function PrinterIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M6 9V4h12v5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="9" width="16" height="7" rx="1" />
      <path d="M6 16v4h12v-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StepDots({ step }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`h-1.5 rounded-full transition-all ${
          step === 'configure' ? 'w-5 bg-seal' : 'w-1.5 bg-ink/15'
        }`}
      />
      <span
        className={`h-1.5 rounded-full transition-all ${
          step === 'preview' ? 'w-5 bg-seal' : 'w-1.5 bg-ink/15'
        }`}
      />
      <span
        className={`h-1.5 rounded-full transition-all ${
          step === 'printing' ? 'w-5 bg-seal' : 'w-1.5 bg-ink/15'
        }`}
      />
    </div>
  );
}

const selectCls =
  'w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none transition-all focus:border-rose-500/60 focus:ring-2 focus:ring-rose-500/20 cursor-pointer';

export default function PrintDialog({ file, onClose, onQueued }) {
  const navigate = useNavigate();
  const [step, setStep] = useState('configure'); // configure | preview | printing
  const [printers, setPrinters] = useState([]);
  const [printersLoading, setPrintersLoading] = useState(true);
  const [printersError, setPrintersError] = useState(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);

  // Print settings
  const [printerId, setPrinterId] = useState(null);
  const [copies, setCopies] = useState(1);
  const [pageRangeMode, setPageRangeMode] = useState('all'); // all | current | custom
  const [customRange, setCustomRange] = useState('');
  const [paperSize, setPaperSize] = useState('A4');
  const [orientation, setOrientation] = useState('portrait');
  const [colorMode, setColorMode] = useState('bw');
  const [sides, setSides] = useState('single'); // single | duplex-long-edge | duplex-short-edge
  const [pagesPerSheet, setPagesPerSheet] = useState(1);
  const [scaleMode, setScaleMode] = useState('fit'); // fit | actual | shrink | custom
  const [customScalePercent, setCustomScalePercent] = useState('100');
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  // Job submission & progress state
  const [activeJob, setActiveJob] = useState(null);
  const [jobStatus, setJobStatus] = useState('PENDING'); // PENDING | PROCESSING | PRINTING | SPOOLER_COMPLETED | AWAITING_VERIFICATION | COMPLETED | FAILED | CANCELLED
  const [jobProgress, setJobProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [duplicateBlock, setDuplicateBlock] = useState(null);

  // Physical verification & failure handling state
  const [showFailureForm, setShowFailureForm] = useState(false);
  const [failureCode, setFailureCode] = useState('PAPER_JAM');
  const [failureCompletedPages, setFailureCompletedPages] = useState(0);
  const [failureNotes, setFailureNotes] = useState('');
  const [isSwitchingPrinter, setIsSwitchingPrinter] = useState(false);
  const [switchTargetPrinterId, setSwitchTargetPrinterId] = useState('');
  const [compatiblePrinters, setCompatiblePrinters] = useState([]);

  const isPdf = file.mimeType === 'application/pdf';

  const activeJobRef = useRef(activeJob);
  useEffect(() => {
    activeJobRef.current = activeJob;
  }, [activeJob]);

  const handleJobSocketUpdate = useCallback((job) => {
    if (!job || !activeJobRef.current || job.id !== activeJobRef.current.id) return;
    setActiveJob(job);
    setJobStatus(job.status);
    if (job.status === 'PRINTING') setJobProgress(60);
    else if (job.status === 'SPOOLER_COMPLETED') setJobProgress(85);
    else if (job.status === 'AWAITING_VERIFICATION') setJobProgress(95);
    else if (job.status === 'COMPLETED') setJobProgress(100);
  }, []);

  useQueueSocket(handleJobSocketUpdate);

  // Polling fallback when printing is active
  useEffect(() => {
    if (!activeJob?.id || step !== 'printing') return;
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(jobStatus)) return;

    const interval = setInterval(async () => {
      try {
        const latest = await getPrintJob(activeJob.id);
        if (latest) {
          setActiveJob(latest);
          setJobStatus(latest.status);
          if (latest.status === 'PRINTING') {
            setJobProgress((prev) => Math.min(prev + 10, 75));
          } else if (latest.status === 'SPOOLER_COMPLETED') {
            setJobProgress(85);
          } else if (latest.status === 'AWAITING_VERIFICATION') {
            setJobProgress(95);
          } else if (latest.status === 'COMPLETED') {
            setJobProgress(100);
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeJob?.id, step, jobStatus]);

  // Load real printers from backend
  const loadPrintersList = async (isRefresh = false) => {
    setPrintersLoading(true);
    setPrintersError(null);
    try {
      const list = isRefresh ? await refreshPrinters() : await listPrinters();
      const validList = Array.isArray(list) && list.length > 0 ? list : [DEFAULT_DEMO_PRINTER];
      setPrinters(validList);
      if (!printerId && validList.length > 0) {
        const defaultPrinter =
          validList.find((p) => p.isDefault && p.status === 'READY') ||
          validList.find((p) => p.isDefault) ||
          validList.find((p) => p.status === 'READY') ||
          validList[0];
        if (defaultPrinter) setPrinterId(defaultPrinter.id);
      }
    } catch {
      setPrinters([DEFAULT_DEMO_PRINTER]);
      if (!printerId) setPrinterId(DEFAULT_DEMO_PRINTER.id);
    } finally {
      setPrintersLoading(false);
    }
  };

  useEffect(() => {
    loadPrintersList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPrinter = useMemo(
    () => printers.find((p) => p.id === printerId) || null,
    [printers, printerId]
  );

  // Dynamically adapt settings to selected printer's actual capabilities
  useEffect(() => {
    if (!selectedPrinter) return;
    const caps = selectedPrinter.capabilities || {};
    if (caps.paperSizes && caps.paperSizes.length && !caps.paperSizes.includes(paperSize)) {
      setPaperSize(caps.paperSizes[0] || 'A4');
    }
    if (caps.color === false) {
      setColorMode('bw');
    }
    if (caps.duplex === false && sides !== 'single') {
      setSides('single');
    }
    if (copies > (caps.maxCopies || 99)) {
      setCopies(caps.maxCopies || 99);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printerId]);

  function resolvedPageRange() {
    if (pageRangeMode === 'custom') return customRange.trim();
    return pageRangeMode;
  }

  function resolvedScale() {
    if (scaleMode === 'custom') return `${customScalePercent}%`;
    return scaleMode;
  }

  function validateBeforePreview() {
    if (!printerId) return 'Please select a printer.';
    if (selectedPrinter?.status === 'OFFLINE') {
      return `${selectedPrinter.name} is offline. Please select an active printer.`;
    }
    if (pageRangeMode === 'custom' && !CUSTOM_RANGE_PATTERN.test(customRange.trim())) {
      return 'Custom page range must look like "1-3,5" or "1-5,8".';
    }
    if (scaleMode === 'custom') {
      const num = parseInt(customScalePercent, 10);
      if (isNaN(num) || num < 10 || num > 400) {
        return 'Custom scale must be between 10% and 400%.';
      }
    }
    return null;
  }

  function goToPreview() {
    const err = validateBeforePreview();
    if (err) {
      setSubmitError(err);
      return;
    }
    setSubmitError(null);
    setStep('preview');
  }

  async function handleConfirmPrint({ force = false } = {}) {
    setSubmitting(true);
    setSubmitError(null);
    setDuplicateBlock(null);

    const isDuplex = sides !== 'single';

    try {
      const job = await createPrintJob(file.id, {
        printerId,
        force,
        copies,
        pageRange: resolvedPageRange(),
        paperSize,
        orientation,
        colorMode,
        duplex: isDuplex,
        sides,
        pagesPerSheet,
        scale: resolvedScale(),
      });

      if (onQueued) onQueued(job);
      onClose();
      navigate('/queue');
    } catch (err) {
      if (err.details?.duplicateJobId) {
        setDuplicateBlock({ message: err.message });
      } else {
        setSubmitError(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifySuccess() {
    if (!activeJob?.id) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await verifyPrintJob(activeJob.id, { verified: true });
      setActiveJob(updated);
      setJobStatus('COMPLETED');
      setJobProgress(100);
      if (onQueued) onQueued(updated);
    } catch (err) {
      setSubmitError(err.message || 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyFailure() {
    if (!activeJob?.id) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await verifyPrintJob(activeJob.id, {
        verified: false,
        failureCode,
        completedPages: Math.max(0, parseInt(failureCompletedPages, 10) || 0),
        notes: failureNotes.trim() || undefined,
      });
      setActiveJob(updated);
      setJobStatus('FAILED');
      setShowFailureForm(false);
      if (onQueued) onQueued(updated);
    } catch (err) {
      setSubmitError(err.message || 'Failed to submit failure report');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetryRemaining() {
    if (!activeJob?.id) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const pagesDone = activeJob.completed_pages || failureCompletedPages || 0;
      const updated = await retryRemainingPrintJob(activeJob.id, {
        completedPages: pagesDone,
        printerId: switchTargetPrinterId || activeJob.printer_id || printerId,
      });
      setActiveJob(updated);
      setJobStatus(updated.status);
      setJobProgress(30);
      if (onQueued) onQueued(updated);
    } catch (err) {
      setSubmitError(err.message || 'Retry remaining failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRestartEntire() {
    if (!activeJob?.id) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await restartEntirePrintJob(activeJob.id, {
        printerId: switchTargetPrinterId || activeJob.printer_id || printerId,
      });
      setActiveJob(updated);
      setJobStatus(updated.status);
      setJobProgress(30);
      if (onQueued) onQueued(updated);
    } catch (err) {
      setSubmitError(err.message || 'Restart failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOpenSwitchPrinter() {
    setIsSwitchingPrinter(true);
    try {
      const res = await getCompatiblePrinters({
        fileId: file.id,
        paperSize,
        colorMode,
        duplex: sides !== 'single',
      });
      const compatible = res.compatiblePrinters || [];
      setCompatiblePrinters(compatible);
      const other = compatible.find((p) => p.id !== (activeJob?.printer_id || printerId));
      if (other) {
        setSwitchTargetPrinterId(other.id);
      } else if (compatible.length > 0) {
        setSwitchTargetPrinterId(compatible[0].id);
      }
    } catch {
      const fallback = printers.filter((p) => p.id !== (activeJob?.printer_id || printerId));
      setCompatiblePrinters(fallback);
      if (fallback.length > 0) setSwitchTargetPrinterId(fallback[0].id);
    }
  }

  async function handleConfirmSwitchPrinter() {
    if (!activeJob?.id || !switchTargetPrinterId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await switchPrinterJob(activeJob.id, {
        newPrinterId: switchTargetPrinterId,
      });
      setActiveJob(updated);
      setJobStatus(updated.status);
      setJobProgress(30);
      setIsSwitchingPrinter(false);
      if (onQueued) onQueued(updated);
    } catch (err) {
      setSubmitError(err.message || 'Failed to switch printer');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelJob() {
    if (!activeJob?.id) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await cancelPrintJob(activeJob.id);
      setActiveJob(updated);
      setJobStatus(updated.status);
      if (onQueued) onQueued(updated);
    } catch (err) {
      setSubmitError(err.message || 'Cancel failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900/95 border border-slate-700/80 text-slate-100 rounded-2xl sm:rounded-3xl w-full max-w-[95vw] sm:max-w-lg max-h-[94vh] overflow-y-auto p-4 sm:p-6 shadow-[0_20px_60px_rgba(0,0,0,0.7)] backdrop-blur-xl fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-1 pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 shrink-0">
              <PrinterIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold tracking-tight text-ink">Print Document</h2>
              <p className="text-xs text-slate-500 truncate max-w-[240px]">{file.originalName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors text-sm p-1 rounded-md"
          >
            ✓
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex justify-center my-4">
          <StepDots step={step} />
        </div>

        {/* ================= STEP 1: CONFIGURE ================= */}
        {step === 'configure' && (
          <div className="space-y-4">
            {printersLoading && (
              <div className="py-8 text-center">
                <div className="w-6 h-6 mx-auto rounded-full border-2 border-slate-700 border-t-seal animate-spin" />
                <p className="mt-2 text-xs text-slate-500">Detecting system printers…</p>
              </div>
            )}

            {printersError && (
              <p className="text-sm text-seal bg-seal-dim/60 rounded-lg px-3 py-2 border border-seal/20">
                {printersError}
              </p>
            )}

            {!printersLoading && (
              <>
                {/* PRINTER SELECTION & ACTIONS */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-mono uppercase tracking-wide text-slate-400">
                      Printer
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => loadPrintersList(true)}
                        className="text-xs text-slate-400 hover:text-white underline transition-colors"
                        title="Rescan connected printers"
                      >
                        ↺ Refresh
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsConnectModalOpen(true)}
                        className="text-xs text-seal font-semibold hover:underline transition-colors"
                      >
                        + Add Printer
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {printers.map((p) => (
                      <label
                        key={p.id}
                        className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-sm cursor-pointer transition-all ${
                          p.status === 'OFFLINE'
                            ? 'border-ink/[0.06] text-ink/35 cursor-not-allowed bg-paper/50'
                            : printerId === p.id
                            ? 'border-seal bg-seal-dim/30 shadow-xs'
                            : 'border-slate-700 hover:border-ink/25 hover:bg-ink/[0.015]'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <input
                            type="radio"
                            name="printer"
                            checked={printerId === p.id}
                            disabled={p.status === 'OFFLINE'}
                            onChange={() => setPrinterId(p.id)}
                            className="accent-seal"
                          />
                          <span
                            className={`truncate ${
                              printerId === p.id ? 'font-semibold text-ink' : 'text-ink/80'
                            }`}
                          >
                            {p.name}
                          </span>
                          {(p.isDemo || p.id === 'demo-smartprint-laserjet') && (
                            <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded font-mono font-bold">
                              DEMO
                            </span>
                          )}
                          {p.isDefault && (
                            <span className="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded font-mono text-slate-400">
                              default
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs font-mono shrink-0">
                          <StatusDot status={p.status} />
                          <span className={p.status === 'READY' ? 'text-sage-dark font-medium' : 'text-slate-500'}>
                            {p.status}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {selectedPrinter && (
                  <>
                    {/* COPIES */}
                    <div className="flex items-center justify-between py-1">
                      <label className="text-[11px] font-mono uppercase tracking-wide text-slate-400">
                        Copies
                      </label>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setCopies((c) => Math.max(1, c - 1))}
                          className="w-7 h-7 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white font-semibold transition-colors"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm font-mono font-semibold text-white">
                          {copies}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setCopies((c) => Math.min(selectedPrinter.capabilities?.maxCopies || 99, c + 1))
                          }
                          className="w-7 h-7 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white font-semibold transition-colors"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* BASIC GRID: PAPER SIZE, ORIENTATION, SIDES */}
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-mono uppercase tracking-wide text-slate-400 mb-1.5">
                          Paper Size
                        </label>
                        <select
                          value={paperSize}
                          onChange={(e) => setPaperSize(e.target.value)}
                          className={selectCls}
                        >
                          {(selectedPrinter.capabilities?.paperSizes?.length
                            ? selectedPrinter.capabilities.paperSizes
                            : ['A4', 'Letter']
                          ).map((sz) => (
                            <option key={sz} value={sz}>
                              {sz}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-mono uppercase tracking-wide text-slate-400 mb-1.5">
                          Orientation
                        </label>
                        <select
                          value={orientation}
                          onChange={(e) => setOrientation(e.target.value)}
                          className={selectCls}
                        >
                          <option value="portrait">Portrait</option>
                          <option value="landscape">Landscape</option>
                        </select>
                      </div>
                    </div>

                    {/* DUPLEX / SIDES */}
                    <div>
                      <label className="block text-[11px] font-mono uppercase tracking-wide text-slate-400 mb-1.5">
                        Sides
                      </label>
                      {selectedPrinter.capabilities?.duplex ? (
                        <select
                          value={sides}
                          onChange={(e) => setSides(e.target.value)}
                          className={selectCls}
                        >
                          <option value="single">Single-sided</option>
                          <option value="duplex-long-edge">Double-sided — Long Edge</option>
                          <option value="duplex-short-edge">Double-sided — Short Edge</option>
                        </select>
                      ) : (
                        <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/60 text-xs text-slate-400 flex items-center justify-between">
                          <span>Single-sided</span>
                          <span className="text-[11px] text-amber-dark font-medium">
                            Duplex not supported by this printer
                          </span>
                        </div>
                      )}
                    </div>

                    {/* EXPANDABLE "MORE PRINT OPTIONS" */}
                    <div className="pt-1 border-t border-slate-700/60">
                      <button
                        type="button"
                        onClick={() => setShowMoreOptions(!showMoreOptions)}
                        className="flex items-center justify-between w-full py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          <span>⚙️ More Print Options</span>
                          {showMoreOptions ? '▲' : '▼'}
                        </span>
                        <span className="text-[11px] font-normal text-slate-500">
                          Color, Pages Per Sheet, Scaling, Range
                        </span>
                      </button>

                      {showMoreOptions && (
                        <div className="space-y-3.5 pt-2.5 pb-1 fade-up">
                          {/* COLOR MODE */}
                          <div>
                            <label className="block text-[11px] font-mono uppercase tracking-wide text-slate-400 mb-1.5">
                              Color
                            </label>
                            {selectedPrinter.capabilities?.color ? (
                              <div className="grid grid-cols-2 gap-2">
                                <label
                                  className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer ${
                                    colorMode === 'bw'
                                      ? 'border-seal bg-seal/5 font-semibold text-seal'
                                      : 'border-slate-700 text-slate-300'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="colorMode"
                                    checked={colorMode === 'bw'}
                                    onChange={() => setColorMode('bw')}
                                    className="accent-seal"
                                  />
                                  Black &amp; White / Grayscale
                                </label>
                                <label
                                  className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer ${
                                    colorMode === 'color'
                                      ? 'border-seal bg-seal/5 font-semibold text-seal'
                                      : 'border-slate-700 text-slate-300'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="colorMode"
                                    checked={colorMode === 'color'}
                                    onChange={() => setColorMode('color')}
                                    className="accent-seal"
                                  />
                                  Full Color
                                </label>
                              </div>
                            ) : (
                              <div className="p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/60 text-xs text-slate-400 flex items-center justify-between">
                                <span>Black &amp; White Only</span>
                                <span className="text-[11px] text-slate-500">
                                  Color printing not supported by printer
                                </span>
                              </div>
                            )}
                          </div>

                          {/* PAGES PER SHEET & SCALING */}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-mono uppercase tracking-wide text-slate-400 mb-1.5">
                                Pages Per Sheet
                              </label>
                              <select
                                value={pagesPerSheet}
                                onChange={(e) => setPagesPerSheet(parseInt(e.target.value, 10))}
                                className={selectCls}
                              >
                                <option value={1}>1 page per sheet</option>
                                <option value={2}>2 pages per sheet (2-up)</option>
                                <option value={4}>4 pages per sheet (4-up)</option>
                                <option value={6}>6 pages per sheet (6-up)</option>
                                <option value={9}>9 pages per sheet (9-up)</option>
                                <option value={16}>16 pages per sheet (16-up)</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-[11px] font-mono uppercase tracking-wide text-slate-400 mb-1.5">
                                Scaling
                              </label>
                              <select
                                value={scaleMode}
                                onChange={(e) => setScaleMode(e.target.value)}
                                className={selectCls}
                              >
                                <option value="fit">Fit to page</option>
                                <option value="actual">Actual size (100%)</option>
                                <option value="shrink">Shrink to printable area</option>
                                <option value="custom">Custom percentage</option>
                              </select>
                            </div>
                          </div>

                          {scaleMode === 'custom' && (
                            <div>
                              <label className="block text-[11px] font-mono uppercase tracking-wide text-slate-400 mb-1">
                                Custom Scale Percentage (10% - 400%)
                              </label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  min="10"
                                  max="400"
                                  value={customScalePercent}
                                  onChange={(e) => setCustomScalePercent(e.target.value)}
                                  className="w-24 rounded-lg border border-slate-600 bg-slate-800 text-white px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-rose-500/30"
                                />
                                <span className="text-sm text-slate-400">%</span>
                              </div>
                            </div>
                          )}

                          {/* PAGE RANGE */}
                          <div>
                            <label className="block text-[11px] font-mono uppercase tracking-wide text-slate-400 mb-1.5">
                              Pages
                              {!isPdf && (
                                <span className="ml-2 normal-case font-normal text-amber-400/80">(best-effort for non-PDF)</span>
                              )}
                            </label>
                            <div className="flex items-center gap-4 text-xs text-slate-300">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  checked={pageRangeMode === 'all'}
                                  onChange={() => setPageRangeMode('all')}
                                  className="accent-seal"
                                />
                                All pages
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  checked={pageRangeMode === 'current'}
                                  onChange={() => setPageRangeMode('current')}
                                  className="accent-seal"
                                />
                                Current page
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="radio"
                                  checked={pageRangeMode === 'custom'}
                                  onChange={() => setPageRangeMode('custom')}
                                  className="accent-seal"
                                />
                                Custom range
                              </label>
                            </div>
                            {pageRangeMode === 'custom' && (
                              <input
                                type="text"
                                placeholder="e.g. 1-3, 5, 8-10"
                                value={customRange}
                                onChange={(e) => setCustomRange(e.target.value)}
                                className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-800 text-white placeholder-slate-500 px-3 py-1.5 text-sm outline-none focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
                              />
                            )}
                            {pageRangeMode === 'custom' && isPdf && (
                              <p className="mt-1 text-[10px] text-slate-500">
                                Tip: Format like <span className="font-mono text-slate-400">1-3, 5, 8-10</span>. PDF pages will be sliced before sending to printer.
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {submitError && (
              <p className="text-xs text-seal bg-seal-dim rounded-lg px-3 py-2 border border-seal/20">
                {submitError}
              </p>
            )}

            {/* ACTION BUTTONS */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-700/60">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={goToPreview} disabled={!selectedPrinter || selectedPrinter.status === 'OFFLINE'}>
                Preview →
              </Button>
            </div>
          </div>
        )}

        {/* ================= STEP 2: PREVIEW ================= */}
        {step === 'preview' && selectedPrinter && (
          <div className="space-y-4">
            <DocumentPreviewPane
              fileId={file.id}
              mimeType={file.mimeType}
              colorMode={colorMode}
              orientation={orientation}
              paperSize={paperSize}
              pagesPerSheet={pagesPerSheet}
              scale={resolvedScale()}
            />

            {/* Print Settings Summary Card */}
            <div className="rounded-xl bg-paper p-3 text-xs text-slate-300 space-y-1 font-mono border border-slate-700/60">
              <div className="flex justify-between">
                <span className="text-slate-500">Printer:</span>
                <span className="font-semibold text-ink">{selectedPrinter.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Copies:</span>
                <span className="font-semibold text-ink">{copies}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Layout:</span>
                <span className="text-white">
                  {paperSize} · {orientation} · {sides === 'single' ? '1-Sided' : '2-Sided (Duplex)'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Color:</span>
                <span className="text-white">{colorMode === 'color' ? 'Full Color' : 'Black & White'}</span>
              </div>
              {pagesPerSheet > 1 && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Pages/Sheet:</span>
                  <span className="text-seal font-semibold">{pagesPerSheet} per sheet</span>
                </div>
              )}
            </div>

            {duplicateBlock && (
              <div className="rounded-xl bg-amber-dim px-4 py-3 text-xs text-amber-dark border border-amber/20">
                {duplicateBlock.message}{' '}
                <button
                  onClick={() => handleConfirmPrint({ force: true })}
                  className="underline font-semibold hover:opacity-80 ml-1"
                >
                  Print anyway
                </button>
              </div>
            )}

            {submitError && !duplicateBlock && (
              <p className="text-xs text-seal bg-seal-dim rounded-lg px-3 py-2 border border-seal/20">
                {submitError}
              </p>
            )}

            <div className="flex justify-between items-center pt-3 mt-2 border-t border-slate-700/60 flex-wrap gap-2.5">
              <Button
                variant="outline"
                size="md"
                onClick={() => setStep('configure')}
                className="text-sm font-semibold text-slate-200 hover:text-white px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 border-slate-600 rounded-xl"
              >
                ← Change Settings
              </Button>
              <div className="flex items-center gap-2.5">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={onClose}
                  className="text-sm font-semibold text-slate-300 hover:text-white px-4 py-2.5 rounded-xl border border-transparent hover:bg-slate-800"
                >
                  Cancel
                </Button>
                <Button
                  variant="seal"
                  size="lg"
                  onClick={() => handleConfirmPrint()}
                  disabled={submitting}
                  className="text-base font-bold px-6 py-3 shadow-lg shadow-rose-950/60 rounded-xl active:scale-[0.98]"
                >
                  {submitting ? 'Submitting…' : '🖨️ Final Print Now'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 3: REAL-TIME PRINTING STATUS & VERIFICATION ================= */}
        {step === 'printing' && (
          <div className="py-4 text-center space-y-5 fade-up">
            {['PENDING', 'PROCESSING', 'PRINTING'].includes(jobStatus) && (
              <>
                <div className="w-12 h-12 mx-auto rounded-2xl bg-seal/10 flex items-center justify-center text-seal animate-pulse">
                  <PrinterIcon className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Printing in progress…</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Sending to <span className="font-semibold text-ink">{selectedPrinter?.name}</span>
                  </p>
                </div>
                <div className="w-full bg-slate-700/40 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-seal h-full rounded-full transition-all duration-500"
                    style={{ width: `${jobProgress}%` }}
                  />
                </div>
                <div className="text-xs text-slate-400 flex justify-between font-mono px-1">
                  <span>Spooling document</span>
                  <span>{jobProgress}%</span>
                </div>
              </>
            )}

            {jobStatus === 'SPOOLER_COMPLETED' && (
              <div className="space-y-4">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-amber/10 flex items-center justify-center text-amber animate-spin">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Spooler Completed</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                    Data sent to printer queue. Waiting for physical delivery from printer tray…
                  </p>
                </div>
                <div className="w-full bg-slate-700/40 rounded-full h-2 overflow-hidden">
                  <div className="bg-amber h-full rounded-full w-4/5 animate-pulse" />
                </div>
              </div>
            )}

            {jobStatus === 'AWAITING_VERIFICATION' && (
              <div className="space-y-4 text-left bg-paper p-5 rounded-2xl border border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-dim flex items-center justify-center text-amber-dark font-bold text-lg shrink-0">
                    📋
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-ink">Physical Print Confirmation</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Windows spooler reported completion. Please inspect the printer output tray.
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-slate-800 rounded-xl border border-slate-700/60 text-xs text-slate-200">
                  Did <span className="font-semibold text-white">{file.originalName}</span> physically print completely and correctly on <span className="font-semibold text-white">{selectedPrinter?.name}</span>?
                </div>

                {submitError && (
                  <p className="text-xs text-seal bg-seal-dim rounded-lg px-3 py-2 border border-seal/20">
                    {submitError}
                  </p>
                )}

                {!showFailureForm ? (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <Button
                      variant="ghost"
                      onClick={handleVerifySuccess}
                      disabled={submitting}
                      className="w-full bg-emerald-600 hover:bg-emerald-500 text-white border-transparent justify-center font-semibold"
                    >
                      {submitting ? 'Verifying…' : '✅ Printed Successfully'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowFailureForm(true)}
                      disabled={submitting}
                      className="w-full border-seal/40 text-seal hover:bg-seal-dim justify-center"
                    >
                      ✓ Printing Failed
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3 pt-2 border-t border-slate-700/60">
                    <div>
                      <label className="block text-xs font-semibold text-ink mb-1">Failure Reason</label>
                      <select
                        className={selectCls}
                        value={failureCode}
                        onChange={(e) => setFailureCode(e.target.value)}
                      >
                        {FAILURE_CODES.map((fc) => (
                          <option key={fc.code} value={fc.code}>
                            {fc.label} — {fc.description}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-ink mb-1">
                        Completed Pages (if partial print, 0 if none)
                      </label>
                      <input
                        type="number"
                        min="0"
                        className={selectCls}
                        value={failureCompletedPages}
                        onChange={(e) => setFailureCompletedPages(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-ink mb-1">
                        Operator Notes (optional)
                      </label>
                      <input
                        type="text"
                        className={selectCls}
                        placeholder="e.g. jammed midway during page 3"
                        value={failureNotes}
                        onChange={(e) => setFailureNotes(e.target.value)}
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowFailureForm(false)}
                        disabled={submitting}
                      >
                        Back
                      </Button>
                      <Button
                        variant="seal"
                        size="sm"
                        onClick={handleVerifyFailure}
                        disabled={submitting}
                      >
                        {submitting ? 'Submitting…' : 'Confirm Failure & Retain File'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {jobStatus === 'COMPLETED' && (
              <div className="space-y-4">
                <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 text-2xl font-bold">
                  ✅
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">Printing Successful &amp; File Removed</h3>
                  <p className="text-xs text-slate-300 mt-1.5 max-w-sm mx-auto leading-relaxed">
                    <span className="font-semibold text-white">{file.originalName}</span> physically printed successfully on{' '}
                    <span className="font-semibold text-white">{selectedPrinter?.name}</span>.
                  </p>
                </div>
                <div className="p-3.5 bg-emerald-950/60 rounded-xl text-xs text-emerald-300 font-medium border border-emerald-800/80">
                  🔒 Zero-Trace Shredding: Document has been verified and permanently wiped from the station.
                </div>
                <div className="pt-2">
                  <Button
                    variant="seal"
                    size="md"
                    onClick={() => {
                      if (onQueued) onQueued({ fileId: file.id, id: activeJob?.id, status: 'COMPLETED' });
                      onClose();
                    }}
                    className="w-full py-3 text-sm font-bold shadow-md shadow-rose-950/50"
                  >
                    Done (File Removed)
                  </Button>
                </div>
              </div>
            )}

            {jobStatus === 'FAILED' && (
              <div className="space-y-4 text-left">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-seal-dim flex items-center justify-center text-seal font-bold text-lg shrink-0">
                    ✓
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-seal">Print Job Failed</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="px-2 py-0.5 bg-seal-dim text-seal rounded font-mono text-[11px] font-semibold">
                        {activeJob?.failure_code || failureCode || 'UNKNOWN'}
                      </span>
                      {(activeJob?.completed_pages > 0 || failureCompletedPages > 0) && (
                        <span className="text-xs text-slate-400">
                          {activeJob?.completed_pages || failureCompletedPages} pages printed
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-paper rounded-xl border border-slate-700/60 text-xs text-slate-300">
                  🛡️ <span className="font-semibold text-ink">Document Retained:</span> Your file has been preserved on the server. You can retry printing, print remaining pages, or switch to a different printer.
                </div>

                {submitError && (
                  <p className="text-xs text-seal bg-seal-dim rounded-lg px-3 py-2 border border-seal/20">
                    {submitError}
                  </p>
                )}

                {isSwitchingPrinter ? (
                  <div className="space-y-3 bg-paper p-4 rounded-xl border border-slate-700/60">
                    <label className="block text-xs font-semibold text-ink">Select Target Printer</label>
                    <select
                      className={selectCls}
                      value={switchTargetPrinterId}
                      onChange={(e) => setSwitchTargetPrinterId(e.target.value)}
                    >
                      {compatiblePrinters.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.status})
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button variant="ghost" size="sm" onClick={() => setIsSwitchingPrinter(false)} disabled={submitting}>
                        Cancel
                      </Button>
                      <Button variant="seal" size="sm" onClick={handleConfirmSwitchPrinter} disabled={submitting}>
                        {submitting ? 'Switching…' : 'Switch & Print'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 pt-2">
                    <div className="grid grid-cols-2 gap-2">
                      {(activeJob?.completed_pages > 0 || failureCompletedPages > 0) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRetryRemaining}
                          disabled={submitting}
                          className="w-full justify-center text-xs"
                        >
                          Retry Remaining Pages
                        </Button>
                      )}
                      <Button
                        variant="seal"
                        size="sm"
                        onClick={handleRestartEntire}
                        disabled={submitting}
                        className="w-full justify-center text-xs"
                      >
                        Restart Entire Job
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleOpenSwitchPrinter}
                        disabled={submitting}
                        className="w-full justify-center text-xs"
                      >
                        Change Printer
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelJob}
                        disabled={submitting}
                        className="w-full justify-center text-xs text-seal hover:bg-seal-dim"
                      >
                        Cancel Job
                      </Button>
                    </div>
                    <div className="pt-2 text-center">
                      <button
                        onClick={() => setStep('configure')}
                        className="text-xs text-slate-400 hover:text-white underline"
                      >
                        ← Return to Print Settings
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {jobStatus === 'CANCELLED' && (
              <div className="space-y-4">
                <div className="w-12 h-12 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-slate-500 text-xl font-bold">
                  ⏱
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">Print Job Cancelled</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                    The print job was cancelled. The document is safely preserved.
                  </p>
                </div>
                <div className="pt-3 flex justify-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setStep('configure')}>
                    Change Settings
                  </Button>
                  <Button variant="primary" size="sm" onClick={onClose}>
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Connect Printer Modal */}
      <ConnectPrinterModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onPrinterAdded={() => loadPrintersList()}
      />
    </div>
  );
}

