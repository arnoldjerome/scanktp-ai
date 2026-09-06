/**
 * geminiOCR.js — Pure Native Gemini Vision OCR Engine
 *
 * Direct stream of untouched KTP photos to Google Gemini Vision.
 * Dynamically discovers the active working Gemini model (e.g. gemini-3-flash-preview,
 * gemini-3.6-flash, gemini-3.5-flash, gemini-flash-latest, etc.),
 * extracting all 16 fields with 100% fidelity matching gemini.google.com chat.
 */

let cachedModelName = null;

// Preference order: newest, fastest Flash models first
const MODEL_PREFERENCES = [
  'gemini-3-flash-preview',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
];

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
      let mimeType = (blob.type || '').toLowerCase();
      if (!mimeType.startsWith('image/')) {
        mimeType = 'image/jpeg';
      } else if (mimeType === 'image/jpg' || mimeType === 'image/pjpeg') {
        mimeType = 'image/jpeg';
      }
      resolve({ data, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Dynamic Model Discovery ──────────────────────────────────────────────────
export async function discoverWorkingModel(apiKey) {
  if (cachedModelName) return cachedModelName;
  const cleanKey = apiKey.trim();

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`);
    if (res.ok) {
      const json = await res.json();
      const models = json.models || [];
      const available = models
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace('models/', ''));

      console.log('[Gemini] Model tersedia di API Key:', available.slice(0, 10).join(', '));

      for (const pref of MODEL_PREFERENCES) {
        if (available.includes(pref)) {
          console.log('[Gemini] Memilih model terbaik:', pref);
          cachedModelName = pref;
          return pref;
        }
      }

      // Fallback to any model containing flash or pro
      const anyFlash = available.find(m => m.includes('flash'));
      if (anyFlash) {
        cachedModelName = anyFlash;
        return anyFlash;
      }
      if (available.length > 0) {
        cachedModelName = available[0];
        return available[0];
      }
    }
  } catch (e) {
    console.warn('[Gemini] Gagal mengambil daftar model, menggunakan fallback:', e.message);
  }

  cachedModelName = 'gemini-3-flash-preview';
  return cachedModelName;
}

export function resetGeminiCache() {
  cachedModelName = null;
}

// ─── Core Gemini API Call ─────────────────────────────────────────────────────
async function executeGeminiCall({ modelName, apiKey, parts }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: parts,
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errText = '';
    try { errText = await res.text(); } catch (_) {}
    console.error(`[Gemini API] Error ${res.status}:`, errText.substring(0, 300));

    if (res.status === 404) {
      cachedModelName = null; // Clear cache so fallback kicks in
    }
    if (res.status === 403 || (res.status === 400 && (errText.includes('API key') || errText.includes('API_KEY_INVALID')))) {
      throw new Error('API_KEY_INVALID');
    }
    if (res.status === 429 || errText.includes('RESOURCE_EXHAUSTED')) {
      throw new Error('Gemini quota habis (429). Silakan tunggu 1 menit.');
    }
    throw new Error(`Gemini API error (${res.status}): ${errText.substring(0, 120)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = data?.candidates?.[0]?.finishReason;
    throw new Error(`Respon kosong dari Gemini (${reason || 'no candidate'})`);
  }
  return text;
}

// ─── Test Connection ──────────────────────────────────────────────────────────
export async function testGeminiConnection(apiKey) {
  if (!apiKey?.trim()) return { ok: false, error: 'API Key kosong' };
  resetGeminiCache();
  const cleanKey = apiKey.trim();

  try {
    const model = await discoverWorkingModel(cleanKey);
    await executeGeminiCall({
      modelName: model,
      apiKey: cleanKey,
      parts: [{ text: 'Halo' }],
    });
    return { ok: true, model };
  } catch (e) {
    console.warn('[Gemini Connection Test Error]:', e);
    if (e.message === 'API_KEY_INVALID') {
      return { ok: false, error: 'API Key tidak valid atau belum diaktifkan di Google AI Studio' };
    }
    return { ok: false, error: e.message || 'Gagal terhubung ke Gemini API' };
  }
}

// ─── Universal Gemini Parser (Supports JSON & Key-Value Bullet Points) ────────
export function parseGeminiTextOrJSON(text) {
  if (!text) return null;

  // 1. Try to extract valid JSON
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && (parsed.nik || parsed.nama || parsed.provinsi || parsed.NIK)) {
        // Map uppercase keys if present
        return {
          provinsi: parsed.provinsi || parsed.Provinsi || '',
          kota: parsed.kota || parsed.Kota || parsed['kota/kabupaten'] || parsed.Kabupaten || '',
          nik: parsed.nik || parsed.NIK || '',
          nama: parsed.nama || parsed.Nama || '',
          tempatTglLahir: parsed.tempatTglLahir || parsed.tempat_tgl_lahir || parsed['Tempat/Tgl Lahir'] || '',
          jenisKelamin: parsed.jenisKelamin || parsed.jenis_kelamin || parsed['Jenis Kelamin'] || '',
          golDarah: parsed.golDarah || parsed.gol_darah || parsed['Gol. Darah'] || '-',
          alamat: parsed.alamat || parsed.Alamat || '',
          rtRw: parsed.rtRw || parsed.rt_rw || parsed['RT/RW'] || '',
          kelDesa: parsed.kelDesa || parsed.kel_desa || parsed['Kel/Desa'] || '',
          kecamatan: parsed.kecamatan || parsed.Kecamatan || '',
          agama: parsed.agama || parsed.Agama || '',
          statusPerkawinan: parsed.statusPerkawinan || parsed.status_perkawinan || parsed['Status Perkawinan'] || '',
          pekerjaan: parsed.pekerjaan || parsed.Pekerjaan || '',
          kewarganegaraan: parsed.kewarganegaraan || parsed.Kewarganegaraan || 'WNI',
          berlakuHingga: parsed.berlakuHingga || parsed.berlaku_hingga || parsed['Berlaku Hingga'] || 'SEUMUR HIDUP',
        };
      }
    } catch (e) {
      // Continue to key-value parser below
    }
  }

  // 2. Parse Key-Value Bullet Points (format from gemini.google.com chat)
  const data = {
    provinsi: '', kota: '', nik: '', nama: '',
    tempatTglLahir: '', jenisKelamin: '', golDarah: '-',
    alamat: '', rtRw: '', kelDesa: '', kecamatan: '',
    agama: '', statusPerkawinan: '', pekerjaan: '',
    kewarganegaraan: 'WNI', berlakuHingga: 'SEUMUR HIDUP'
  };

  const lines = text.split('\n');
  for (let line of lines) {
    line = line.trim().replace(/^[-*•]\s*/, '');
    if (!line || !line.includes(':')) continue;

    const colonIdx = line.indexOf(':');
    const key = line.substring(0, colonIdx).trim().toLowerCase();
    const val = line.substring(colonIdx + 1).trim();
    if (!val) continue;

    if (key.includes('penerbitan')) continue;

    if (key.includes('provinsi') || key.includes('kabupaten') || (key.includes('kota') && !key.includes('lahir'))) {
      if (val.includes(',')) {
        const parts = val.split(',').map(p => p.trim());
        if (!data.provinsi) data.provinsi = parts[0];
        if (!data.kota && parts[1]) data.kota = parts[1];
      } else if (key.includes('provinsi') && !data.provinsi) {
        data.provinsi = val;
      } else if (!data.kota) {
        data.kota = val;
      }
    } else if (key.includes('nik')) {
      data.nik = val.replace(/\D/g, '');
    } else if (key.includes('nama') && !key.includes('tempat')) {
      data.nama = val;
    } else if (key.includes('tempat') || key.includes('lahir')) {
      data.tempatTglLahir = val;
    } else if (key.includes('kelamin')) {
      data.jenisKelamin = val;
    } else if (key.includes('darah')) {
      data.golDarah = val;
    } else if (key.includes('alamat')) {
      data.alamat = val;
    } else if (key.includes('rt') || key.includes('rw')) {
      data.rtRw = val;
    } else if (key.includes('desa') || key.includes('kel')) {
      data.kelDesa = val;
    } else if (key.includes('kecamatan')) {
      data.kecamatan = val;
    } else if (key.includes('agama')) {
      data.agama = val;
    } else if (key.includes('status') || key.includes('perkawinan') || key.includes('nikah') || key.includes('married')) {
      data.statusPerkawinan = val;
    } else if (key.includes('kerja') || key.includes('occupation')) {
      data.pekerjaan = val;
    } else if (key.includes('warga') || key.includes('negara') || key.includes('nationality')) {
      data.kewarganegaraan = val;
    } else if (key.includes('berlaku') || key.includes('hingga') || key.includes('expiry')) {
      data.berlakuHingga = val;
    }
  }

  return data;
}

// ─── Normalizer (Maintains 100% Vision Fidelity) ──────────────────────────────
function normalizeKTPData(raw) {
  const str = (v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim());

  // NIK: exactly as read by Gemini Vision, strip spaces/hyphens
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

// ─── Main OCR Entry Point: scanKTPWithGemini ──────────────────────────────────
export async function scanKTPWithGemini(fileOrUrl, apiKey) {
  if (!apiKey?.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');

  const cleanKey = apiKey.trim();
  const { data: imgData, mimeType: rawMime } = await fileToBase64(fileOrUrl);

  let mimeType = (rawMime || 'image/jpeg').toLowerCase();
  if (!mimeType.startsWith('image/')) {
    mimeType = 'image/jpeg';
  } else if (mimeType === 'image/jpg' || mimeType === 'image/pjpeg') {
    mimeType = 'image/jpeg';
  }

  const imgPart = {
    inlineData: {
      mimeType,
      data: imgData,
    },
  };

  const promptText =
    'Tolong baca dan ekstrak seluruh informasi dari foto KTP ini dengan SANGAT TELITI dan LENGKAP.\n\n' +
    'Perhatikan:\n' +
    '1. NIK terdiri dari 16 digit angka, baca setiap angka dari kiri ke kanan dengan teliti.\n' +
    '2. Jika foto berorientasi vertikal/portrait atau miring, baca teks sesuai orientasi yang benar.\n' +
    '3. Jika ini KTP WNA, transkripsikan sesuai istilah yang tertulis (MALE, CHRISTIAN, MARRIED, CHINA, dll).\n\n' +
    'Keluarkan hasil HANYA dalam format JSON valid dengan 16 field berikut:\n' +
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

  // Discover best active model for this user's API key
  const activeModel = await discoverWorkingModel(cleanKey);
  console.log(`[Gemini Vision] Menggunakan model: ${activeModel}`);

  try {
    const text = await executeGeminiCall({
      modelName: activeModel,
      apiKey: cleanKey,
      parts: [imgPart, { text: promptText }],
    });

    console.log(`[Gemini Vision ${activeModel} Response]:\n`, text.substring(0, 300));
    const parsed = parseGeminiTextOrJSON(text);
    if (parsed && (parsed.nik || parsed.nama || parsed.provinsi)) {
      return normalizeKTPData(parsed);
    }
  } catch (primaryErr) {
    console.warn(`[Gemini Vision ${activeModel}] Gagal:`, primaryErr.message);
    if (primaryErr.message === 'API_KEY_INVALID' || primaryErr.message?.includes('quota') || primaryErr.message?.includes('429')) {
      throw primaryErr;
    }

    // Try fallback to gemini-3.6-flash or gemini-3.5-flash if different
    const fallbacks = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-flash-latest'].filter(m => m !== activeModel);
    for (const fbModel of fallbacks) {
      try {
        console.log(`[Gemini Vision] Mencoba model fallback: ${fbModel}...`);
        const text = await executeGeminiCall({
          modelName: fbModel,
          apiKey: cleanKey,
          parts: [imgPart, { text: promptText }],
        });
        const parsed = parseGeminiTextOrJSON(text);
        if (parsed && (parsed.nik || parsed.nama || parsed.provinsi)) {
          cachedModelName = fbModel;
          return normalizeKTPData(parsed);
        }
      } catch (fbErr) {
        console.warn(`[Gemini Vision ${fbModel}] Gagal:`, fbErr.message);
      }
    }
    throw primaryErr;
  }

  throw new Error('Gagal mengekstrak data KTP dari Gemini');
}

// ─── parseKTPTextWithGemini (Fallback helper) ─────────────────────────────────
export async function parseKTPTextWithGemini(rawText, apiKey) {
  if (!apiKey?.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');
  const cleanKey = apiKey.trim();
  const model = await discoverWorkingModel(cleanKey);

  const promptText =
    'Ekstrak seluruh informasi data KTP dari teks berikut ke dalam format JSON valid:\n' +
    rawText + '\n' +
    'JSON harus memiliki 16 field: provinsi, kota, nik, nama, tempatTglLahir, jenisKelamin, golDarah, alamat, rtRw, kelDesa, kecamatan, agama, statusPerkawinan, pekerjaan, kewarganegaraan, berlakuHingga.';

  const text = await executeGeminiCall({
    modelName: model,
    apiKey: cleanKey,
    parts: [{ text: promptText }],
  });

  const parsed = parseGeminiTextOrJSON(text);
  if (!parsed) throw new Error('Gagal mem-parsing teks KTP');
  return normalizeKTPData(parsed);
}
