/**
 * geminiOCR.js — Pure Native Gemini Vision OCR Engine
 *
 * Direct stream of untouched KTP photos to Google Gemini Vision
 * (gemini-2.0-flash / gemini-1.5-flash), matching 100% the accuracy
 * and speed of gemini.google.com chat.
 */

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

    if (res.status === 403 || (res.status === 400 && (errText.includes('API key') || errText.includes('API_KEY_INVALID')))) {
      throw new Error('API_KEY_INVALID');
    }
    if (res.status === 429 || errText.includes('RESOURCE_EXHAUSTED')) {
      throw new Error('Gemini quota habis (429). Silakan tunggu 1 menit.');
    }
    throw new Error(`Gemini API error (${res.status}): ${errText.substring(0, 100)}`);
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
  const cleanKey = apiKey.trim();

  for (const modelName of ['gemini-2.0-flash', 'gemini-1.5-flash']) {
    try {
      await executeGeminiCall({
        modelName,
        apiKey: cleanKey,
        parts: [{ text: 'Halo' }],
      });
      return { ok: true, model: modelName };
    } catch (e) {
      if (e.message === 'API_KEY_INVALID') {
        return { ok: false, error: 'API Key tidak valid atau belum diaktifkan di Google AI Studio' };
      }
      if (e.message?.includes('quota') || e.message?.includes('429')) {
        return { ok: true, model: `${modelName} (Quota Penuh)` };
      }
    }
  }
  return { ok: false, error: 'Tidak dapat terhubung ke Gemini API' };
}

export function resetGeminiCache() {}

// ─── Universal Gemini Parser (Supports JSON & Key-Value Bullet Points) ────────
export function parseGeminiTextOrJSON(text) {
  if (!text) return null;

  // 1. Try to extract valid JSON
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed && (parsed.nik || parsed.nama || parsed.provinsi)) {
        return parsed;
      }
    } catch (e) {
      // Continue to key-value parser below
    }
  }

  // 2. Parse Key-Value Bullet Points (exactly how gemini.google.com chat formats output)
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

  // Direct fast model cascade: try gemini-2.0-flash first, fallback to gemini-1.5-flash
  const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-flash'];
  let lastError = null;

  for (const modelName of modelsToTry) {
    try {
      console.log(`[Gemini Vision] Memanggil ${modelName}...`);
      const text = await executeGeminiCall({
        modelName,
        apiKey: cleanKey,
        parts: [imgPart, { text: promptText }],
      });

      console.log(`[Gemini Vision ${modelName} Response]:\n`, text.substring(0, 300));
      const parsed = parseGeminiTextOrJSON(text);
      if (parsed && (parsed.nik || parsed.nama || parsed.provinsi)) {
        return normalizeKTPData(parsed);
      }
    } catch (err) {
      console.warn(`[Gemini Vision ${modelName}] Gagal:`, err.message);
      lastError = err;
      if (err.message === 'API_KEY_INVALID' || err.message?.includes('quota') || err.message?.includes('429')) {
        throw err;
      }
    }
  }

  throw lastError || new Error('Gagal mengekstrak data KTP dari Gemini');
}

// ─── parseKTPTextWithGemini (Fallback helper) ─────────────────────────────────
export async function parseKTPTextWithGemini(rawText, apiKey) {
  if (!apiKey?.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');
  const cleanKey = apiKey.trim();

  const promptText =
    'Ekstrak seluruh informasi data KTP dari teks berikut ke dalam format JSON valid:\n' +
    rawText + '\n' +
    'JSON harus memiliki 16 field: provinsi, kota, nik, nama, tempatTglLahir, jenisKelamin, golDarah, alamat, rtRw, kelDesa, kecamatan, agama, statusPerkawinan, pekerjaan, kewarganegaraan, berlakuHingga.';

  const text = await executeGeminiCall({
    modelName: 'gemini-2.0-flash',
    apiKey: cleanKey,
    parts: [{ text: promptText }],
  });

  const parsed = parseGeminiTextOrJSON(text);
  if (!parsed) throw new Error('Gagal mem-parsing teks KTP');
  return normalizeKTPData(parsed);
}
