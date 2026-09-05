/**
 * e-KTP Left-Text Region Cropper (78% Width)
 * Includes full RT/RW and Kel/Desa text while cutting off photo & signature.
 */

export async function preprocessImageForOCR(fileOrUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      try {
        const fullCanvas = document.createElement('canvas');
        const fullCtx = fullCanvas.getContext('2d');

        const targetWidth = Math.max(1800, img.width);
        const scale = targetWidth / img.width;
        const width = targetWidth;
        const height = Math.round(img.height * scale);

        fullCanvas.width = width;
        fullCanvas.height = height;

        fullCtx.imageSmoothingEnabled = true;
        fullCtx.imageSmoothingQuality = 'high';
        fullCtx.drawImage(img, 0, 0, width, height);

        // Crop 78% width: captures all left text (RT/RW, Kel/Desa, etc.) while excluding face photo
        const cropWidth = Math.round(width * 0.78);
        const cropCanvas = document.createElement('canvas');
        const cropCtx = cropCanvas.getContext('2d');

        cropCanvas.width = cropWidth;
        cropCanvas.height = height;

        cropCtx.drawImage(fullCanvas, 0, 0, cropWidth, height, 0, 0, cropWidth, height);

        const imageData = cropCtx.getImageData(0, 0, cropWidth, height);
        const data = imageData.data;

        // Apply Red-Channel Focus & High Contrast
        const grays = new Uint8Array(cropWidth * height);
        let minG = 255;
        let maxG = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          let gray = 0.75 * r + 0.25 * g - 0.1 * b;
          if (gray < 0) gray = 0;
          if (gray > 255) gray = 255;

          const intG = Math.round(gray);
          grays[i / 4] = intG;

          if (intG < minG) minG = intG;
          if (intG > maxG) maxG = intG;
        }

        const range = maxG - minG || 1;

        for (let i = 0; i < data.length; i += 4) {
          const idx = i / 4;
          const rawG = grays[idx];

          let norm = Math.round(((rawG - minG) / range) * 255);

          let finalVal = 255;
          if (norm < 140) {
            finalVal = Math.max(0, Math.round(norm * 0.6));
          }

          data[i] = finalVal;
          data[i + 1] = finalVal;
          data[i + 2] = finalVal;
        }

        cropCtx.putImageData(imageData, 0, 0);

        resolve(cropCanvas.toDataURL('image/png'));
      } catch (err) {
        console.warn('Canvas cropping fallback:', err);
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
