/**
 * Gemini Vision OCR for e-KTP — Ultra Precision Edition
 * Auto-discovers available models via Gemini API, then uses the best one.
 * Supports both v1 and v1beta API versions.
 */

// ─── API Configuration ────────────────────────────────────────────────────────
const API_VERSIONS = ['v1beta', 'v1'];
const PREFERRED_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro',
  'gemini-1.5-pro-latest',
  'gemini-pro-vision',
  'gemini-pro',
];

// Cache discovered working endpoint
let cachedEndpoint = null; // { apiVersion, modelName }

// ─── Prompt Engineering ────────────────────────────────────────────────────────
const KTP_PROMPT = `Kamu adalah mesin ekstraksi data e-KTP Indonesia yang sangat presisi.

INSTRUKSI WAJIB:
1. Baca HANYA sisi KIRI kartu KTP (kolom data teks). ABAIKAN foto wajah, foto kota, dan tanda tangan di sisi kanan.
2. Baca SETIAP KARAKTER dengan sangat teliti — terutama NIK.
3. Jangan mengarang atau mengisi data. Jika tidak terbaca, isi dengan string kosong "".
4. Kembalikan HANYA JSON valid, tanpa teks lain apapun di luar JSON.

PANDUAN SETIAP FIELD:
- "provinsi": Baris paling atas (contoh: "PROVINSI JAWA TIMUR", "PROVINSI DKI JAKARTA"). Selalu diawali kata PROVINSI.
- "kota": Baris kedua (contoh: "KABUPATEN GRESIK", "KOTA SEMARANG", "JAKARTA BARAT"). JANGAN campur dengan pekerjaan atau data lain.
- "nik": 16 digit angka persis. Letaknya setelah label "NIK". Baca digit SATU PER SATU dengan teliti. Angka 0 (nol) berbeda dengan O (huruf O). Angka 1 berbeda dengan l (huruf L). Angka 8 berbeda dengan B. Angka 4 berbeda dengan A. Angka 5 berbeda dengan S.
- "nama": Nama lengkap setelah "Nama". Hanya nama, jangan campur data lain.
- "tempatTglLahir": Format "KOTA, DD-MM-YYYY" (contoh: "JAKARTA, 18-02-1986" atau "SEMARANG, 20-04-2004"). Ambil dari baris "Tempat/Tgl Lahir". JANGAN campur dengan Kewarganegaraan.
- "jenisKelamin": "LAKI-LAKI" atau "PEREMPUAN". Ambil dari baris "Jenis Kelamin" saja.
- "golDarah": Satu dari: A, B, AB, O, atau -. Letaknya di baris yang sama dengan Jenis Kelamin setelah "Gol. Darah".
- "alamat": Nama jalan dari baris "Alamat". Tanpa RT/RW dan Kel/Desa.
- "rtRw": Format "XXX/XXX" dengan angka 3 digit masing-masing (contoh: "014/007", "007/008"). Pertahankan angka nol di depan.
- "kelDesa": Nama kelurahan/desa dari baris "Kel/Desa". Hanya nama kelurahan, tidak ada yang lain.
- "kecamatan": Nama kecamatan dari baris "Kecamatan".
- "agama": Salah satu: ISLAM, KRISTEN, KATHOLIK, HINDU, BUDDHA, KHONGHUCU.
- "statusPerkawinan": Salah satu: BELUM KAWIN, KAWIN, CERAI HIDUP, CERAI MATI.
- "pekerjaan": Pekerjaan dari baris "Pekerjaan". Baca seluruh teks pekerjaan secara lengkap (contoh: "BELUM/TIDAK BEKERJA", "PEGAWAI SWASTA", "PELAJAR/MAHASISWA").
- "kewarganegaraan": "WNI" atau "WNA".
- "berlakuHingga": Tanggal dari baris "Berlaku Hingga" dalam format "DD-MM-YYYY", atau "SEUMUR HIDUP". JANGAN campurkan dua tanggal berbeda.

VALIDASI MANDIRI sebelum output:
- NIK harus tepat 16 digit angka
- tempatTglLahir harus mengandung nama kota DAN tanggal
- berlakuHingga hanya boleh satu tanggal atau "SEUMUR HIDUP"

Output JSON:
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
/**
 * Discover available models by calling the list models endpoint.
 * Returns the best model+apiVersion combo for vision tasks.
 */
async function discoverModel(apiKey) {
  // If we already found a working endpoint, use it
  if (cachedEndpoint) return cachedEndpoint;

  console.log('[Gemini] Discovering available models...');

  for (const apiVersion of API_VERSIONS) {
    try {
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models?key=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const models = data.models || [];

      // Log available models for debugging
      const modelNames = models.map(m => m.name.replace('models/', ''));
      console.log(`[Gemini] Available models (${apiVersion}):`, modelNames.join(', '));

      // Find the first preferred model that supports generateContent
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

      // If no preferred model found, use any vision-capable model
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

  // Last resort: brute force try each model
  return await bruteForceModel(apiKey);
}

/**
 * Brute-force: try each model+version combo with a tiny request.
 */
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
          console.log(`[Gemini] ✓ Found working model: ${modelName} (${apiVersion})`);
          cachedEndpoint = { apiVersion, modelName };
          return cachedEndpoint;
        }

        const errText = await res.text().catch(() => '');
        // Stop on auth errors
        if (res.status === 403 || res.status === 401 ||
            errText.includes('API_KEY_INVALID') || errText.includes('API key not valid')) {
          throw new Error('API_KEY_INVALID');
        }
        if (res.status === 429) {
          throw new Error('Gemini quota habis. Tunggu 1 menit lalu coba lagi.');
        }
        // 404 = model not found, try next
      } catch (err) {
        if (err.message === 'API_KEY_INVALID' || err.message.includes('quota')) throw err;
        // Network error — try next
      }
    }
  }

  throw new Error('Tidak ada model Gemini yang tersedia. Periksa API key Anda di aistudio.google.com');
}

/**
 * Reset cached endpoint (call when API key changes)
 */
export function resetGeminiCache() {
  cachedEndpoint = null;
}

// ─── Test Connection ──────────────────────────────────────────────────────────
/**
 * Test if API key works and return the working model name.
 * @returns {Promise<{ok: boolean, model?: string, error?: string}>}
 */
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

// ─── Main OCR Function ────────────────────────────────────────────────────────
export async function scanKTPWithGemini(imageSource, apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');

  // Discover the best model
  const { apiVersion, modelName } = await discoverModel(apiKey.trim());

  const { data: base64Data, mimeType } = await fileToBase64(imageSource);

  const requestBody = {
    contents: [
      {
        parts: [
          { text: KTP_PROMPT },
          {
            inline_data: {
              mime_type: mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.05,
      maxOutputTokens: 1024,
      topP: 0.8,
      topK: 10,
    },
  };

  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey.trim()}`;
  console.log(`[Gemini] Scanning KTP with ${modelName} (${apiVersion})...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let errBody = '';
    try { errBody = await response.text(); } catch (_) {}
    console.error('[Gemini] API Error:', response.status, errBody.substring(0, 300));

    // Reset cache so next call re-discovers
    if (response.status === 404) {
      cachedEndpoint = null;
    }

    if (response.status === 403 || (response.status === 400 && errBody.includes('API key'))) {
      throw new Error('API_KEY_INVALID');
    }
    if (response.status === 429) {
      throw new Error('Gemini quota habis. Tunggu 1 menit lalu coba lagi.');
    }
    throw new Error(`Gemini API error (${response.status}): ${errBody.substring(0, 120)}`);
  }

  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) throw new Error('Response kosong dari Gemini API');

  console.log('[Gemini] Raw response:', text.substring(0, 200));

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON tidak ditemukan dalam response');

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('JSON tidak valid: ' + e.message);
  }

  return normalizeAndValidate(parsed);
}

// ─── Post-Processing & Validation ─────────────────────────────────────────────
function normalizeAndValidate(raw) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  let nik = str(raw.nik).replace(/\s/g, '').replace(/[^0-9]/g, '');
  if (nik.length > 16) nik = nik.substring(0, 16);

  let provinsi = str(raw.provinsi).toUpperCase();
  if (provinsi && !provinsi.startsWith('PROVINSI')) provinsi = 'PROVINSI ' + provinsi;
  provinsi = provinsi.replace(/^PROVINSI\s+PROVINSI\s+/i, 'PROVINSI ');

  let kota = str(raw.kota).toUpperCase().replace(/[|\\]/g, '').trim();

  let tempatTglLahir = str(raw.tempatTglLahir).replace(/^WNI\s*/i, '').replace(/[\/\.]/g, '-').trim();
  const tglMatch = tempatTglLahir.match(/(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (tglMatch) {
    const day = tglMatch[1].padStart(2, '0');
    const month = tglMatch[2].padStart(2, '0');
    const year = tglMatch[3].length === 2 ? '19' + tglMatch[3] : tglMatch[3];
    const cityPart = tempatTglLahir.split(/\d/)[0].replace(/[,\s]+$/, '').trim();
    tempatTglLahir = cityPart ? `${cityPart}, ${day}-${month}-${year}` : `${day}-${month}-${year}`;
  }

  let jenisKelamin = str(raw.jenisKelamin).toUpperCase();
  if (jenisKelamin.includes('PEREMPUAN')) jenisKelamin = 'PEREMPUAN';
  else if (jenisKelamin.includes('LAKI')) jenisKelamin = 'LAKI-LAKI';

  let golDarah = str(raw.golDarah).toUpperCase().trim() || '-';
  if (!['A', 'B', 'AB', 'O'].includes(golDarah)) {
    const m = golDarah.match(/\b(A|B|AB|O)\b/);
    golDarah = m ? m[1] : '-';
  }

  let rtRw = str(raw.rtRw).replace(/\s/g, '').replace(/[\\|]/g, '/');
  const rtRwMatch = rtRw.match(/(\d+)\/(\d+)/);
  if (rtRwMatch) rtRw = rtRwMatch[1].padStart(3, '0') + '/' + rtRwMatch[2].padStart(3, '0');

  let berlakuHingga = str(raw.berlakuHingga).toUpperCase();
  if (berlakuHingga.includes('SEUMUR')) {
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

  if (nik.length === 16 && tempatTglLahir) {
    nik = crossValidateNIK(nik, tempatTglLahir, jenisKelamin);
  }

  return {
    provinsi, kota, nik,
    nama: str(raw.nama).toUpperCase(),
    tempatTglLahir, jenisKelamin, golDarah,
    alamat, rtRw,
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

function crossValidateNIK(nik, tempatTglLahir, jenisKelamin) {
  const dateMatch = tempatTglLahir.match(/(\d{2})-(\d{2})-(\d{2,4})/);
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
    console.log(`[NIK Repair] ${nikDob} → ${expectedDob}`);
    return prefix + expectedDob + seq;
  }
  return nik;
}
