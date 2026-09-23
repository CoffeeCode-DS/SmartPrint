import { useEffect, useRef, useState, useCallback } from 'react';
import { getFileContentBlob } from '../services/fileApi';

let pdfjsLibPromise = null;
function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjsLib, workerUrlModule]) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrlModule.default;
      return pdfjsLib;
    });
  }
  return pdfjsLibPromise;
}

let mammothPromise = null;
function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = import('mammoth').then((m) => m.default || m);
  }
  return mammothPromise;
}

/**
 * Fetches document bytes and renders any page with zoom and orientation.
 */
export function useDocumentPreview(fileId, mimeType, canvasRef) {
  const [status, setStatus] = useState('loading'); // loading | image | pdf | word | error
  const [imageUrl, setImageUrl] = useState(null);
  const [wordHtml, setWordHtml] = useState(null);
  const [numPages, setNumPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [error, setError] = useState(null);

  const objectUrlRef = useRef(null);
  const pdfDocRef = useRef(null);
  const renderTaskRef = useRef(null);

  // Render a specific page of loaded PDF
  const renderPdfPage = useCallback(async (pdf, pageNum, zoomLevel) => {
    if (!pdf || !canvasRef.current) return;
    try {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      const page = await pdf.getPage(pageNum);
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      const baseViewport = page.getViewport({ scale: 1.0 });
      // Calculate responsive base scale to fit nicely in preview card
      const targetWidth = 520;
      const calculatedScale = (targetWidth / baseViewport.width) * zoomLevel;
      const viewport = page.getViewport({ scale: calculatedScale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderContext = {
        canvasContext: ctx,
        viewport,
      };

      const task = page.render(renderContext);
      renderTaskRef.current = task;
      await task.promise;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('PDF page render error:', err);
      }
    }
  }, [canvasRef]);

  // Initial fetch and parse of the document
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setCurrentPage(1);

    (async () => {
      try {
        const blob = await getFileContentBlob(fileId);
        if (cancelled) return;

        if (mimeType.startsWith('image/')) {
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setImageUrl(url);
          setNumPages(1);
          setStatus('image');
          return;
        }

        if (mimeType === 'application/pdf') {
          const pdfjsLib = await loadPdfjs();
          const arrayBuffer = await blob.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          if (cancelled) return;

          pdfDocRef.current = pdf;
          setNumPages(pdf.numPages);
          setStatus('pdf');
          await renderPdfPage(pdf, 1, zoom);
          return;
        }

        const isWord =
          mimeType === 'application/msword' ||
          mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          mimeType?.includes('word');

        if (isWord) {
          try {
            const mammoth = await loadMammoth();
            const arrayBuffer = await blob.arrayBuffer();
            const result = await mammoth.convertToHtml({ arrayBuffer });
            if (cancelled) return;

            const html = result.value || '<p>Document has no readable text</p>';
            setWordHtml(html);

            // Estimate pages based on word count & paragraph breaks
            const plainText = html.replace(/<[^>]+>/g, ' ');
            const words = plainText.trim().split(/\s+/).filter(Boolean).length;
            const estimatedPages = Math.max(1, Math.ceil(words / 280));
            setNumPages(estimatedPages);
            setStatus('word');
            return;
          } catch (docErr) {
            console.warn('Word preview fallback:', docErr);
            setWordHtml(null);
            setNumPages(1);
            setStatus('word');
            return;
          }
        }

        setStatus('error');
        setError('Preview not supported for this file type.');
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load preview.');
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, mimeType]);

  // When page or zoom changes for an already-loaded PDF
  useEffect(() => {
    if (status === 'pdf' && pdfDocRef.current) {
      renderPdfPage(pdfDocRef.current, currentPage, zoom);
    }
  }, [currentPage, zoom, status, renderPdfPage]);

  const goToPage = useCallback((page) => {
    const valid = Math.max(1, Math.min(numPages || 1, page));
    setCurrentPage(valid);
  }, [numPages]);

  const changeZoom = useCallback((delta) => {
    setZoom((prev) => Math.max(0.5, Math.min(2.5, +(prev + delta).toFixed(2))));
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1.0);
  }, []);

  return {
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
  };
}
