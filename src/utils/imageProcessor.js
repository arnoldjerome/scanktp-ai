/**
 * Advanced Image Pre-processor for e-KTP OCR
 * Uses Red-channel extraction (to strip out light-blue e-KTP background watermarks)
 * combined with contrast enhancement and Otsu adaptive thresholding.
 */

export async function preprocessImageForOCR(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Scale up low-res images to minimum 1500px width for sharp text rendering
        const targetWidth = Math.max(1600, img.width);
        const scale = targetWidth / img.width;
        const width = targetWidth;
        const height = Math.round(img.height * scale);

        canvas.width = width;
        canvas.height = height;

        // Draw scaled image
        ctx.drawImage(img, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Step 1: Red-channel extraction & background noise removal
        // e-KTP cards have light-blue background watermarks.
        // Red channel makes blue background bright white, while dark text stays dark black!
        const grays = new Uint8Array(width * height);
        
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // Emphasize Red & Green channel over Blue to suppress blue watermark
          let val = 0.6 * r + 0.4 * g - 0.1 * b;
          if (val < 0) val = 0;
          if (val > 255) val = 255;

          grays[i / 4] = val;
        }

        // Step 2: Calculate Otsu's Threshold
        const threshold = getOtsuThreshold(grays);

        // Step 3: Apply thresholding & high-contrast output
        for (let i = 0; i < data.length; i += 4) {
          const idx = i / 4;
          const gray = grays[idx];

          // Binarize with soft margin to keep character edges smooth
          let finalVal = 255;
          if (gray < threshold - 10) {
            finalVal = 0; // Dark text
          } else if (gray < threshold + 15) {
            finalVal = Math.round(((gray - (threshold - 10)) / 25) * 255);
          }

          data[i] = finalVal;
          data[i + 1] = finalVal;
          data[i + 2] = finalVal;
        }

        ctx.putImageData(imageData, 0, 0);

        // Return optimized canvas PNG URL
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Canvas preprocessing fallback:', err);
        resolve(img.src);
      }
    };

    img.onerror = (err) => reject(err);

    if (typeof fileOrUrl === 'string') {
      img.src = fileOrUrl;
    } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
      img.src = URL.createObjectURL(fileOrUrl);
    } else {
      reject(new Error('Invalid image input'));
    }
  });
}

/**
 * Calculates global Otsu threshold for binarizing grayscale image array
 */
function getOtsuThreshold(grays) {
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < grays.length; i++) {
    histogram[grays[i]]++;
  }

  const total = grays.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) {
    sum += t * histogram[t];
  }

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;

    wF = total - wB;
    if (wF === 0) break;

    sumB += t * histogram[t];

    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    const varianceBetween = wB * wF * (mB - mF) * (mB - mF);

    if (varianceBetween > maxVariance) {
      maxVariance = varianceBetween;
      threshold = t;
    }
  }

  return threshold;
}
