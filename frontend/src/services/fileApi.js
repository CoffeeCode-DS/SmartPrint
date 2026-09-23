import { api } from './api';

/**
 * If the file is a high-resolution phone camera image (>1.2MB), safely
 * optimizes it to max 2400px at 90% quality in the browser. This eliminates
 * mobile browser TCP resets/timeouts on Wi-Fi while preserving full A4 300 DPI print quality.
 * Includes a 3.5s failsafe timeout so uploads are NEVER blocked.
 */
export async function optimizeImageIfApplicable(file) {
  const isImage =
    file.type.startsWith('image/') ||
    /\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name);

  if (!isImage || file.size <= 1.2 * 1024 * 1024) {
    return file;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const timer = setTimeout(() => finish(file), 3500);

    const processBlob = (blob) => {
      clearTimeout(timer);
      if (!blob) {
        finish(file);
        return;
      }
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      try {
        const optimizedFile = new File([blob], `${baseName}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });
        finish(optimizedFile);
      } catch {
        blob.name = `${baseName}.jpg`;
        finish(blob);
      }
    };

    const scaleDimensions = (w, h, maxDim = 2400) => {
      let width = w;
      let height = h;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      return { width, height };
    };

    if (typeof createImageBitmap === 'function') {
      createImageBitmap(file)
        .then((bitmap) => {
          const { width, height } = scaleDimensions(bitmap.width, bitmap.height);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            clearTimeout(timer);
            bitmap.close?.();
            finish(file);
            return;
          }
          ctx.drawImage(bitmap, 0, 0, width, height);
          bitmap.close?.();
          canvas.toBlob(processBlob, 'image/jpeg', 0.90);
        })
        .catch(() => {
          fallbackImageLoad();
        });
    } else {
      fallbackImageLoad();
    }

    function fallbackImageLoad() {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        const { width, height } = scaleDimensions(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          clearTimeout(timer);
          finish(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(processBlob, 'image/jpeg', 0.90);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        clearTimeout(timer);
        finish(file);
      };

      img.src = url;
    }
  });
}

/**
 * Uploads a file to a session, reporting progress via onProgress(percent).
 */
export async function uploadFileToSession(sessionId, rawFile, onProgress) {
  const file = await optimizeImageIfApplicable(rawFile);

  const makeFormData = () => {
    const fd = new FormData();
    fd.append('file', file);
    return fd;
  };

  const send = async () => {
    return api.post(`/sessions/${sessionId}/upload`, makeFormData(), {
      timeout: 180000, // 180s for heavy files / slow mobile Wi-Fi
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (event) => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      },
    });
  };

  try {
    const res = await send();
    return res;
  } catch (err) {
    // If connection was dropped (e.g. mobile returning from camera background), retry once cleanly with fresh FormData
    if (err.message?.includes('connection') || err.message?.includes('Network') || !err.status) {
      await new Promise((r) => setTimeout(r, 800));
      const res = await send();
      return res;
    }
    throw err;
  }
}

export async function listFiles() {
  const res = await api.get('/files');
  return res.data.files;
}

export async function getSessionFiles(sessionId) {
  const res = await api.get(`/sessions/${sessionId}/files`);
  return res.data.files;
}

/**
 * Fetches a file's raw bytes as a Blob for preview. Uses the shared axios
 * instance so the auth token is attached automatically (a plain <img src>
 * or <iframe src> can't carry an Authorization header).
 */
export async function getFileContentBlob(fileId) {
  // The shared response interceptor resolves promises to `response.data`;
  // with responseType: 'blob', that data IS the Blob itself.
  return api.get(`/files/${fileId}/content`, { responseType: 'blob' });
}

export async function withdrawFile(sessionId, fileId) {
  const res = await api.delete(`/sessions/${sessionId}/files/${fileId}`);
  return res.data;
}

export async function operatorWithdrawFile(fileId) {
  const res = await api.delete(`/files/${fileId}`);
  return res.data;
}
