import { api } from './api';

export async function createPrintJob(fileIdOrOptions, maybeOptions = {}) {
  let payload;
  if (typeof fileIdOrOptions === 'object' && fileIdOrOptions !== null) {
    const { fileId, printerId, settings = {}, force = false, ...rest } = fileIdOrOptions;
    payload = { fileId, printerId, ...settings, ...rest, force };
  } else {
    const { printerId, settings = {}, force = false, ...rest } = maybeOptions;
    payload = { fileId: fileIdOrOptions, printerId, ...settings, ...rest, force };
  }
  const res = await api.post('/print-jobs', payload);
  return res.data.printJob;
}

export async function listPrintJobs(sessionId) {
  const res = await api.get('/print-jobs', { params: sessionId ? { sessionId } : {} });
  return res.data.printJobs;
}

export async function getPrintJob(id) {
  const res = await api.get(`/print-jobs/${id}`);
  return res.data.printJob;
}

export async function retryPrintJob(id) {
  const res = await api.post(`/print-jobs/${id}/retry`);
  return res.data.printJob;
}

export async function cancelPrintJob(id) {
  const res = await api.post(`/print-jobs/${id}/cancel`);
  return res.data.printJob;
}

export async function verifyPrintJob(id, { verified, failureCode, notes } = {}) {
  const res = await api.post(`/print-jobs/${id}/verify`, { verified, failureCode, notes });
  return res.data.printJob;
}

export async function retryRemainingPrintJob(id, { completedPages, printerId } = {}) {
  const res = await api.post(`/print-jobs/${id}/retry-remaining`, { completedPages, printerId });
  return res.data.printJob;
}

export async function restartEntirePrintJob(id, { printerId } = {}) {
  const res = await api.post(`/print-jobs/${id}/restart`, { printerId });
  return res.data.printJob;
}

export async function switchPrinterJob(id, { newPrinterId, settings } = {}) {
  const res = await api.post(`/print-jobs/${id}/switch-printer`, { newPrinterId, settings });
  return res.data.printJob;
}
