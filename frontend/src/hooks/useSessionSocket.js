import { useCallback, useEffect, useRef, useState } from 'react';
import { createSocket } from '../services/socket';

/**
 * Joins the Socket.IO room for a session and tracks live state derived
 * from server-pushed events. Used by both the Dashboard ("viewer" role)
 * and the Upload page ("uploader" role).
 */
export function useSessionSocket(sessionId, role) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false); // is the "other side" present?
  const [uploadProgress, setUploadProgress] = useState(null); // 0-100 or null when idle
  const [lastUpload, setLastUpload] = useState(null); // { file, isDuplicate }
  const [lastValidationError, setLastValidationError] = useState(null); // { reason, message }
  const [sessionEvent, setSessionEvent] = useState(null); // { type: 'EXPIRED'|'USED'|'EXTENDED'|'CANCELLED', ...payload }
  const [notifications, setNotifications] = useState([]); // most recent first
  const [printJobEvent, setPrintJobEvent] = useState(null); // { type: 'COMPLETED'|'FAILED'|'VERIFIED', jobId }

  useEffect(() => {
    if (!sessionId) return undefined;

    const socket = createSocket();
    socketRef.current = socket;

    function join() {
      socket.emit('session:join', { sessionId, role });
    }

    socket.on('connect', () => {
      setConnected(true);
      join();
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('client:connected', () => setPeerConnected(true));
    socket.on('client:disconnected', () => setPeerConnected(false));

    socket.on('upload:started', () => setUploadProgress(0));
    socket.on('upload:progress', ({ percent }) => setUploadProgress(percent));
    socket.on('upload:completed', (payload) => {
      setUploadProgress(null);
      setLastUpload(payload);
    });
    socket.on('validation:failed', (payload) => {
      setUploadProgress(null);
      setLastValidationError(payload);
    });

    socket.on('session:expired', () => setSessionEvent({ type: 'EXPIRED' }));
    socket.on('session:used', () => setSessionEvent({ type: 'USED' }));
    socket.on('session:extended', (payload) => setSessionEvent({ type: 'EXTENDED', ...payload }));
    socket.on('session:cancelled', () => setSessionEvent({ type: 'CANCELLED' }));

    socket.on('notification:created', (notification) => {
      setNotifications((prev) => [notification, ...prev].slice(0, 20));
    });

    // Print job status events — used by Upload page to update file status in real-time
    socket.on('print:completed', (payload) => setPrintJobEvent({ type: 'COMPLETED', ...payload, _ts: Date.now() }));
    socket.on('print:verified', (payload) => setPrintJobEvent({ type: 'VERIFIED', ...payload, _ts: Date.now() }));
    socket.on('print:failed', (payload) => setPrintJobEvent({ type: 'FAILED', ...payload, _ts: Date.now() }));
    socket.on('file:deleted', (payload) => setPrintJobEvent({ type: 'FILE_DELETED', ...payload, _ts: Date.now() }));
    socket.on('queue:updated', () => setPrintJobEvent({ type: 'QUEUE_UPDATED', _ts: Date.now() }));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [sessionId, role]);

  const emitUploadStarted = useCallback(() => {
    socketRef.current?.emit('upload:started', { sessionId });
  }, [sessionId]);

  const emitUploadProgress = useCallback(
    (percent) => {
      socketRef.current?.emit('upload:progress', { sessionId, percent });
    },
    [sessionId]
  );

  return {
    connected,
    peerConnected,
    uploadProgress,
    lastUpload,
    lastValidationError,
    sessionEvent,
    notifications,
    printJobEvent,
    emitUploadStarted,
    emitUploadProgress,
  };
}
