/**
 * geminiOCR.js v4 — Maximum Accuracy Edition
 *
 * Key improvements:
 * 1. responseSchema + response_mime_type:'application/json'  → forces ALL 16 fields
 * 2. systemInstruction → expert OCR role
 * 3. 3-strategy fallback: structured → two-pass → single-pass
 * 4. Smart image optimization (resize + contrast, full image sent to Gemini)
 * 5. Safer NIK validation (won't mangle correct NIKs)
 */

// ─── Configuration ────────────────────────────────────────────────────────────
const API_VERSIONS = ['v1beta', 'v1'];
const PREFERRED_MODELS = [
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash-lite',
  'gemini-1.5-pro',
  'gemini-1.5-pro-latest',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-pro-vision',
];

let cachedEndpoint = null;

// ─── responseSchema: forces Gemini to output ALL 16 fields ───────────────────
const KTP_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    provinsi:         { type: 'STRING' },
    kota:             { type: 'STRING' },
    nik:              { type: 'STRING' },
    nama:             { type: 'STRING' },
    tempatTglLahir:   { type: 'STRING' },
    jenisKelamin:     { type: 'STRING' },
    golDarah:         { type: 'STRING' },
    alamat:           { type: 'STRING' },
    rtRw:             { type: 'STRING' },
    kelDesa:          { type: 'STRING' },
    kecamatan:        { type: 'STRING' },
    agama:            { type: 'STRING' },
    statusPerkawinan: { type: 'STRING' },
    pekerjaan:        { type: 'STRING' },
    kewarganegaraan:  { type: 'STRING' },
    berlakuHingga:    { type: 'STRING' },
  },
};

// ─── systemInstruction ────────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION =
  'You are an expert OCR system specialized in Indonesian National ID Cards (e-KTP). ' +
  'Extract ALL data fields accurately. NEVER leave a field empty if the text is visible. ' +
  'Read the NIK (16-digit number) one digit at a time with extreme care. ' +
  'The card has a teal/cyan background with a watermark pattern — ignore the watermark, read only the printed text.';

// ─── Main extraction prompt ───────────────────────────────────────────────────
const KTP_PROMPT =
  'Extract ALL 16 data fields from this Indonesian e-KTP (National ID Card).\n\n' +
  'CARD LAYOUT (fields in this order):\n' +
  '1. provinsi  — Province header starting with PROVINSI (e.g. PROVINSI JAWA TIMUR)\n' +
  '2. kota      — City/Regency: KABUPATEN ... or KOTA ... (e.g. KABUPATEN GRESIK)\n' +
  '3. nik       — EXACTLY 16 digits after the NIK label\n' +
  '4. nama      — Full name after Nama label\n' +
  '5. tempatTglLahir — Birthplace + date in format: CITY, DD-MM-YYYY (e.g. SEMARANG, 20-04-2004)\n' +
  '6. jenisKelamin   — LAKI-LAKI or PEREMPUAN; same line has Gol. Darah blood type\n' +
  '7. golDarah  — Blood type: A, B, AB, O, or - if not visible\n' +
  '8. alamat    — Street address only (do NOT include RT/RW)\n' +
  '9. rtRw      — Format: 014/007 (three digits each side with leading zeros)\n' +
  '10. kelDesa  — Village/Kelurahan name\n' +
  '11. kecamatan — District name\n' +
  '12. agama    — Religion: ISLAM, KRISTEN, KATHOLIK, HINDU, BUDDHA, or KHONGHUCU\n' +
  '13. statusPerkawinan — BELUM KAWIN, KAWIN, CERAI HIDUP, or CERAI MATI\n' +
  '14. pekerjaan — Occupation (e.g. BELUM/TIDAK BEKERJA, PEGAWAI SWASTA)\n' +
  '15. kewarganegaraan — WNI or WNA\n' +
  '16. berlakuHingga — Expiry date DD-MM-YYYY or exactly SEUMUR HIDUP\n\n' +
  'CRITICAL NIK RULES — read each of the 16 digits ONE BY ONE:\n' +
  '  O (letter) → 0 (zero)\n' +
  '  l or I (letter) → 1 (one)\n' +
  '  B → 8\n' +
  '  A → 4\n' +
  '  S → 5\n' +
  '  G → 6\n\n' +
  'MANDATORY: Fill ALL 16 fields. Do NOT leave any blank if the text is readable on the card.';

// ─── Image optimization ───────────────────────────────────────────────────────
async function optimizeImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const MAX = 2000;
        let w = img.width;
        let h = img.height;
        if (w > MAX || h > MAX) {
          const r = Math.min(MAX / w, MAX / h);
          w = Math.round(w * r);
          h = Math.round(h * r);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // Boost contrast 1.2x for better text readability
        const id = ctx.getImageData(0, 0, w, h);
        const d = id.data;
        const f = (259 * (1.2 * 100 + 255)) / (255 * (259 - 1.2 * 100));
        for (let i = 0; i < d.length; i += 4) {
          d[i]     = Math.min(255, Math.max(0, f * (d[i]     - 128) + 128));
          d[i + 1] = Math.min(255, Math.max(0, f * (d[i + 1] - 128) + 128));
          d[i + 2] = Math.min(255, Math.max(0, f * (d[i + 2] - 128) + 128));
        }
        ctx.putImageData(id, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ─── File / URL to base64 ─────────────────────────────────────────────────────
async function fileToBase64(fileOrUrl) {
  if (typeof fileOrUrl === 'string') {
    if (fileOrUrl.startsWith('data:')) {
      return { data: fileOrUrl.split(',')[1], mimeType: fileOrUrl.split(';')[0].split(':')[1] };
    }
    const res = await fetch(fileOrUrl);
    return blobToBase64(await res.blob());
  }
  if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) return blobToBase64(fileOrUrl);
  throw new Error('Invalid image source');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve({ data: reader.result.split(',')[1], mimeType: blob.type || 'image/jpeg' });
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Model discovery ──────────────────────────────────────────────────────────
async function discoverModel(apiKey) {
  if (cachedEndpoint) return cachedEndpoint;
  console.log('[Gemini] Discovering models...');

  for (const apiVersion of API_VERSIONS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/${apiVersion}/models?key=${apiKey}`);
      if (!res.ok) continue;
      const { models = [] } = await res.json();
      console.log(`[Gemini] (${apiVersion}):`, models.map(m => m.name.replace('models/', '')).join(', '));

      for (const preferred of PREFERRED_MODELS) {
        const found = models.find(m =>
          m.name.replace('models/', '') === preferred &&
          m.supportedGenerationMethods?.includes('generateContent')
        );
        if (found) {
          const modelName = found.name.replace('models/', '');
          console.log('[Gemini] Selected:', modelName);
          cachedEndpoint = { apiVersion, modelName };
          return cachedEndpoint;
        }
      }

      // Any flash/pro model
      const any = models.find(m =>
        m.supportedGenerationMethods?.includes('generateContent') &&
        (m.name.includes('flash') || m.name.includes('pro'))
      );
      if (any) {
        const modelName = any.name.replace('models/', '');
        console.log('[Gemini] Fallback model:', modelName);
        cachedEndpoint = { apiVersion, modelName };
        return cachedEndpoint;
      }
    } catch (e) {
      console.warn(`[Gemini] list models failed (${apiVersion}):`, e.message);
    }
  }
  return bruteForceModel(apiKey);
}

async function bruteForceModel(apiKey) {
  for (const apiVersion of API_VERSIONS) {
    for (const modelName of PREFERRED_MODELS) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 3 } }),
          }
        );
        if (res.ok) { cachedEndpoint = { apiVersion, modelName }; return cachedEndpoint; }
        const t = await res.text().catch(() => '');
        if ([401, 403].includes(res.status) || t.includes('API_KEY_INVALID')) throw new Error('API_KEY_INVALID');
        if (res.status === 429) throw new Error('Gemini quota habis. Tunggu 1 menit.');
      } catch (e) {
        if (e.message === 'API_KEY_INVALID' || e.message.includes('quota')) throw e;
      }
    }
  }
  throw new Error('Tidak ada model Gemini tersedia. Periksa API key Anda.');
}

export function resetGeminiCache() { cachedEndpoint = null; }

export async function testGeminiConnection(apiKey) {
  if (!apiKey?.trim()) return { ok: false, error: 'API Key kosong' };
  resetGeminiCache();
  try {
    const endpoint = await discoverModel(apiKey.trim());
    return { ok: true, model: endpoint.modelName };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Core Gemini call ─────────────────────────────────────────────────────────
async function callGemini({ apiVersion, modelName, apiKey, parts, useSchema = false, temperature = 0.0 }) {
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;

  // Prepend system instruction to contents so it works on both v1 and v1beta
  const allParts = [
    { text: `[INSTRUCTION]\n${SYSTEM_INSTRUCTION}\n` },
    ...parts
  ];

  const genConfig = {
    temperature,
    maxOutputTokens: 2048,
    topP: 0.9,
    topK: 32,
  };

  // responseMimeType is camelCase in Google REST API
  if (useSchema && apiVersion === 'v1beta') {
    genConfig.responseMimeType = 'application/json';
    genConfig.responseSchema = KTP_RESPONSE_SCHEMA;
  }

  const body = {
    contents: [{ parts: allParts }],
    generationConfig: genConfig,
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let errBody = '';
    try { errBody = await res.text(); } catch (_) {}
    console.error('[Gemini] Error:', res.status, errBody.substring(0, 300));
    if (res.status === 404) cachedEndpoint = null;
    if (res.status === 403 || (res.status === 400 && errBody.includes('API key'))) throw new Error('API_KEY_INVALID');
    if (res.status === 429) throw new Error('Gemini quota habis. Tunggu 1 menit.');
    throw new Error(`Gemini error (${res.status}): ${errBody.substring(0, 100)}`);
  }

  const result = await res.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    // Check for safety block
    const reason = result?.candidates?.[0]?.finishReason;
    if (reason && reason !== 'STOP') throw new Error(`Gemini blocked response: ${reason}`);
    throw new Error('Response kosong dari Gemini');
  }
  return text;
}

// ─── JSON extractor ───────────────────────────────────────────────────────────
function extractJSON(text) {
  if (!text) return null;
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (e) { return null; }
}

// ─── Main OCR Entry Point ─────────────────────────────────────────────────────
export async function scanKTPWithGemini(imageSource, apiKey) {
  if (!apiKey?.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');

  const { apiVersion, modelName } = await discoverModel(apiKey.trim());
  console.log(`[Gemini] Model: ${modelName} (${apiVersion})`);

  // Optimize image (resize + slight contrast boost, keep full card)
  let imgData, imgMime;
  if (imageSource instanceof File && imageSource.type.startsWith('image/')) {
    const optimized = await optimizeImage(imageSource);
    if (optimized) {
      imgData = optimized.split(',')[1];
      imgMime = 'image/jpeg';
      console.log('[Gemini] Image optimized for OCR');
    } else {
      const raw = await fileToBase64(imageSource);
      imgData = raw.data;
      imgMime = raw.mimeType;
    }
  } else {
    const raw = await fileToBase64(imageSource);
    imgData = raw.data;
    imgMime = raw.mimeType;
  }

  const imgPart = {
    inlineData: {
      mimeType: imgMime.startsWith('image/') ? imgMime : 'image/jpeg',
      data: imgData,
    },
  };

  let parsed = null;

  // ── Strategy 1: Structured JSON output (responseSchema) ────────────────────
  // This FORCES Gemini to output every field in the schema — most reliable method
  try {
    console.log('[Gemini] Strategy 1: responseSchema structured output...');
    const text = await callGemini({
      apiVersion, modelName, apiKey: apiKey.trim(),
      parts: [{ text: KTP_PROMPT }, imgPart],
      useSchema: true,
      temperature: 0.0,
    });
    console.log('[Gemini] S1 response:', text.substring(0, 300));
    parsed = extractJSON(text);
    if (parsed) {
      const filled = Object.values(parsed).filter(v => v && String(v).length > 0).length;
      console.log(`[Gemini] S1 OK: ${filled}/16 fields filled`);
      if (filled < 8) {
        console.log('[Gemini] Too few fields, escalating to S2...');
        parsed = null;
      }
    }
  } catch (e) {
    if (e.message === 'API_KEY_INVALID' || e.message.includes('quota')) throw e;
    console.warn('[Gemini] S1 failed:', e.message);
  }

  // ── Strategy 2: Two-pass (raw OCR → JSON) ──────────────────────────────────
  if (!parsed) {
    try {
      console.log('[Gemini] Strategy 2: Two-pass OCR...');

      // Pass 1: Transcribe all text
      const rawText = await callGemini({
        apiVersion, modelName, apiKey: apiKey.trim(),
        parts: [
          {
            text: 'You are an expert OCR system for Indonesian ID cards. ' +
                  'Transcribe ALL visible text from this KTP card EXACTLY as printed, line by line. ' +
                  'Include every line: labels and values. ' +
                  'Be extremely careful with digits: read each digit one by one. ' +
                  'Ignore watermark/background text. Output plain text only.',
          },
          imgPart,
        ],
        useSchema: false,
        temperature: 0.05,
      });
      console.log('[Gemini] S2 raw OCR:\n', rawText.substring(0, 600));

      // Pass 2: Parse raw text into JSON
      const pass2Prompt =
        'Extract 16 KTP data fields from the following OCR text and return ONLY valid JSON.\n\n' +
        'OCR TEXT:\n---\n' + rawText + '\n---\n\n' +
        'Return JSON with exactly these fields:\n' +
        '- provinsi: Province (starts with PROVINSI)\n' +
        '- kota: City KABUPATEN... or KOTA...\n' +
        '- nik: 16 digits (fix OCR: O→0, l/I→1, B→8)\n' +
        '- nama: full name\n' +
        '- tempatTglLahir: CITY, DD-MM-YYYY\n' +
        '- jenisKelamin: LAKI-LAKI or PEREMPUAN\n' +
        '- golDarah: A, B, AB, O, or -\n' +
        '- alamat: street address only\n' +
        '- rtRw: 014/007 format\n' +
        '- kelDesa: village\n' +
        '- kecamatan: district\n' +
        '- agama: religion\n' +
        '- statusPerkawinan: marital status\n' +
        '- pekerjaan: occupation\n' +
        '- kewarganegaraan: WNI or WNA\n' +
        '- berlakuHingga: date or SEUMUR HIDUP\n\n' +
        'Return ONLY the JSON object with all 16 fields.';

      const jsonText = await callGemini({
        apiVersion, modelName, apiKey: apiKey.trim(),
        parts: [{ text: pass2Prompt }],
        useSchema: false,
        temperature: 0.0,
      });
      console.log('[Gemini] S2 JSON:\n', jsonText.substring(0, 500));
      parsed = extractJSON(jsonText);

      if (parsed) {
        const filled = Object.values(parsed).filter(v => v && String(v).length > 0).length;
        console.log(`[Gemini] S2 OK: ${filled}/16 fields filled`);
      }
    } catch (e) {
      if (e.message === 'API_KEY_INVALID' || e.message.includes('quota')) throw e;
      console.warn('[Gemini] S2 failed:', e.message);
    }
  }

  // ── Strategy 3: Single-pass text fallback ──────────────────────────────────
  if (!parsed) {
    console.log('[Gemini] Strategy 3: Single-pass fallback...');
    const singlePassPrompt =
      KTP_PROMPT + '\n\nReturn ONLY valid JSON with these 16 fields:\n' +
      '{"provinsi":"","kota":"","nik":"","nama":"","tempatTglLahir":"",' +
      '"jenisKelamin":"","golDarah":"","alamat":"","rtRw":"","kelDesa":"",' +
      '"kecamatan":"","agama":"","statusPerkawinan":"","pekerjaan":"",' +
      '"kewarganegaraan":"WNI","berlakuHingga":""}';

    const text = await callGemini({
      apiVersion, modelName, apiKey: apiKey.trim(),
      parts: [{ text: singlePassPrompt }, imgPart],
      useSchema: false,
      temperature: 0.1,
    });
    parsed = extractJSON(text);
  }

  if (!parsed) throw new Error('Tidak dapat mengekstrak data KTP dari Gemini');
  return normalizeAndValidate(parsed);
}

// ─── Post-processing & validation ────────────────────────────────────────────
function normalizeAndValidate(raw) {
  const str = (v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim());

  // NIK: digits only, fix common OCR misreads
  let nik = str(raw.nik)
    .replace(/\s/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[lIi]/g, '1')
    .replace(/[^0-9]/g, '');
  if (nik.length > 16) nik = nik.substring(0, 16);

  // Provinsi
  let provinsi = str(raw.provinsi).toUpperCase();
  if (provinsi && !provinsi.startsWith('PROVINSI')) provinsi = 'PROVINSI ' + provinsi;
  provinsi = provinsi.replace(/^PROVINSI\s+PROVINSI\s+/i, 'PROVINSI ');

  // Kota: fix common OCR errors in header
  let kota = str(raw.kota).toUpperCase()
    .replace(/\bKAPATI\b/g, 'KABUPATEN')
    .replace(/\bKABUPATEN\s+KABUPATEN\b/g, 'KABUPATEN')
    .replace(/[|\\]/g, '').trim();

  // Tempat / Tgl Lahir
  let tempatTglLahir = str(raw.tempatTglLahir)
    .replace(/^WNI\s*/i, '')
    .replace(/[/.]/g, '-')
    .trim()
    .toUpperCase();
  const tglMatch = tempatTglLahir.match(/(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (tglMatch) {
    const day   = tglMatch[1].padStart(2, '0');
    const month = tglMatch[2].padStart(2, '0');
    const year  = tglMatch[3].length === 2 ? '19' + tglMatch[3] : tglMatch[3];
    const city  = tempatTglLahir.split(/\d/)[0].replace(/[,\s]+$/, '').trim();
    tempatTglLahir = city ? `${city}, ${day}-${month}-${year}` : `${day}-${month}-${year}`;
  }

  // Jenis Kelamin
  let jenisKelamin = str(raw.jenisKelamin).toUpperCase();
  if (jenisKelamin.includes('PEREMPUAN')) jenisKelamin = 'PEREMPUAN';
  else if (jenisKelamin.includes('LAKI'))  jenisKelamin = 'LAKI-LAKI';

  // Gol Darah
  let golDarah = str(raw.golDarah).toUpperCase().trim();
  if (!['A', 'B', 'AB', 'O'].includes(golDarah)) {
    const m = golDarah.match(/\b(AB|A|B|O)\b/);
    golDarah = m ? m[1] : '-';
  }

  // RT/RW
  let rtRw = str(raw.rtRw).replace(/\s/g, '').replace(/[\\|]/g, '/');
  const rtMatch = rtRw.match(/(\d+)\/(\d+)/);
  if (rtMatch) rtRw = rtMatch[1].padStart(3, '0') + '/' + rtMatch[2].padStart(3, '0');

  // Berlaku Hingga
  let berlakuHingga = str(raw.berlakuHingga).toUpperCase();
  if (berlakuHingga.includes('SEUMUR') || berlakuHingga === 'LIFETIME') {
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

  // Safe NIK cross-validation
  if (nik.length === 16 && tempatTglLahir) nik = safeValidateNIK(nik, tempatTglLahir, jenisKelamin);

  return {
    provinsi, kota, nik,
    nama:             str(raw.nama).toUpperCase(),
    tempatTglLahir,   jenisKelamin, golDarah,
    alamat:           str(raw.alamat).toUpperCase().replace(/[|\\]+$/, '').trim(),
    rtRw,
    kelDesa:          str(raw.kelDesa).toUpperCase(),
    kecamatan:        str(raw.kecamatan).toUpperCase(),
    agama:            str(raw.agama).toUpperCase(),
    statusPerkawinan: str(raw.statusPerkawinan).toUpperCase(),
    pekerjaan:        str(raw.pekerjaan).toUpperCase().replace(/[|\\]/g, '').trim(),
    kewarganegaraan:  str(raw.kewarganegaraan).toUpperCase() || 'WNI',
    berlakuHingga,
    rawText: JSON.stringify(raw, null, 2),
  };
}

// Only repair NIK if ≤ 2 digits differ from expected DOB segment
function safeValidateNIK(nik, tempatTglLahir, jenisKelamin) {
  const m = tempatTglLahir.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (!m) return nik;
  let day = parseInt(m[1], 10);
  if (jenisKelamin?.includes('PEREMPUAN')) day += 40;
  const expectedDob = (day < 10 ? '0' + day : '' + day) + m[2] + m[3].slice(-2);
  const nikDob = nik.substring(6, 12);
  if (/^\d{6}$/.test(expectedDob) && nikDob !== expectedDob) {
    const diff = [...nikDob].filter((c, i) => c !== expectedDob[i]).length;
    if (diff <= 2) {
      console.log(`[NIK Repair] ${nikDob} → ${expectedDob} (${diff} digit(s))`);
      return nik.substring(0, 6) + expectedDob + nik.substring(12);
    }
    console.warn(`[NIK Repair] Skipped (${diff} diffs too large): ${nikDob} vs ${expectedDob}`);
  }
  return nik;
}


// ─── parseKTPTextWithGemini: Text-only parsing (no image vision) ──────────────
/**
 * Given raw OCR text from Tesseract, use Gemini to parse it into structured JSON.
 * Much more reliable than Gemini Vision because there is no image ambiguity.
 */
export async function parseKTPTextWithGemini(rawText, apiKey) {
  if (!apiKey?.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');
  if (!rawText?.trim()) throw new Error('Raw OCR text is empty');

  const { apiVersion, modelName } = await discoverModel(apiKey.trim());
  console.log('[Gemini Text Parse] Using:', modelName);

  const prompt = [
    'You are an expert at parsing Indonesian KTP (National ID Card) OCR text.',
    '',
    'The following is raw text extracted by Tesseract OCR from an Indonesian e-KTP card.',
    'Some characters may be misread (common: O vs 0, l vs 1, B vs 8).',
    '',
    'RAW OCR TEXT:',
    '---',
    rawText,
    '---',
    '',
    'Extract these 16 fields and return ONLY valid JSON (no other text):',
    '',
    '- provinsi: Province name starting with PROVINSI (e.g. "PROVINSI JAWA TIMUR")',
    '- kota: City/Regency e.g. "KABUPATEN GRESIK" or "KOTA SEMARANG"',
    '- nik: Exactly 16 digits. Fix: O->0, l/I->1, B->8. Read each digit carefully.',
    '- nama: Full name e.g. "ARNOLD JEROME CANDRA"',
    '- tempatTglLahir: "CITY, DD-MM-YYYY" e.g. "SEMARANG, 20-04-2004"',
    '- jenisKelamin: Exactly "LAKI-LAKI" or "PEREMPUAN"',
    '- golDarah: A, B, AB, O, or - if not found',
    '- alamat: Street address only, no RT/RW e.g. "JL. DUSUN PENGAMPUN"',
    '- rtRw: "014/007" format with leading zeros',
    '- kelDesa: Village name e.g. "SETRO"',
    '- kecamatan: District name e.g. "MENGANTI"',
    '- agama: ISLAM, KRISTEN, KATHOLIK, HINDU, BUDDHA, or KHONGHUCU',
    '- statusPerkawinan: BELUM KAWIN, KAWIN, CERAI HIDUP, or CERAI MATI',
    '- pekerjaan: Occupation e.g. "BELUM/TIDAK BEKERJA"',
    '- kewarganegaraan: "WNI" or "WNA"',
    '- berlakuHingga: "DD-MM-YYYY" or "SEUMUR HIDUP"',
    '',
    'Fill ALL 16 fields. Use empty string only if truly not found.',
    'Return ONLY the JSON object.',
  ].join('\n');

  let text;
  try {
    text = await callGemini({
      apiVersion, modelName, apiKey: apiKey.trim(),
      parts: [{ text: prompt }],
      useSchema: true,
      temperature: 0.0,
    });
  } catch (e) {
    text = await callGemini({
      apiVersion, modelName, apiKey: apiKey.trim(),
      parts: [{ text: prompt }],
      useSchema: false,
      temperature: 0.0,
    });
  }

  console.log('[Gemini Text Parse] Response:', text.substring(0, 400));

  const parsed = extractJSON(text);
  if (!parsed) throw new Error('Gemini text parsing returned no valid JSON');

  return normalizeAndValidate(parsed);
}
