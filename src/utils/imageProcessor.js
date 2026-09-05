/**
 * e-KTP Image Preprocessors
 * Two strategies:
 * 1. preprocessImageForOCR   → Tesseract: grayscale + binarize + high-contrast
 * 2. preprocessImageForGemini → Gemini AI: keep color + mild contrast + crop
 */

// ─── Shared helper ────────────────────────────────────────────────────────────
function loadImage(fileOrUrl) {
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

// ─── 1. Tesseract OCR Preprocessor ───────────────────────────────────────────
/**
 * Prepares KTP image for Tesseract OCR:
 * Preserves natural image colors and text sharpness.
 * Hard binarization is avoided because Tesseract 5 LSTM neural net works
 * significantly better on original natural colors.
 */
export async function preprocessImageForOCR(fileOrUrl) {
  try {
    const img = await loadImage(fileOrUrl);

    // If image is already good resolution (width >= 1200), return as-is
    if (img.width >= 1200 && img.width <= 3000) {
      return typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
    }

    // Upscale smaller images for better character recognition
    const targetWidth = Math.min(Math.max(1600, img.width * 2), 2400);
    const scale = targetWidth / img.width;
    const width = targetWidth;
    const height = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL('image/jpeg', 0.95);
  } catch (err) {
    console.warn('OCR preprocessing fallback:', err);
    return typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  }
}

// ─── 2. Gemini Vision Preprocessor ───────────────────────────────────────────
/**
 * Prepares KTP image for Gemini Vision AI:
 * - Keep COLOR (Gemini reads color images better than grayscale)
 * - Upscale to min 1800px
 * - Mild contrast enhancement (not aggressive binarization)
 * - Crop left 78% to remove face photo + signature area
 * - Output JPEG quality 90 for efficient API transfer
 */
export async function preprocessImageForGemini(fileOrUrl) {
  try {
    const img = await loadImage(fileOrUrl);

    // Upscale to min 1800px
    const targetWidth = Math.max(1800, img.width);
    const scale = targetWidth / img.width;
    const width = targetWidth;
    const height = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    // Crop to left 78% — removes face photo & signature, keeps all text
    const cropW = Math.round(width * 0.78);
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = cropW;
    cropCanvas.height = height;
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(canvas, 0, 0, cropW, height, 0, 0, cropW, height);

    // Mild contrast boost — keep color for Gemini Vision
    const imageData = cropCtx.getImageData(0, 0, cropW, height);
    const data = imageData.data;
    const CONTRAST = 1.35; // Mild boost — enough to make text clearer
    const MIDPOINT = 128;

    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        let v = data[i + c];
        v = Math.round(MIDPOINT + (v - MIDPOINT) * CONTRAST);
        data[i + c] = Math.max(0, Math.min(255, v));
      }
    }

    cropCtx.putImageData(imageData, 0, 0);

    // JPEG quality 90 — good quality, manageable file size for API
    return cropCanvas.toDataURL('image/jpeg', 0.90);

  } catch (err) {
    console.warn('Gemini preprocessing fallback:', err);
    return typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  }
}

// ─── 3. Dedicated NIK Region Cropper ──────────────────────────────────────────
/**
 * Crops the exact NIK bounding box with 2x scaling for ultra-sharp digit-only recognition
 */
export async function cropNIKRegion(fileOrUrl) {
  try {
    const img = await loadImage(fileOrUrl);
    const canvas = document.createElement('canvas');

    // NIK bounding box on standard Indonesian e-KTP:
    // Horizontal: 18% to 76% of card width
    // Vertical: 13% to 26% of card height
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
