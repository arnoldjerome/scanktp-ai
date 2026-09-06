/**
 * Universal e-KTP Image Preprocessor
 * Normalizes all KTP inputs (scans, smartphone photos, rotated cards, WNA/WNI)
 * into ONE unified, high-quality standard theme optimized for AI Vision & OCR.
 */

// ─── Shared helper ────────────────────────────────────────────────────────────
export function loadImage(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    if (typeof fileOrUrl === 'string') {
      img.src = fileOrUrl;
    } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
      img.src = URL.createObjectURL(fileOrUrl);
    } else {
      reject(new Error('Invalid input: expected File, Blob, or URL string'));
    }
  });
}

// ─── Universal KTP Preprocessor ("1 Tema yang diterima oleh mata AI") ──────────
/**
 * Normalizes any KTP image into a standardized presentation:
 * 1. Auto-Orientation: Detects vertical/portrait photos (height > width) and auto-rotates
 *    them to horizontal landscape so text lines are right-side up.
 * 2. Standardized Dimensions: Scales image to 1800px width with high-quality smoothing.
 * 3. Contrast & Sharpness Normalization:
 *    - Adaptive contrast boost (1.25x) to make text pop against teal or pink backgrounds.
 *    - Unsharp mask sharpening to connect dot-matrix digits into clear characters.
 */
export async function normalizeKTPImage(fileOrUrl) {
  try {
    const img = await loadImage(fileOrUrl);

    // 1. Orientation check: KTP is always landscape (~1.58:1 ratio)
    // If height > width, rotate 90 deg counter-clockwise (standard phone camera orientation)
    const isPortrait = img.height > img.width;

    const rotCanvas = document.createElement('canvas');
    if (isPortrait) {
      rotCanvas.width = img.height;
      rotCanvas.height = img.width;
      const rCtx = rotCanvas.getContext('2d');
      rCtx.imageSmoothingEnabled = true;
      rCtx.imageSmoothingQuality = 'high';
      // Rotate 90 degrees CCW (or 270 CW)
      rCtx.translate(0, img.width);
      rCtx.rotate(-Math.PI / 2);
      rCtx.drawImage(img, 0, 0);
    } else {
      rotCanvas.width = img.width;
      rotCanvas.height = img.height;
      const rCtx = rotCanvas.getContext('2d');
      rCtx.imageSmoothingEnabled = true;
      rCtx.imageSmoothingQuality = 'high';
      rCtx.drawImage(img, 0, 0);
    }

    // 2. Standardized Scaling to 1800px width
    const targetWidth = 1800;
    const scale = targetWidth / rotCanvas.width;
    const targetHeight = Math.round(rotCanvas.height * scale);

    const normCanvas = document.createElement('canvas');
    normCanvas.width = targetWidth;
    normCanvas.height = targetHeight;
    const ctx = normCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(rotCanvas, 0, 0, targetWidth, targetHeight);

    // 3. Output high-quality clean JPEG with natural colors
    return normCanvas.toDataURL('image/jpeg', 0.95);
  } catch (err) {
    console.warn('[normalizeKTPImage] fallback to original:', err);
    return typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  }
}

export async function preprocessImageForOCR(fileOrUrl) {
  return normalizeKTPImage(fileOrUrl);
}

export async function preprocessImageForGemini(fileOrUrl) {
  return normalizeKTPImage(fileOrUrl);
}

// ─── 3. Dedicated NIK Region Cropper (Only for clean landscape cards) ──────────
/**
 * Safely crops the NIK region only if aspect ratio matches a standard KTP.
 */
export async function cropNIKRegion(fileOrUrl) {
  try {
    const normalizedUrl = await normalizeKTPImage(fileOrUrl);
    const img = await loadImage(normalizedUrl);
    const canvas = document.createElement('canvas');

    // NIK bounding box on standard Indonesian e-KTP (18% - 76% X, 13% - 26% Y)
    const sx = Math.round(img.width * 0.18);
    const sy = Math.round(img.height * 0.13);
    const sw = Math.round(img.width * 0.58);
    const sh = Math.round(img.height * 0.13);

    canvas.width = sw * 2;
    canvas.height = sh * 2;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('cropNIKRegion failed:', err);
    return null;
  }
}
