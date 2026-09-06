/**
 * geminiOCR.js — Pure Native Gemini Vision OCR Engine
 *
 * Sends the untouched, natural image directly to Google Gemini Vision
 * (gemini-2.0-flash / gemini-1.5-flash) exactly like gemini.google.com,
 * preserving full resolution, dot-matrix NIK numbers, and handling
 * any card orientation, lighting, WNI, and WNA formats.
 */

// ─── Configuration ────────────────────────────────────────────────────────────
const API_VERSIONS = ['v1beta', 'v1'];
const PREFERRED_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro',
  'gemini-1.5-pro-latest',
  'gemini-2.0-flash-exp',
];

// BLOCK_ONLY_HIGH is universally supported across free-tier & enterprise Google AI Studio keys
const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
];

let cachedEndpoint = null;

// ─── High-Fidelity Gemini Vision Prompts ───────────────────────────────────────
const SYSTEM_PROMPT =
  'Anda adalah sistem AI Vision profesional tingkat tinggi dengan spesialisasi membaca dan mentranskripsikan Kartu Tanda Penduduk Republik Indonesia (e-KTP), baik untuk WNI (Warga Negara Indonesia) maupun WNA (Warga Negara Asing / KITAS / KITAP).\n' +
  'Tugas Anda adalah membaca seluruh data yang tertera pada kartu dengan 100% akurat tanpa melewatkan satu huruf atau angka pun.';

const KTP_VISION_PROMPT =
  'Tolong baca dan ekstrak seluruh informasi dari foto KTP ini dengan SANGAT TELITI dan AKURAT.\n\n' +
  'PANDUAN PEMBACAAN KHUSUS:\n' +
  '1. ORIENTASI & SUDUT: Jika kartu difoto dalam posisi vertikal (portrait), terbalik, atau miring, baca teksnya sesuai arah orientasi kartu yang sebenarnya.\n' +
  '2. NIK (16 DIGIT ANGKA):\n' +
  '   - NIK terletak di samping atau bawah label NIK.\n' +
  '   - Transkripsikan ke-16 digit angka NIK satu per satu dari kiri ke kanan dengan sangat teliti.\n' +
  '   - Jangan pernah mengurangi digit atau salah membaca angka dot-matrix (misal angka 0004 atau 0001 di akhir harus tetap lengkap dan benar).\n' +
  '   - NIK HARUS tepat 16 digit angka murni.\n' +
  '3. KTP WNA (WARGA NEGARA ASING / KITAS / KITAP):\n' +
  '   - KTP WNA sering kali memiliki teks dalam bahasa Inggris (misal: Jenis Kelamin: MALE/FEMALE, Agama: CHRISTIAN, Status: MARRIED, Kewarganegaraan: CHINA / MALAYSIA / AUSTRALIA dsb, Pekerjaan: OTHERS).\n' +
  '   - Ekstrak nilainya sesuai yang tertera pada kartu.\n' +
  '4. STATUS PERKAWINAN: Catat sesuai tulisan (BELUM KAWIN, BELUM MENIKAH, KAWIN, MARRIED, CERAI HIDUP, CERAI MATI).\n' +
  '5. FORMAT TEMPAT/TGL LAHIR: "KOTA, DD-MM-YYYY" (contoh: "WONOGIRI, 14-03-2001" atau "SEMARANG, 20-04-2004" atau "FUJIAN, 25-03-1977").\n\n' +
  'Kembalikan HANYA objek JSON valid (tanpa teks penjelasan lain) dengan 16 atribut berikut:\n' +
  '{\n' +
  '  "provinsi": "...",\n' +
  '  "kota": "...",\n' +
  '  "nik": "...",\n' +
  '  "nama": "...",\n' +
  '  "tempatTglLahir": "...",\n' +
  '  "jenisKelamin": "...",\n' +
  '  "golDarah": "...",\n' +
  '  "alamat": "...",\n' +
  '  "rtRw": "...",\n' +
  '  "kelDesa": "...",\n' +
  '  "kecamatan": "...",\n' +
  '  "agama": "...",\n' +
  '  "statusPerkawinan": "...",\n' +
  '  "pekerjaan": "...",\n' +
  '  "kewarganegaraan": "...",\n' +
  '  "berlakuHingga": "..."\n' +
  '}';

// ─── File / URL to Base64 (Untouched raw binary) ──────────────────────────────
export async function fileToBase64(fileOrUrl) {
  if (typeof fileOrUrl === 'string') {
    if (fileOrUrl.startsWith('data:')) {
      const parts = fileOrUrl.split(',');
      const mime = parts[0].split(';')[0].split(':')[1] || 'image/jpeg';
      return { data: parts[1], mimeType: mime };
    }
    const res = await fetch(fileOrUrl);
    const blob = await res.blob();
    return blobToBase64(blob);
  }
  if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
    return blobToBase64(fileOrUrl);
  }
  throw new Error('Format sumber gambar tidak valid');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const data = result.split(',')[1];
      const mimeType = blob.type || 'image/jpeg';
      resolve({ data, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Model Discovery ──────────────────────────────────────────────────────────
export async function discoverModel(apiKey) {
  if (cachedEndpoint) return cachedEndpoint;
  console.log('[Gemini] Menemukan model aktif...');

  for (const apiVersion of API_VERSIONS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/${apiVersion}/models?key=${apiKey}`);
      if (!res.ok) continue;
      const { models = [] } = await res.json();
      const modelNames = models.map(m => m.name.replace('models/', ''));
      console.log(`[Gemini] Model tersedia (${apiVersion}):`, modelNames.join(', '));

      for (const preferred of PREFERRED_MODELS) {
        const found = models.find(m =>
          m.name.replace('models/', '') === preferred &&
          m.supportedGenerationMethods?.includes('generateContent')
        );
        if (found) {
          const modelName = found.name.replace('models/', '');
          console.log('[Gemini] Model terpilih:', modelName);
          cachedEndpoint = { apiVersion, modelName };
          return cachedEndpoint;
        }
      }

      // Fallback to any flash or pro model
      const anyFlash = models.find(m =>
        m.supportedGenerationMethods?.includes('generateContent') &&
        (m.name.includes('flash') || m.name.includes('pro'))
      );
      if (anyFlash) {
        const modelName = anyFlash.name.replace('models/', '');
        console.log('[Gemini] Model alternatif:', modelName);
        cachedEndpoint = { apiVersion, modelName };
        return cachedEndpoint;
      }
    } catch (e) {
      console.warn(`[Gemini] List models (${apiVersion}) gagal:`, e.message);
    }
  }

  // Fallback defaults
  cachedEndpoint = { apiVersion: 'v1beta', modelName: 'gemini-2.0-flash' };
  return cachedEndpoint;
}

export function resetGeminiCache() {
  cachedEndpoint = null;
}

// ─── Core Gemini API Call ─────────────────────────────────────────────────────
async function callGemini({ apiVersion, modelName, apiKey, parts, jsonMode = true, temperature = 0.1 }) {
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;

  const genConfig = {
    temperature,
    maxOutputTokens: 2048,
    topP: 0.95,
  };

  if (jsonMode) {
    genConfig.responseMimeType = 'application/json';
  }

  const body = {
    contents: [
      {
        role: 'user',
        parts: parts,
      }
    ],
    generationConfig: genConfig,
    safetySettings: SAFETY_SETTINGS,
  };

  if (apiVersion === 'v1beta') {
    body.systemInstruction = {
      parts: [{ text: SYSTEM_PROMPT }]
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errBody = '';
    try { errBody = await res.text(); } catch (_) {}
    console.error(`[Gemini] Error ${res.status}:`, errBody.substring(0, 300));

    if (res.status === 404) {
      cachedEndpoint = null;
    }
    if (res.status === 403 || (res.status === 400 && (errBody.includes('API key') || errBody.includes('API_KEY_INVALID')))) {
      throw new Error('API_KEY_INVALID');
    }
    if (res.status === 429 || errBody.includes('RESOURCE_EXHAUSTED')) {
      throw new Error('Gemini quota habis (Rate limit 429). Tunggu 1 menit.');
    }

    // If responseMimeType: 'application/json' caused 400 on an older model endpoint, retry without it
    if (res.status === 400 && jsonMode) {
      console.warn('[Gemini] Mengulang panggilan tanpa responseMimeType...');
      return callGemini({ apiVersion, modelName, apiKey, parts, jsonMode: false, temperature });
    }

    throw new Error(`Gemini error (${res.status}): ${errBody.substring(0, 120)}`);
  }

  const result = await res.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = result?.candidates?.[0]?.finishReason;
    if (reason && reason !== 'STOP') {
      throw new Error(`Gemini diblokir sistem keamanan: ${reason}`);
    }
    throw new Error('Response kosong dari Gemini');
  }
  return text;
}

// ─── Test Connection ──────────────────────────────────────────────────────────
export async function testGeminiConnection(apiKey) {
  if (!apiKey?.trim()) return { ok: false, error: 'API Key kosong' };
  resetGeminiCache();
  try {
    const endpoint = await discoverModel(apiKey.trim());
    // Test a real generateContent ping to ensure key works
    await callGemini({
      apiVersion: endpoint.apiVersion,
      modelName: endpoint.modelName,
      apiKey: apiKey.trim(),
      parts: [{ text: 'Halo' }],
      jsonMode: false,
      temperature: 0.0,
    });
    return { ok: true, model: endpoint.modelName };
  } catch (e) {
    console.warn('[Gemini Connection Test Error]:', e);
    if (e.message === 'API_KEY_INVALID') {
      return { ok: false, error: 'API Key tidak valid atau belum diaktifkan di Google AI Studio' };
    }
    return { ok: false, error: e.message || 'Gagal terhubung ke Gemini API' };
  }
}

// ─── JSON Parser ──────────────────────────────────────────────────────────────
function extractJSON(text) {
  if (!text) return null;
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    console.warn('[extractJSON] Parse failed:', e);
    return null;
  }
}

// ─── Main OCR Entry Point: scanKTPWithGemini ──────────────────────────────────
/**
 * Takes the raw original image and sends it directly to Gemini Vision
 * with 0% distortion, exactly like uploading to gemini.google.com.
 */
export async function scanKTPWithGemini(fileOrUrl, apiKey) {
  if (!apiKey?.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');

  const { apiVersion, modelName } = await discoverModel(apiKey.trim());
  console.log(`[Gemini Vision] Menggunakan model: ${modelName} (${apiVersion})`);

  // Direct byte-to-byte base64 conversion of the raw image
  const { data: imgData, mimeType: imgMime } = await fileToBase64(fileOrUrl);

  const imgPart = {
    inlineData: {
      mimeType: imgMime && imgMime.startsWith('image/') ? imgMime : 'image/jpeg',
      data: imgData,
    },
  };

  const textPart = {
    text: KTP_VISION_PROMPT,
  };

  // Primary attempt: Multimodal Vision with JSON output
  const text = await callGemini({
    apiVersion,
    modelName,
    apiKey: apiKey.trim(),
    parts: [imgPart, textPart],
    jsonMode: true,
    temperature: 0.1,
  });

  console.log('[Gemini Vision Response]:\n', text.substring(0, 500));
  let parsed = extractJSON(text);

  // Fallback: If for any reason JSON extraction failed, retry with pure text instruction
  if (!parsed) {
    console.warn('[Gemini Vision] Mencoba ulang dengan prompt cadangan...');
    const retryText = await callGemini({
      apiVersion,
      modelName,
      apiKey: apiKey.trim(),
      parts: [
        imgPart,
        {
          text: 'Tuliskan seluruh data KTP ini dalam format JSON murni dengan 16 field:\n' +
                '{"provinsi":"","kota":"","nik":"","nama":"","tempatTglLahir":"",' +
                '"jenisKelamin":"","golDarah":"","alamat":"","rtRw":"","kelDesa":"",' +
                '"kecamatan":"","agama":"","statusPerkawinan":"","pekerjaan":"",' +
                '"kewarganegaraan":"","berlakuHingga":""}'
        }
      ],
      jsonMode: false,
      temperature: 0.0,
    });
    parsed = extractJSON(retryText);
  }

  if (!parsed) {
    throw new Error('Gemini tidak mengembalikan format data KTP yang valid');
  }

  return normalizeAndValidate(parsed);
}

// ─── Post-Processing & Normalization (Preserves Gemini\'s Vision Accuracy) ─────
function normalizeAndValidate(raw) {
  const str = (v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim());

  // NIK: Preserve Gemini Vision read, clean spaces/hyphens
  let nik = str(raw.nik).replace(/[\s-]/g, '');
  nik = nik.replace(/[Oo]/g, '0').replace(/[lIi]/g, '1').replace(/[^0-9]/g, '');
  if (nik.length > 16) nik = nik.substring(0, 16);

  // Provinsi
  let provinsi = str(raw.provinsi).toUpperCase();
  if (provinsi && !provinsi.startsWith('PROVINSI')) provinsi = 'PROVINSI ' + provinsi;
  provinsi = provinsi.replace(/^PROVINSI\s+PROVINSI\s+/i, 'PROVINSI ');

  // Kota
  let kota = str(raw.kota).toUpperCase()
    .replace(/\bKAPATI\b/g, 'KABUPATEN')
    .replace(/\bKABUPATEN\s+KABUPATEN\b/g, 'KABUPATEN')
    .replace(/[|\\]/g, '').trim();

  // Tempat / Tgl Lahir
  let tempatTglLahir = str(raw.tempatTglLahir)
    .replace(/^WNI\s*/i, '')
    .replace(/^WNA\s*/i, '')
    .trim()
    .toUpperCase();

  // Normalize separators in date to hyphen
  const tglMatch = tempatTglLahir.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (tglMatch) {
    const day   = tglMatch[1].padStart(2, '0');
    const month = tglMatch[2].padStart(2, '0');
    const year  = tglMatch[3].length === 2 ? '19' + tglMatch[3] : tglMatch[3];
    const city  = tempatTglLahir.split(/\d/)[0].replace(/[,\s/.-]+$/, '').trim();
    tempatTglLahir = city ? `${city}, ${day}-${month}-${year}` : `${day}-${month}-${year}`;
  }

  // Jenis Kelamin
  let jenisKelamin = str(raw.jenisKelamin).toUpperCase();
  if (jenisKelamin.includes('PEREMPUAN') || jenisKelamin.includes('FEMALE')) {
    jenisKelamin = 'PEREMPUAN';
  } else if (jenisKelamin.includes('LAKI') || jenisKelamin.includes('MALE')) {
    jenisKelamin = 'LAKI-LAKI';
  }

  // Gol Darah
  let golDarah = str(raw.golDarah).toUpperCase().trim();
  if (!['A', 'B', 'AB', 'O'].includes(golDarah)) {
    const m = golDarah.match(/\b(AB|A|B|O)\b/);
    golDarah = m ? m[1] : '-';
  }

  // RT/RW
  let rtRw = str(raw.rtRw).replace(/\s/g, '').replace(/[\\|]/g, '/');
  const rtMatch = rtRw.match(/(\d+)\/(\d+)/);
  if (rtMatch) {
    rtRw = rtMatch[1].padStart(3, '0') + '/' + rtMatch[2].padStart(3, '0');
  }

  // Status Perkawinan
  let statusPerkawinan = str(raw.statusPerkawinan).toUpperCase();
  if (statusPerkawinan.includes('BELUM') || statusPerkawinan.includes('SINGLE')) {
    statusPerkawinan = 'BELUM KAWIN';
  } else if (statusPerkawinan.includes('MARRIED') || statusPerkawinan.includes('KAWIN') || statusPerkawinan.includes('MENIKAH')) {
    statusPerkawinan = 'KAWIN';
  } else if (statusPerkawinan.includes('CERAI HIDUP') || statusPerkawinan.includes('DIVORCED')) {
    statusPerkawinan = 'CERAI HIDUP';
  } else if (statusPerkawinan.includes('CERAI MATI') || statusPerkawinan.includes('WIDOWED')) {
    statusPerkawinan = 'CERAI MATI';
  }

  // Kewarganegaraan
  let kewarganegaraan = str(raw.kewarganegaraan).toUpperCase();
  if (!kewarganegaraan || kewarganegaraan.includes('INDONESIA') || kewarganegaraan === 'WNI') {
    kewarganegaraan = 'WNI';
  } else if (!kewarganegaraan.startsWith('WNA') && kewarganegaraan !== 'WNI') {
    kewarganegaraan = `WNA (${kewarganegaraan})`;
  }

  // Berlaku Hingga
  let berlakuHingga = str(raw.berlakuHingga).toUpperCase();
  if (berlakuHingga.includes('SEUMUR') || berlakuHingga.includes('LIFETIME')) {
    berlakuHingga = 'SEUMUR HIDUP';
  } else {
    const dates = berlakuHingga.match(/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g);
    if (dates?.length) {
      const parts = dates[0].replace(/[/.]/g, '-').split('-');
      berlakuHingga = parts.length === 3
        ? parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0') + '-' + parts[2]
        : dates[0];
    }
  }

  return {
    provinsi,
    kota,
    nik,
    nama:             str(raw.nama).toUpperCase(),
    tempatTglLahir,
    jenisKelamin,
    golDarah,
    alamat:           str(raw.alamat).toUpperCase().replace(/[|\\]+$/, '').trim(),
    rtRw,
    kelDesa:          str(raw.kelDesa).toUpperCase(),
    kecamatan:        str(raw.kecamatan).toUpperCase(),
    agama:            str(raw.agama).toUpperCase(),
    statusPerkawinan,
    pekerjaan:        str(raw.pekerjaan).toUpperCase().replace(/[|\\]/g, '').trim(),
    kewarganegaraan,
    berlakuHingga,
    rawText: JSON.stringify(raw, null, 2),
  };
}

// ─── parseKTPTextWithGemini: Text-only parsing (Fallback helper) ───────────────
export async function parseKTPTextWithGemini(rawText, apiKey) {
  if (!apiKey?.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');
  if (!rawText?.trim()) throw new Error('Raw OCR text is empty');

  const { apiVersion, modelName } = await discoverModel(apiKey.trim());

  const prompt = [
    'Ekstrak seluruh informasi data KTP dari teks OCR berikut ke dalam format JSON valid:',
    '---',
    rawText,
    '---',
    'JSON harus memiliki 16 field: provinsi, kota, nik, nama, tempatTglLahir, jenisKelamin, golDarah, alamat, rtRw, kelDesa, kecamatan, agama, statusPerkawinan, pekerjaan, kewarganegaraan, berlakuHingga.'
  ].join('\n');

  const text = await callGemini({
    apiVersion,
    modelName,
    apiKey: apiKey.trim(),
    parts: [{ text: prompt }],
    jsonMode: true,
    temperature: 0.0,
  });

  const parsed = extractJSON(text);
  if (!parsed) throw new Error('Gemini text parsing returned no valid JSON');
  return normalizeAndValidate(parsed);
}
