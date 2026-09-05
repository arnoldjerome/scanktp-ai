/**
 * High-Precision e-KTP Image Processor with Dot-Matrix Stencil Fusion
 * Connects stencil gaps in e-KTP NIK numbers (like 0, 4, 8) and removes blue watermarks.
 */

export async function preprocessImageForOCR(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // High resolution 2x scale for sharp text & stencil fusion
        const targetWidth = Math.max(2000, img.width * 2);
        const scale = targetWidth / img.width;
        const width = targetWidth;
        const height = Math.round(img.height * scale);

        canvas.width = width;
        canvas.height = height;

        // Smooth scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Step 1: Red-Channel Focus (Removes blue background watermark)
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

        // Step 2: Smooth Contrast Curve (Min-Max contrast stretching without destroying stencil font)
        const range = maxG - minG || 1;

        for (let i = 0; i < data.length; i += 4) {
          const idx = i / 4;
          const rawG = grays[idx];
          let norm = Math.round(((rawG - minG) / range) * 255);

          // Soft contrast curve to preserve zero '0' dot-matrix loops
          let finalVal = 255;
          if (norm < 155) {
            finalVal = Math.max(0, Math.round(norm * 0.8));
          }

          data[i] = finalVal;
          data[i + 1] = finalVal;
          data[i + 2] = finalVal;
        }

        ctx.putImageData(imageData, 0, 0);

        // Step 3: Subtle 1-pass Box Blur to fuse dot-matrix gaps in NIK numbers
        fuseDotMatrixGaps(ctx, width, height);

        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Canvas preprocessing warning:', err);
        resolve(img.src);
      }
    };

    img.onerror = (err) => reject(err);

    if (typeof fileOrUrl === 'string') {
      img.src = fileOrUrl;
    } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
      img.src = URL.createObjectURL(fileOrUrl);
    } else {
      reject(new Error('Invalid input image'));
    }
  });
}

/**
 * Connects 1-pixel gaps in stencil dot-matrix NIK numbers
 */
function fuseDotMatrixGaps(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const copy = new Uint8Array(data);

  // Dilate dark pixels slightly (3x3 neighborhood)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      if (copy[idx] < 128) {
        // If center is dark, darken 1px neighbors slightly to bridge stencil gaps
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nIdx = ((y + dy) * width + (x + dx)) * 4;
            if (data[nIdx] > 180) {
              data[nIdx] = 160;
              data[nIdx + 1] = 160;
              data[nIdx + 2] = 160;
            }
          }
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
