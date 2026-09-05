/**
 * Gemini Vision OCR for e-KTP Indonesia — Maximum Accuracy Edition v3
 *
 * Strategy:
 *  1. Auto-discover the best available Gemini model (v1beta → v1).
 *  2. Preprocess the image (crop left side, boost contrast) before sending.
 *  3. Two-pass extraction: first extract raw OCR lines, then parse into JSON.
 *  4. Post-process and validate without mangling correct data.
 */

// ─── API Configuration ────────────────────────────────────────────────────────
const API_VERSIONS = ['v1beta', 'v1'];
const PREFERRED_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash-exp',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro',
  'gemini-1.5-pro-latest',
  'gemini-pro-vision',
];

// Cache discovered working endpoint
let cachedEndpoint = null; // { apiVersion, modelName }

// ─── Prompt — Pass 1: Raw OCR ─────────────────────────────────────────────────
const PASS1_PROMPT = `You are a precise OCR engine for Indonesian ID cards (KTP/e-KTP).

TASK: Transcribe ALL text visible on this ID card EXACTLY as it appears, line by line.
- Include EVERY line, both labels and values.
- Do NOT skip any line, even short ones like "B" for blood type.
- Preserve numbers exactly — do NOT round, guess, or change any digit.
- Read digits one by one: distinguish 0 vs O, 1 vs l, 8 vs B, 4 vs A, 5 vs S, 6 vs G.
- Ignore background watermark text (PENDUDUK, KARTU, etc.).
- Output plain text, one line per entry. No JSON.`;

// ─── Prompt — Pass 2: Structured Extraction ───────────────────────────────────
function buildPass2Prompt(rawText) {
  return `You are a data extraction engine for Indonesian e-KTP (ID card) data.

Below is the raw OCR text extracted from an Indonesian e-KTP card:
---
${rawText}
---

Your task: extract structured data from the text above and return ONLY valid JSON with no other text.

FIELD-BY-FIELD RULES (follow exactly):

1. "provinsi": Top header line with "PROVINSI". Example: "PROVINSI JAWA TIMUR". Always starts with "PROVINSI".

2. "kota": Second header line. Examples: "KABUPATEN GRESIK", "KOTA SEMARANG", "JAKARTA BARAT".
   - Fix OCR errors: "KAPATI" should be "KABUPATEN".

3. "nik": EXACTLY 16 digits after the "NIK" label.
   - Read EVERY digit carefully. Do NOT alter any digit order.
   - Convert letter misreads only: O-to-0, l-to-1, B-to-8, A-to-4, S-to-5, G-to-6.
   - Output ONLY digits, no spaces or dashes.

4. "nama": Full name after "Nama" label. Example: "ARNOLD JEROME CANDRA".

5. "tempatTglLahir": Birthplace and date after "Tempat/Tgl Lahir". Format: "KOTA, DD-MM-YYYY". Example: "SEMARANG, 20-04-2004".

6. "jenisKelamin": Gender. ONLY "LAKI-LAKI" or "PEREMPUAN".

7. "golDarah": Blood type. Only: A, B, AB, O, or - if not visible.

8. "alamat": Street address after "Alamat". Example: "JL. DUSUN PENGAMPUN". Do NOT include RT/RW here.

9. "rtRw": RT/RW numbers. Format: "014/007". Always 3 digits each side with leading zeros.

10. "kelDesa": Village name after "Kel/Desa". Example: "SETRO".

11. "kecamatan": District name after "Kecamatan". Example: "MENGANTI".

12. "agama": Religion. One of: ISLAM, KRISTEN, KATHOLIK, HINDU, BUDDHA, KHONGHUCU.

13. "statusPerkawinan": Marital status. One of: BELUM KAWIN, KAWIN, CERAI HIDUP, CERAI MATI.

14. "pekerjaan": Occupation. Example: "BELUM/TIDAK BEKERJA", "PEGAWAI SWASTA".

15. "kewarganegaraan": "WNI" or "WNA".

16. "berlakuHingga": Expiry after "Berlaku Hingga". Format "DD-MM-YYYY" or "SEUMUR HIDUP". Take only ONE date.

OUTPUT FORMAT — return ONLY this JSON, nothing else:
{
  "provinsi": "",
  "kota": "",
  "nik": "",
  "nama": "",
  "tempatTglLahir": "",
  "jenisKelamin": "",
  "golDarah": "",
  "alamat": "",
  "rtRw": "",
  "kelDesa": "",
  "kecamatan": "",
  "agama": "",
  "statusPerkawinan": "",
  "pekerjaan": "",
  "kewarganegaraan": "WNI",
  "berlakuHingga": ""
}`;
}

// ─── Image Preprocessing ──────────────────────────────────────────────────────
/**
 * Crop left ~72% of KTP (where text data is) and boost contrast.
 * Returns a base64 data URL.
 */
async function preprocessForOCR(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Crop to left 72% where all text data lives (right side = photo)
      const cropWidth = Math.floor(img.width * 0.72);
      const cropHeight = img.height;

      // Scale up to at least 1200px wide for better OCR
      const targetWidth = Math.min(Math.max(cropWidth, 1200), 2400);
      const scale = targetWidth / cropWidth;
      const targetHeight = Math.round(cropHeight * scale);

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      ctx.drawImage(img, 0, 0, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);

      // Boost contrast to make text more legible
      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const data = imageData.data;
      const contrast = 1.3;
      const brightness = 10;
      const factor = (259 * (contrast * 100 + 255)) / (255 * (259 - contrast * 100));

      for (let i = 0; i < data.length; i += 4) {
        data[i]     = Math.min(255, Math.max(0, factor * (data[i]     - 128) + 128 + brightness));
        data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128 + brightness));
        data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128 + brightness));
      }
      ctx.putImageData(imageData, 0, 0);

      resolve(canvas.toDataURL('image/jpeg', 0.95));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── File to Base64 ────────────────────────────────────────────────────────────
async function fileToBase64(fileOrUrl) {
  if (typeof fileOrUrl === 'string') {
    if (fileOrUrl.startsWith('data:')) {
      return {
        data: fileOrUrl.split(',')[1],
        mimeType: fileOrUrl.split(';')[0].split(':')[1],
      };
    }
    const response = await fetch(fileOrUrl);
    const blob = await response.blob();
    return blobToBase64(blob);
  } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
    return blobToBase64(fileOrUrl);
  }
  throw new Error('Invalid input image source');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve({
        data: result.split(',')[1],
        mimeType: blob.type || 'image/jpeg',
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Model Discovery ──────────────────────────────────────────────────────────
async function discoverModel(apiKey) {
  if (cachedEndpoint) return cachedEndpoint;

  console.log('[Gemini] Discovering available models...');

  for (const apiVersion of API_VERSIONS) {
    try {
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models?key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const models = data.models || [];

      const modelNames = models.map(m => m.name.replace('models/', ''));
      console.log(`[Gemini] Available models (${apiVersion}):`, modelNames.join(', '));

      for (const preferred of PREFERRED_MODELS) {
        const found = models.find(m => {
          const name = m.name.replace('models/', '');
          return name === preferred &&
            m.supportedGenerationMethods &&
            m.supportedGenerationMethods.includes('generateContent');
        });
        if (found) {
          const modelName = found.name.replace('models/', '');
          console.log(`[Gemini] Selected model: ${modelName} (${apiVersion})`);
          cachedEndpoint = { apiVersion, modelName };
          return cachedEndpoint;
        }
      }

      const anyVision = models.find(m =>
        m.supportedGenerationMethods &&
        m.supportedGenerationMethods.includes('generateContent') &&
        (m.name.includes('flash') || m.name.includes('pro'))
      );
      if (anyVision) {
        const modelName = anyVision.name.replace('models/', '');
        console.log(`[Gemini] Using fallback model: ${modelName} (${apiVersion})`);
        cachedEndpoint = { apiVersion, modelName };
        return cachedEndpoint;
      }
    } catch (err) {
      console.warn(`[Gemini] Failed to list models on ${apiVersion}:`, err.message);
    }
  }

  return await bruteForceModel(apiKey);
}

async function bruteForceModel(apiKey) {
  console.log('[Gemini] Brute-force testing models...');

  for (const apiVersion of API_VERSIONS) {
    for (const modelName of PREFERRED_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Reply OK' }] }],
            generationConfig: { maxOutputTokens: 3 },
          }),
        });

        if (res.ok) {
          console.log(`[Gemini] Found working model: ${modelName} (${apiVersion})`);
          cachedEndpoint = { apiVersion, modelName };
          return cachedEndpoint;
        }

        const errText = await res.text().catch(() => '');
        if (res.status === 403 || res.status === 401 ||
            errText.includes('API_KEY_INVALID') || errText.includes('API key not valid')) {
          throw new Error('API_KEY_INVALID');
        }
        if (res.status === 429) {
          throw new Error('Gemini quota habis. Tunggu 1 menit lalu coba lagi.');
        }
      } catch (err) {
        if (err.message === 'API_KEY_INVALID' || err.message.includes('quota')) throw err;
      }
    }
  }

  throw new Error('Tidak ada model Gemini yang tersedia. Periksa API key Anda di aistudio.google.com');
}

export function resetGeminiCache() {
  cachedEndpoint = null;
}

// ─── Test Connection ──────────────────────────────────────────────────────────
export async function testGeminiConnection(apiKey) {
  if (!apiKey || !apiKey.trim()) return { ok: false, error: 'API Key kosong' };

  resetGeminiCache();

  try {
    const endpoint = await discoverModel(apiKey.trim());
    return { ok: true, model: endpoint.modelName };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Core Gemini Request Helper ───────────────────────────────────────────────
async function callGemini(apiVersion, modelName, apiKey, parts, temperature = 0.1) {
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature,
      maxOutputTokens: 2048,
      topP: 0.95,
      topK: 40,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errBody = '';
    try { errBody = await response.text(); } catch (_) {}
    console.error('[Gemini] API Error:', response.status, errBody.substring(0, 300));

    if (response.status === 404) cachedEndpoint = null;

    if (response.status === 403 || (response.status === 400 && errBody.includes('API key'))) {
      throw new Error('API_KEY_INVALID');
    }
    if (response.status === 429) {
      throw new Error('Gemini quota habis. Tunggu 1 menit lalu coba lagi.');
    }
    throw new Error(`Gemini API error (${response.status}): ${errBody.substring(0, 150)}`);
  }

  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Response kosong dari Gemini API');
  return text;
}

// ─── Two-Pass KTP Extraction ─────────────────────────────────────────────────
async function twoPassExtraction(imageData, mimeType, apiKey, apiVersion, modelName) {
  const imgPart = {
    inline_data: {
      mime_type: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
      data: imageData,
    },
  };

  // Pass 1: Raw OCR transcription
  console.log('[Gemini] Pass 1: Raw OCR transcription...');
  const rawText = await callGemini(apiVersion, modelName, apiKey, [
    { text: PASS1_PROMPT },
    imgPart,
  ], 0.05);

  console.log('[Gemini] Pass 1 raw:\n', rawText.substring(0, 600));

  // Pass 2: Structured JSON from raw text (text-only, no image needed)
  console.log('[Gemini] Pass 2: Structured JSON extraction...');
  const jsonText = await callGemini(apiVersion, modelName, apiKey, [
    { text: buildPass2Prompt(rawText) },
  ], 0.0);

  console.log('[Gemini] Pass 2 JSON:\n', jsonText.substring(0, 600));

  return { rawText, jsonText };
}

// ─── Main OCR Function ────────────────────────────────────────────────────────
export async function scanKTPWithGemini(imageSource, apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');

  const { apiVersion, modelName } = await discoverModel(apiKey.trim());
  console.log(`[Gemini] Using model: ${modelName} (${apiVersion})`);

  // Preprocess the image if it's a File
  let processedSource = imageSource;
  if (imageSource instanceof File && imageSource.type.startsWith('image/')) {
    try {
      processedSource = await preprocessForOCR(imageSource);
      console.log('[Gemini] Image preprocessed (cropped + contrast boosted)');
    } catch (e) {
      console.warn('[Gemini] Preprocessing failed, using original:', e.message);
      processedSource = imageSource;
    }
  }

  const { data: base64Data, mimeType } = await fileToBase64(processedSource);

  let parsed = null;

  // Try two-pass extraction
  try {
    const { rawText, jsonText } = await twoPassExtraction(
      base64Data, mimeType, apiKey.trim(), apiVersion, modelName
    );
    parsed = extractJSON(jsonText);
    if (!parsed) {
      const fallback = extractJSON(rawText);
      if (fallback) parsed = fallback;
    }
  } catch (err) {
    if (err.message === 'API_KEY_INVALID' || err.message.includes('quota')) throw err;

    // Fallback: single-pass with original image
    console.warn('[Gemini] Two-pass failed, trying single-pass:', err.message);
    const { data: origBase64, mimeType: origMime } = await fileToBase64(imageSource);
    const imgPart = {
      inline_data: {
        mime_type: origMime.startsWith('image/') ? origMime : 'image/jpeg',
        data: origBase64,
      },
    };
    const fallbackText = await callGemini(apiVersion, modelName, apiKey.trim(), [
      { text: buildPass2Prompt('(extract directly from the image below)') },
      imgPart,
    ], 0.05);
    parsed = extractJSON(fallbackText);
  }

  if (!parsed) throw new Error('Tidak dapat mengekstrak data JSON dari response Gemini');

  return normalizeAndValidate(parsed);
}

// ─── JSON Extractor ──────────────────────────────────────────────────────────
function extractJSON(text) {
  if (!text) return null;
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    console.warn('[Gemini] JSON parse error:', e.message);
    return null;
  }
}

// ─── Post-Processing & Validation ─────────────────────────────────────────────
function normalizeAndValidate(raw) {
  const str = (v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim());

  // NIK: convert common OCR misreads, keep only digits, cap at 16
  let nik = str(raw.nik)
    .replace(/\s/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[lI]/g, '1')
    .replace(/B/g, '8')
    .replace(/[^0-9]/g, '');
  if (nik.length > 16) nik = nik.substring(0, 16);

  // Provinsi
  let provinsi = str(raw.provinsi).toUpperCase();
  if (provinsi && !provinsi.startsWith('PROVINSI')) provinsi = 'PROVINSI ' + provinsi;
  provinsi = provinsi.replace(/^PROVINSI\s+PROVINSI\s+/i, 'PROVINSI ');

  // Kota: fix common OCR errors
  let kota = str(raw.kota).toUpperCase()
    .replace(/\bKAPATI\b/g, 'KABUPATEN')
    .replace(/\bKABUPATEN\s+KABUPATEN\b/g, 'KABUPATEN')
    .replace(/[|\\]/g, '')
    .trim();

  // Tempat/Tgl Lahir
  let tempatTglLahir = str(raw.tempatTglLahir)
    .replace(/^WNI\s*/i, '')
    .replace(/[\/\.]/g, '-')
    .trim()
    .toUpperCase();
  const tglMatch = tempatTglLahir.match(/(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (tglMatch) {
    const day = tglMatch[1].padStart(2, '0');
    const month = tglMatch[2].padStart(2, '0');
    const year = tglMatch[3].length === 2 ? '19' + tglMatch[3] : tglMatch[3];
    const cityPart = tempatTglLahir.split(/\d/)[0].replace(/[,\s]+$/, '').trim();
    tempatTglLahir = cityPart ? `${cityPart}, ${day}-${month}-${year}` : `${day}-${month}-${year}`;
  }

  // Jenis Kelamin
  let jenisKelamin = str(raw.jenisKelamin).toUpperCase();
  if (jenisKelamin.includes('PEREMPUAN')) jenisKelamin = 'PEREMPUAN';
  else if (jenisKelamin.includes('LAKI')) jenisKelamin = 'LAKI-LAKI';

  // Gol Darah
  let golDarah = str(raw.golDarah).toUpperCase().trim();
  if (!['A', 'B', 'AB', 'O'].includes(golDarah)) {
    const m = golDarah.match(/\b(AB|A|B|O)\b/);
    golDarah = m ? m[1] : '-';
  }

  // RT/RW
  let rtRw = str(raw.rtRw).replace(/\s/g, '').replace(/[\\|]/g, '/');
  const rtRwMatch = rtRw.match(/(\d+)\/(\d+)/);
  if (rtRwMatch) {
    rtRw = rtRwMatch[1].padStart(3, '0') + '/' + rtRwMatch[2].padStart(3, '0');
  }

  // Berlaku Hingga
  let berlakuHingga = str(raw.berlakuHingga).toUpperCase();
  if (berlakuHingga.includes('SEUMUR') || berlakuHingga.includes('HIDUP') || berlakuHingga === 'LIFETIME') {
    berlakuHingga = 'SEUMUR HIDUP';
  } else {
    const dates = berlakuHingga.match(/\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4}/g);
    if (dates && dates.length > 0) {
      const parts = dates[0].replace(/[\/\.]/g, '-').split('-');
      berlakuHingga = parts.length === 3
        ? parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0') + '-' + parts[2]
        : dates[0];
    }
  }

  let alamat = str(raw.alamat).toUpperCase().replace(/[|\\]+$/, '').trim();
  let pekerjaan = str(raw.pekerjaan).toUpperCase().replace(/[|\\]/g, '').trim();

  // Safe NIK cross-validation
  if (nik.length === 16 && tempatTglLahir) {
    nik = safeValidateNIK(nik, tempatTglLahir, jenisKelamin);
  }

  return {
    provinsi,
    kota,
    nik,
    nama: str(raw.nama).toUpperCase(),
    tempatTglLahir,
    jenisKelamin,
    golDarah,
    alamat,
    rtRw,
    kelDesa: str(raw.kelDesa).toUpperCase(),
    kecamatan: str(raw.kecamatan).toUpperCase(),
    agama: str(raw.agama).toUpperCase(),
    statusPerkawinan: str(raw.statusPerkawinan).toUpperCase(),
    pekerjaan,
    kewarganegaraan: str(raw.kewarganegaraan).toUpperCase() || 'WNI',
    berlakuHingga,
    rawText: JSON.stringify(raw, null, 2),
  };
}

/**
 * Safer NIK validation — only repairs if DOB section differs by at most 2 digits.
 * Does NOT alter NIKs where the mismatch is large (likely a reading error, not a digit swap).
 */
function safeValidateNIK(nik, tempatTglLahir, jenisKelamin) {
  const dateMatch = tempatTglLahir.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!dateMatch) return nik;

  let day = parseInt(dateMatch[1], 10);
  const month = dateMatch[2];
  const year = dateMatch[3].slice(-2);

  if (jenisKelamin && jenisKelamin.includes('PEREMPUAN')) day += 40;

  const expectedDay = day < 10 ? `0${day}` : `${day}`;
  const expectedDob = expectedDay + month + year;

  const prefix = nik.substring(0, 6);
  const nikDob = nik.substring(6, 12);
  const seq = nik.substring(12, 16);

  if (/^\d{6}$/.test(expectedDob) && nikDob !== expectedDob) {
    const diffCount = [...nikDob].filter((c, i) => c !== expectedDob[i]).length;
    if (diffCount <= 2) {
      console.log(`[NIK SafeRepair] ${nikDob} → ${expectedDob} (${diffCount} digits differ)`);
      return prefix + expectedDob + seq;
    } else {
      console.warn(`[NIK SafeRepair] Skipped — too many digits differ (${diffCount}): ${nikDob} vs ${expectedDob}`);
    }
  }

  return nik;
}
