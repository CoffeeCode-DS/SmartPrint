import { useRef } from 'react';
import { useDocumentPreview } from '../hooks/useDocumentPreview';

export default function DocumentPreviewPane({
  fileId,
  mimeType,
  colorMode = 'bw',
  orientation = 'portrait',
  paperSize = 'A4',
  pagesPerSheet = 1,
  scale = 'fit',
  className = '',
}) {
  const canvasRef = useRef(null);
  const wordContainerRef = useRef(null);
  const {
    status,
    imageUrl,
    wordHtml,
    numPages,
    currentPage,
    zoom,
    error,
    goToPage,
    changeZoom,
    resetZoom,
  } = useDocumentPreview(fileId, mimeType, canvasRef);

  const isBw = colorMode === 'bw';
  const isLandscape = orientation === 'landscape';

  // For Word documents, scroll to proportional page location when currentPage changes
  const handlePageSelect = (page) => {
    goToPage(page);
    if (status === 'word' && wordContainerRef.current) {
      const container = wordContainerRef.current;
      const scrollHeight = container.scrollHeight - container.clientHeight;
      if (scrollHeight > 0 && numPages > 1) {
        const targetScroll = (scrollHeight * (page - 1)) / (numPages - 1);
        container.scrollTo({ top: targetScroll, behavior: 'smooth' });
      }
    }
  };

  return (
    <div className={`flex flex-col bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-xl ${className}`}>
      {/* Top Preview Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-xs text-slate-200 select-none">
        {/* Page navigation */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => handlePageSelect(currentPage - 1)}
            className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 hover:bg-slate-750 disabled:opacity-30 disabled:pointer-events-none font-medium text-slate-200 transition-colors"
            title="Previous Page"
          >
            ← Prev
          </button>
          
          <div className="flex items-center gap-1 bg-paper px-2 py-0.5 rounded-lg border border-ink/10 font-mono text-xs">
            <span className="text-ink/50">Page</span>
            <input
              type="number"
              min="1"
              max={numPages || 1}
              value={currentPage}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) handlePageSelect(val);
              }}
              className="w-9 text-center font-bold text-ink bg-transparent outline-none focus:text-seal"
            />
            <span className="text-ink/40">of {numPages || 1}</span>
          </div>

          <button
            type="button"
            disabled={currentPage >= (numPages || 1)}
            onClick={() => handlePageSelect(currentPage + 1)}
            className="px-2.5 py-1 rounded-lg bg-paper-dim border border-ink/10 hover:bg-ink/5 disabled:opacity-30 disabled:pointer-events-none font-medium transition-colors"
            title="Next Page"
          >
            Next →
          </button>
        </div>

        {/* Layout Badges */}
        <div className="hidden sm:flex items-center gap-1.5 text-[11px]">
          <span className="bg-paper-dim border border-ink/8 px-2 py-0.5 rounded-md font-medium text-ink/70">
            {paperSize}
          </span>
          <span className="bg-paper-dim border border-ink/8 px-2 py-0.5 rounded-md font-medium text-ink/70 capitalize">
            {orientation}
          </span>
          {isBw && (
            <span className="bg-ink/10 text-ink/80 px-2 py-0.5 rounded-md font-medium">
              B&amp;W Grayscale
            </span>
          )}
          {pagesPerSheet > 1 && (
            <span className="bg-seal/10 text-seal px-2 py-0.5 rounded-md font-semibold">
              {pagesPerSheet}-Up
            </span>
          )}
          {scale && scale !== 'fit' && (
            <span className="bg-paper-dim border border-ink/8 px-2 py-0.5 rounded-md font-medium text-ink/70">
              {scale}
            </span>
          )}
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => changeZoom(-0.15)}
            disabled={zoom <= 0.5}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-paper-dim border border-ink/10 hover:bg-ink/5 font-bold disabled:opacity-30"
            title="Zoom Out"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetZoom}
            className="px-2 py-1 rounded-lg text-[11px] font-mono text-ink/70 hover:bg-ink/5"
            title="Reset Zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => changeZoom(0.15)}
            disabled={zoom >= 2.5}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-paper-dim border border-ink/10 hover:bg-ink/5 font-bold disabled:opacity-30"
            title="Zoom In"
          >
            +
          </button>
        </div>
      </div>

      {/* Quick Page Picker strip if multi-page */}
      {numPages > 1 && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 bg-paper-dim/80 border-b border-ink/8 overflow-x-auto text-[11px] font-mono">
          <span className="text-ink/40 shrink-0 uppercase tracking-wider text-[10px]">Jump to page:</span>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(numPages, 12) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePageSelect(p)}
                className={`w-6 h-6 rounded flex items-center justify-center transition-all ${
                  currentPage === p
                    ? 'bg-rose-500 text-white font-bold shadow-xs'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                }`}
              >
                {p}
              </button>
            ))}
            {numPages > 12 && (
              <span className="text-slate-400 px-1">… +{numPages - 12} more</span>
            )}
          </div>
        </div>
      )}

      {/* Preview Viewport */}
      <div className="p-4 sm:p-6 flex items-center justify-center min-h-[380px] max-h-[520px] overflow-auto bg-slate-950/90 relative">
        {status === 'loading' && (
          <div className="py-20 text-center">
            <div className="w-8 h-8 mx-auto rounded-full border-2 border-slate-700 border-t-rose-500 animate-spin" />
            <p className="mt-3 text-xs text-slate-400 font-medium">Rendering document preview…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="py-16 text-center px-4 max-w-sm">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-950/80 text-rose-300 border border-rose-800/80 flex items-center justify-center text-xl mb-3 shadow-md">
              ⚠️
            </div>
            <p className="text-sm text-rose-200 font-bold">
              {String(error).includes('404')
                ? 'Document Already Processed or Removed'
                : 'Preview Unavailable'}
            </p>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              {String(error).includes('404')
                ? 'This file has already been printed or securely shredded from the server under zero-trace policy.'
                : error || 'Could not render document preview.'}
            </p>
          </div>
        )}

        {/* Image Preview */}
        {status === 'image' && (
          <div
            className={`transition-all duration-200 shadow-2xl rounded-lg bg-white p-2 max-w-full ${
              isBw ? 'grayscale contrast-110' : ''
            }`}
            style={{
              transform: `scale(${zoom}) ${isLandscape ? 'rotate(90deg)' : ''}`,
              transformOrigin: 'center center',
            }}
          >
            <img src={imageUrl} alt="Preview" className="max-h-[420px] w-auto rounded object-contain" />
          </div>
        )}

        {/* Real Formatted Word Document (.docx / .doc) Preview */}
        {status === 'word' && (
          <div
            ref={wordContainerRef}
            className={`transition-all duration-200 shadow-2xl rounded-xl bg-white p-8 sm:p-10 max-w-2xl w-full border border-slate-200 relative overflow-y-auto max-h-[480px] scroll-smooth ${
              isBw ? 'grayscale' : ''
            }`}
            style={{
              transform: `scale(${zoom}) ${isLandscape ? 'rotate(90deg)' : ''}`,
              transformOrigin: 'top center',
            }}
          >
            {/* Document Header watermark */}
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 text-[11px] text-slate-500 font-mono">
              <span className="flex items-center gap-1.5 font-sans font-semibold text-blue-600">
                <span className="w-2 h-2 rounded-full bg-blue-600" />
                Word Document Preview
              </span>
              <span>{paperSize} · {orientation}</span>
            </div>

            {wordHtml ? (
              <div
                className="prose prose-sm max-w-none text-slate-900 leading-relaxed font-sans space-y-3 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-slate-950 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-900 [&_h3]:font-semibold [&_h3]:text-slate-900 [&_table]:w-full [&_table]:border-collapse [&_table]:my-3 [&_th]:border [&_th]:border-slate-300 [&_th]:p-2 [&_th]:bg-slate-100 [&_th]:text-slate-900 [&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_td]:text-slate-800 [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
                dangerouslySetInnerHTML={{ __html: wordHtml }}
              />
            ) : (
              <div className="text-center py-10">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-xs">
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-9 h-9">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 20V4h7v5h5v11H6z" />
                    <path d="M8.5 17h1.4l1.1-4.5 1.1 4.5h1.4l1.8-7h-1.4l-1.1 4.8-1.1-4.8h-1.4l-1.1 4.8-1.1-4.8H7.3l1.2 7z" />
                  </svg>
                </div>
                <h4 className="mt-3 text-sm font-semibold text-slate-900">Microsoft Word Document</h4>
                <p className="mt-1 text-xs text-slate-600">Ready for Windows native print spooler</p>
              </div>
            )}
          </div>
        )}

        {/* PDF Multi-Page Canvas Preview */}
        <div
          className={`transition-all duration-200 shadow-2xl rounded-lg bg-white p-2 ${
            status === 'pdf' ? 'block' : 'hidden'
          } ${isBw ? 'grayscale contrast-110' : ''}`}
          style={{
            transform: isLandscape ? 'rotate(90deg)' : undefined,
            transformOrigin: 'center center',
          }}
        >
          <canvas ref={canvasRef} className="rounded max-h-[440px] w-auto shadow-xs" />
        </div>
      </div>

      {/* Footer information banner */}
      <div className="px-4 py-2 bg-paper-dim/60 border-t border-ink/8 text-[11px] text-ink/60 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-sage" />
          Page {currentPage} of {numPages || 1} ready
        </span>
        {pagesPerSheet > 1 && (
          <span className="text-seal font-medium">{pagesPerSheet} pages per physical sheet</span>
        )}
      </div>
    </div>
  );
}
