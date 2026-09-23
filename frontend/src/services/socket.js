import { io } from 'socket.io-client';

/**
 * Same reasoning as api.js's computeDefaultApiUrl: derive the Socket.IO
 * host from window.location at runtime, never hardcode "localhost" — a
 * phone loading this page from a LAN IP must connect sockets back to
 * that same LAN IP, not to itself.
 */
function computeDefaultSocketUrl() {
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:5000`;
}

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.VITE_API_URL
    ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '')
    : computeDefaultSocketUrl());

/**
 * Creates a fresh Socket.IO connection. We create one per hook usage
 * (per Dashboard/Upload page mount) rather than a global singleton, since
 * each page cares about a single session's room and cleans up on unmount.
 */
export function createSocket() {
  return io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
  });
}
