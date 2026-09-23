import { api } from './api';

export async function listPrinters() {
  const res = await api.get('/printers');
  return res.data.printers;
}

export async function refreshPrinters() {
  const res = await api.post('/printers/refresh');
  return res.data.printers;
}

export async function printTestPage(printerId) {
  const res = await api.post(`/printers/${encodeURIComponent(printerId)}/test-page`);
  return res.data;
}

export async function connectPrinter(data) {
  const res = await api.post('/printers/connect', data);
  return res.data;
}

export async function setPrinterStatus(printerId, status, notes = null) {
  const res = await api.post(`/printers/${encodeURIComponent(printerId)}/status`, { status, notes });
  return res.data;
}

export async function getCompatiblePrinters(params = {}) {
  const res = await api.get('/printers/compatible', { params });
  return res.data; // { compatiblePrinters, evaluatedPrinters }
}

export async function removePrinter(printerId) {
  const res = await api.delete(`/printers/${encodeURIComponent(printerId)}`);
  return res.data;
}

export async function setDefaultPrinter(printerId) {
  const res = await api.post(`/printers/${encodeURIComponent(printerId)}/default`);
  return res.data;
}
