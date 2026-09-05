/**
 * High-Precision e-KTP Image Processor
 * Applies contrast stretching (min-max normalization) and Red-channel isolation
 * to convert light-blue e-KTP cards into crystal-clear black text on white background.
 */

export async function preprocessImageForOCR(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Target high-res width (minimum 1800px)
        const targetWidth = Math.max(1800, img.width);
        const scale = targetWidth / img.width;
        const width = targetWidth;
        const height = Math.round(img.height * scale);

        canvas.width = width;
        canvas.height = height;

        // Render with high-quality smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Step 1: Red-Channel Focus (Removes e-KTP light-blue background)
        const grays = new Uint8Array(width * height);
        let minGray = 255;
        let maxGray = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          // e-KTP background is light blue (high B, medium R/G). Dark text has low R/G/B.
          // Red channel gives maximum contrast between dark text and blue background!
          let gray = 0.7 * r + 0.3 * g - 0.1 * b;
          if (gray < 0) gray = 0;
          if (gray > 255) gray = 255;

          const intGray = Math.round(gray);
          grays[i / 4] = intGray;

          if (intGray < minGray) minGray = intGray;
          if (intGray > maxGray) maxGray = intGray;
        }

        // Step 2: Contrast Stretching (Min-Max Normalization)
        const range = maxGray - minGray || 1;
        
        for (let i = 0; i < data.length; i += 4) {
          const idx = i / 4;
          const rawGray = grays[idx];

          // Stretch contrast across 0..255
          let normalized = Math.round(((rawGray - minGray) / range) * 255);

          // Apply sigmoidal contrast curve to make dark text solid black & light background pure white
          let finalVal = 255;
          if (normalized < 140) {
            finalVal = Math.max(0, Math.round(normalized * 0.75));
          }

          data[i] = finalVal;
          data[i + 1] = finalVal;
          data[i + 2] = finalVal;
        }

        ctx.putImageData(imageData, 0, 0);

        // Return Data URL
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
