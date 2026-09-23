import DocumentPreviewPane from './DocumentPreviewPane';

/**
 * Standalone modal preview (used from the Queue's "Preview" button).
 * The actual rendering logic lives in DocumentPreviewPane, shared with
 * the print dialog's preview step.
 */
export default function FilePreview({ fileId, mimeType, originalName, onClose }) {
  return (
    <div
      className="fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900/95 border border-slate-700/80 text-slate-100 rounded-2xl sm:rounded-3xl max-w-2xl w-full max-h-[94vh] overflow-hidden p-4 sm:p-6 shadow-[0_20px_60px_rgba(0,0,0,0.7)] fade-up flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
            <p className="text-sm font-bold text-white truncate pr-2">{originalName}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors text-sm p-1.5 rounded-lg hover:bg-slate-800">
            ✕
          </button>
        </div>

        <DocumentPreviewPane fileId={fileId} mimeType={mimeType} className="rounded-xl overflow-hidden border border-slate-800 shadow-inner" />
      </div>
    </div>
  );
}
