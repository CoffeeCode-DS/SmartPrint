import axios from 'axios';

export const TOKEN_STORAGE_KEY = 'printsafe_auth_token';

/**
 * Figures out the backend base URL to call, when VITE_API_URL isn't
 * explicitly set. Crucially, this is computed at RUNTIME in the browser
 * from window.location — never hardcoded to "localhost" — because the
 * page could be loaded from the laptop (localhost:5173) or from a phone
 * on the same Wi-Fi (e.g. 192.168.1.23:5173). Whichever host the browser
 * actually used to load this page is also where the backend lives, on
 * the configured backend port. Hardcoding "localhost" here would silently
 * break every device except the one that generated the QR code.
 */
function computeDefaultApiUrl() {
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:5000/api`;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || computeDefaultApiUrl();

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000, // 60s default — images from phone cameras can be large
});

// Attach the stored auth token (if any) to every request. Public endpoints
// (sessions, upload, notifications) simply ignore the header; protected
// ones (print-jobs, files list, auth/*) require it.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Centralized response unwrapping + error normalization.
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    let message =
      error.response?.data?.error?.message || error.message || 'Something went wrong';
    if (message === 'Network Error') {
      message = 'Network connection interrupted. Please ensure your device is connected to the same Wi-Fi and retry.';
    }
    const normalized = new Error(message);
    normalized.status = error.response?.status;
    normalized.details = error.response?.data?.error?.details;
    return Promise.reject(normalized);
  }
);

export async function pingServer() {
  return api.get('/ping');
}
