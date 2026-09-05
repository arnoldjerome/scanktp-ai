/**
 * Crisp & High-Contrast e-KTP Image Processor
 * Uses Red-channel extraction and high-DPI scaling to produce crisp text
 * for both dot-matrix NIK numbers and standard Indonesian e-KTP fields.
 */

export async function preprocessImageForOCR(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Target optimal resolution (1800px width)
        const targetWidth = Math.max(1800, img.width);
        const scale = targetWidth / img.width;
        const width = targetWidth;
        const height = Math.round(img.height * scale);

        canvas.width = width;
        canvas.height = height;

        // High quality rendering
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Step 1: Red-Channel Focus (Removes e-KTP light-blue background)
        const grays = new Uint8Array(width * height);
        let minG = 255;
        let maxG = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Red channel isolates dark text from cyan/blue background
          let gray = 0.75 * r + 0.25 * g - 0.1 * b;
          if (gray < 0) gray = 0;
          if (gray > 255) gray = 255;

          const intG = Math.round(gray);
          grays[i / 4] = intG;

          if (intG < minG) minG = intG;
          if (intG > maxG) maxG = intG;
        }

        // Step 2: Linear Contrast Stretch (preserves crisp letter strokes)
        const range = maxG - minG || 1;

        for (let i = 0; i < data.length; i += 4) {
          const idx = i / 4;
          const rawG = grays[idx];

          // Stretch contrast across 0..255
          let norm = Math.round(((rawG - minG) / range) * 255);

          // Crisp text thresholding
          let finalVal = 255;
          if (norm < 135) {
            finalVal = Math.max(0, Math.round(norm * 0.65));
          }

          data[i] = finalVal;
          data[i + 1] = finalVal;
          data[i + 2] = finalVal;
        }

        ctx.putImageData(imageData, 0, 0);

        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Canvas preprocessing warning:', err);
        resolve(img.src);
      }
    };

    if (typeof fileOrUrl === 'string') {
      img.src = fileOrUrl;
    } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
      img.src = URL.createObjectURL(fileOrUrl);
    } else {
      reject(new Error('Invalid input image'));
    }
  });
}
