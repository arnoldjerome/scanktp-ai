/**
 * Image Pre-processor for OCR
 * Enhances contrast, converts to grayscale, and sharpens text boundaries for Tesseract OCR.
 */

export async function preprocessImageForOCR(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Scale up low-resolution images for higher DPI OCR
        const minDimension = 1200;
        let width = img.width;
        let height = img.height;

        if (width < minDimension && height < minDimension) {
          const scale = minDimension / Math.min(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        canvas.width = width;
        canvas.height = height;

        // Draw image onto canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Get Pixel Data
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Apply Grayscale & Contrast Boosting
        // Formula: Luminance Y = 0.299R + 0.587G + 0.114B
        const contrast = 1.35; // 35% contrast boost
        const factor = (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Grayscale
          let gray = 0.299 * r + 0.587 * g + 0.114 * b;

          // Contrast Boost
          gray = factor * (gray - 128) + 128;

          // Clamp values
          if (gray > 255) gray = 255;
          if (gray < 0) gray = 0;

          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }

        ctx.putImageData(imageData, 0, 0);

        // Return Data URL for Tesseract
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Preprocessing canvas warning, falling back to original:', err);
        resolve(img.src);
      }
    };

    img.onerror = (err) => reject(err);

    if (typeof fileOrUrl === 'string') {
      img.src = fileOrUrl;
    } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
      img.src = URL.createObjectURL(fileOrUrl);
    } else {
      reject(new Error('Invalid image input type'));
    }
  });
}
