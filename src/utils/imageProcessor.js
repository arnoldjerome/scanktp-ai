/**
 * e-KTP Image Preprocessor for Tesseract OCR
 * - Crops left 75% (text area only, excludes face photo)
 * - Upscales to min 2000px wide for better OCR character recognition
 * - Applies adaptive contrast normalization
 * - Converts to high-contrast grayscale optimized for dark text on light background
 */

export async function preprocessImageForOCR(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      try {
        // ── Step 1: Upscale to minimum 2400px width ─────────────────────────
        const targetWidth = Math.max(2400, img.width * 2);
        const scale = targetWidth / img.width;
        const width = targetWidth;
        const height = Math.round(img.height * scale);

        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = width;
        fullCanvas.height = height;
        const fullCtx = fullCanvas.getContext('2d');
        fullCtx.imageSmoothingEnabled = true;
        fullCtx.imageSmoothingQuality = 'high';
        fullCtx.drawImage(img, 0, 0, width, height);

        // ── Step 2: Crop left 75% (text column, exclude face photo) ─────────
        const cropWidth = Math.round(width * 0.75);
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropWidth;
        cropCanvas.height = height;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(fullCanvas, 0, 0, cropWidth, height, 0, 0, cropWidth, height);

        // ── Step 3: Adaptive grayscale + high contrast ───────────────────────
        const imageData = cropCtx.getImageData(0, 0, cropWidth, height);
        const data = imageData.data;
        const totalPx = cropWidth * height;

        // Convert to grayscale — weight red channel higher (works well for blue KTPs)
        const gray = new Float32Array(totalPx);
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          // For teal/blue-background KTPs: reduce blue channel weight
          gray[i / 4] = 0.6 * r + 0.3 * g + 0.1 * b;
        }

        // Find 5th and 95th percentile for adaptive normalization
        const sorted = [...gray].sort((a, b) => a - b);
        const p5  = sorted[Math.floor(totalPx * 0.05)];
        const p95 = sorted[Math.floor(totalPx * 0.95)];
        const range = Math.max(p95 - p5, 1);

        // Apply normalization + binarization threshold
        for (let i = 0; i < data.length; i += 4) {
          const idx = i / 4;
          // Normalize to 0-255
          let val = Math.round(((gray[idx] - p5) / range) * 255);
          val = Math.max(0, Math.min(255, val));

          // Binarize: dark pixels → black, light pixels → white
          // Threshold at 160 — text is typically darker than background
          const binary = val < 160 ? Math.max(0, val - 20) : Math.min(255, val + 30);

          data[i] = data[i + 1] = data[i + 2] = binary;
        }

        cropCtx.putImageData(imageData, 0, 0);

        // ── Step 4: Output high-quality PNG ──────────────────────────────────
        resolve(cropCanvas.toDataURL('image/png'));

      } catch (err) {
        console.warn('Image preprocessing fallback:', err);
        // Fallback: return original image
        resolve(typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl));
      }
    };

    img.onerror = (err) => reject(new Error('Failed to load image: ' + err));

    if (typeof fileOrUrl === 'string') {
      img.src = fileOrUrl;
    } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
      img.src = URL.createObjectURL(fileOrUrl);
    } else {
      reject(new Error('Invalid input: expected File, Blob, or URL string'));
    }
  });
}
