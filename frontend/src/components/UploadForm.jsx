import { useCallback, useRef, useState } from 'react';
import { uploadFileToSession } from '../services/fileApi';

const CLIENT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif,.doc,.docx,image/*,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const CLIENT_MAX_SIZE_MB = 200;

export default function UploadForm({ sessionId, onUploaded, onUploadStarted, onUploadProgress }) {
  const [phase, setPhase] = useState('idle'); // idle | uploading | success | error
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [uploadedCount, setUploadedCount] = useState(1);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef(null);

  const doUploadFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      if (files.length === 0) return;

      setPhase('uploading');
      setProgress(0);
      setError(null);
      onUploadStarted?.();

      try {
        let lastResult = null;
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.size > CLIENT_MAX_SIZE_MB * 1024 * 1024) {
            throw new Error(`"${file.name}" exceeds the ${CLIENT_MAX_SIZE_MB}MB limit.`);
          }
          const data = await uploadFileToSession(sessionId, file, (percent) => {
            const overall = Math.round(((i + percent / 100) / files.length) * 100);
            setProgress(overall);
            onUploadProgress?.(overall);
          });
          lastResult = data;
          onUploaded?.(data);
        }
        setResult(lastResult);
        setUploadedCount(files.length);
        setPhase('success');
      } catch (err) {
        setError(err.message || 'Upload failed');
        setPhase('error');
      }
    },
    [sessionId, onUploaded, onUploadStarted, onUploadProgress]
  );

  function handleInputChange(e) {
    const files = e.target.files;
    if (files && files.length > 0) {
      doUploadFiles(files);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      doUploadFiles(files);
    }
  }

  const resetFileSelection = () => {
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div className="mt-5">
      <input
        id="smartprint-file-picker"
        ref={inputRef}
        type="file"
        multiple
        accept={CLIENT_ACCEPT}
        className="hidden"
        onChange={handleInputChange}
      />

      {/* PHASE: UPLOADING PROGRESS */}
      {phase === 'uploading' && (
        <div className="py-6 px-4 rounded-xl border border-slate-800 bg-slate-950/60 text-center fade-up">
          <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-rose-500 to-indigo-500 h-2.5 transition-all duration-200 ease-out rounded-full shadow-inner"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-slate-300 font-mono flex items-center justify-center gap-2">
            <span className="w-3 h-3 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
            <span>Encrypting &amp; Buffering · {progress}%</span>
          </p>
        </div>
      )}

      {/* PHASE: SUCCESS CARD */}
      {phase === 'success' && (
        <div className="mb-2 fade-up space-y-3">
          <div className="rounded-xl bg-emerald-950/70 border border-emerald-800/80 px-4 py-3 text-left">
            <p className="text-emerald-300 text-xs font-bold flex items-center gap-1.5">
              <span>✓</span> {uploadedCount > 1 ? `${uploadedCount} documents uploaded successfully` : 'Uploaded successfully'}
            </p>
            <p className="mt-1 text-xs text-slate-200 font-medium truncate">
              {result?.file?.originalName} {uploadedCount > 1 ? `(+${uploadedCount - 1} more)` : ''}
            </p>
          </div>

          {result?.isDuplicate && (
            <p className="text-xs text-amber-200 bg-amber-950/60 border border-amber-800/60 rounded-xl px-3.5 py-2 text-left">
              This file matches one already uploaded earlier — flagged for print station.
            </p>
          )}

          {/* Direct Native File Picker Trigger Label */}
          <label
            htmlFor="smartprint-file-picker"
            onClick={resetFileSelection}
            className="w-full text-xs font-semibold py-3 px-4 rounded-xl shadow-md flex items-center justify-center gap-2 cursor-pointer bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white transition-all active:scale-[0.99] select-none"
          >
            <span>📎</span>
            <span>+ Upload Another Document / Photo</span>
          </label>
        </div>
      )}

      {/* PHASE: IDLE DROPZONE */}
      {phase === 'idle' && (
        <label
          htmlFor="smartprint-file-picker"
          onClick={resetFileSelection}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          className={`block cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition-all duration-150 select-none ${
            dragActive
              ? 'border-rose-500 bg-rose-950/30 scale-[1.01]'
              : 'border-slate-800 hover:border-slate-700 bg-slate-950/40 hover:bg-slate-950/70'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            className="w-8 h-8 mx-auto text-slate-400 mb-2"
          >
            <path d="M12 16V5M7 10l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 19h16" strokeLinecap="round" />
          </svg>
          <p className="text-sm font-semibold text-white">Tap to choose files / photos</p>
          <p className="mt-1 text-[11px] text-slate-400">
            PDF, Word, JPG, PNG, WebP, HEIC · up to {CLIENT_MAX_SIZE_MB}MB
          </p>
        </label>
      )}

      {/* PHASE: ERROR STATE */}
      {phase === 'error' && (
        <div className="mt-3 space-y-3 fade-up">
          <p className="text-rose-300 text-xs font-medium bg-rose-950/60 border border-rose-800/80 rounded-xl px-3.5 py-2.5 text-left">
            ⚠️ {error}
          </p>
          <label
            htmlFor="smartprint-file-picker"
            onClick={resetFileSelection}
            className="w-full text-xs font-semibold py-2.5 px-4 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all flex items-center justify-center gap-2 cursor-pointer select-none"
          >
            <span>🔄</span>
            <span>Try Upload Again (Choose File)</span>
          </label>
        </div>
      )}
    </div>
  );
}
