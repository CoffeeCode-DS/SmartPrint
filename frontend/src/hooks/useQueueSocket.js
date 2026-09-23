import { useEffect } from 'react';
import { createSocket } from '../services/socket';
import { TOKEN_STORAGE_KEY } from '../services/api';

const QUEUE_EVENTS = [
  'print:created',
  'print:started',
  'print:spooler_completed',
  'print:settling',
  'print:awaiting_verification',
  'print:completed',
  'print:verified',
  'print:failed',
  'print:retry',
  'print:cancelled',
  'queue:updated',
  'printers:changed',
  'file:withdrawn',
  'file:deleted',
];

/**
 * Joins the global operator queue room and invokes `onJobEvent(job)` for
 * every print-job lifecycle event. Caller owns the actual job list state
 * (this hook only relays events) — pass a stable callback (useCallback).
 */
export function useQueueSocket(onJobEvent) {
  useEffect(() => {
    const socket = createSocket();

    socket.on('connect', () => {
      const token = localStorage.getItem(TOKEN_STORAGE_KEY);
      socket.emit('queue:join', { token });
    });
    QUEUE_EVENTS.forEach((evt) => socket.on(evt, onJobEvent));

    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onJobEvent]);
}
