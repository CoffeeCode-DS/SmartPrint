/**
 * Detects a file's real type from its binary signature (magic bytes),
 * independent of the filename extension or browser-supplied MIME type
 * (both of which are trivially spoofable). Only covers the types
 * PrintSafe explicitly supports — keep this list in sync with
 * env.ALLOWED_EXTENSIONS / ALLOWED_MIME_TYPES.
 */
const SIGNATURES = [
  {
    ext: 'pdf',
    mime: 'application/pdf',
    matches: (buf) => buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  {
    ext: 'png',
    mime: 'image/png',
    matches: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  {
    ext: 'jpg',
    mime: 'image/jpeg',
    matches: (buf) => buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8,
  },
  {
    // WebP: RIFF....WEBP (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
    ext: 'webp',
    mime: 'image/webp',
    matches: (buf) =>
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    // HEIC/HEIF from iPhone & Samsung (ISO Base Media File Format — ftyp box)
    // Bytes 4-7 = 'ftyp', bytes 8-11 = brand (heic/heix/hevc/mif1/msf1 etc.)
    ext: 'heic',
    mime: 'image/heic',
    matches: (buf) => {
      if (buf.length < 12) return false;
      const ftyp = buf.subarray(4, 8).toString('ascii');
      if (ftyp !== 'ftyp') return false;
      const brand = buf.subarray(8, 12).toString('ascii').toLowerCase();
      if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(brand)) return true;
      const headerStr = buf.subarray(8, Math.min(buf.length, 64)).toString('latin1').toLowerCase();
      return headerStr.includes('heic') || headerStr.includes('mif1') || headerStr.includes('hevc');
    },
  },
  {
    // AVIF (AV1 Image File Format) - common on modern Android phones
    ext: 'avif',
    mime: 'image/avif',
    matches: (buf) => {
      if (buf.length < 12) return false;
      const ftyp = buf.subarray(4, 8).toString('ascii');
      if (ftyp !== 'ftyp') return false;
      const brand = buf.subarray(8, 12).toString('ascii').toLowerCase();
      if (['avif', 'avis'].includes(brand)) return true;
      const headerStr = buf.subarray(8, Math.min(buf.length, 64)).toString('latin1').toLowerCase();
      return headerStr.includes('avif') || headerStr.includes('avis');
    },
  },
  {
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    matches: (buf) =>
      buf.length >= 4 &&
      buf[0] === 0x50 && // 'P'
      buf[1] === 0x4b && // 'K'
      buf[2] === 0x03 &&
      buf[3] === 0x04,
  },
  {
    ext: 'doc',
    mime: 'application/msword',
    matches: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0xd0 &&
      buf[1] === 0xcf &&
      buf[2] === 0x11 &&
      buf[3] === 0xe0 &&
      buf[4] === 0xa1 &&
      buf[5] === 0xb1 &&
      buf[6] === 0x1a &&
      buf[7] === 0xe1,
  },
];

/**
 * Returns { ext, mime } for the detected type, or null if the buffer
 * doesn't match any known signature.
 */
function detectFileType(buffer) {
  for (const sig of SIGNATURES) {
    if (sig.matches(buffer)) {
      return { ext: sig.ext, mime: sig.mime };
    }
  }
  return null;
}

module.exports = { detectFileType };
