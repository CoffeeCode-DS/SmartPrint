const QRCode = require('qrcode');
const env = require('../config/env');

/**
 * Builds the URL that the QR code will encode.
 * IMPORTANT: this only ever contains a session ID reference — never
 * document data, filenames, or anything sensitive. Scanning it just
 * takes the phone to a page that talks to the backend using this ID.
 *
 * Uses PUBLIC_URL rather than FRONTEND_URL: "localhost" only ever means
 * the scanning phone itself, so this is the auto-detected LAN IP (or an
 * explicit override) — see config/env.js for exactly how it's picked.
 */
function buildUploadUrl(sessionId) {
  return `${env.PUBLIC_URL}/upload/${sessionId}`;
}

/**
 * Generates a QR code for a session as a base64 PNG data URL,
 * ready to be dropped directly into an <img src="..."> on the frontend.
 */
async function generateQrDataUrl(sessionId) {
  const url = buildUploadUrl(sessionId);
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  });
}

module.exports = { generateQrDataUrl, buildUploadUrl };
