/**
 * Gemini Vision OCR for e-KTP — Ultra Precision Edition
 * Tries multiple Gemini models (newest first) for maximum compatibility.
 * Uses v1 API (not v1beta) which has broader model support.
 */

// Try models in order — newest/most capable first
const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash',
  'gemini-1.5-pro-latest',
  'gemini-pro-vision', // older fallback
];

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1/models';

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
- "nik": 16 digit angka persis. Letaknya setelah label "NIK". Baca digit SATU PER SATU dengan teliti. Jangan ganti angka dengan huruf atau sebaliknya. Angka 0 (nol) berbeda dengan O (huruf O). Angka 1 berbeda dengan l (huruf L). Angka 8 berbeda dengan B. Angka 4 berbeda dengan A. Angka 5 berbeda dengan S.
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
- "berlakuHingga": Tanggal dari baris "Berlaku Hingga" dalam format "DD-MM-YYYY", atau "SEUMUR HIDUP". JANGAN campurkan dua tanggal berbeda. Pilih satu tanggal saja.

VALIDASI MANDIRI sebelum output:
- NIK harus tepat 16 digit angka
- tempatTglLahir harus mengandung nama kota DAN tanggal, bukan hanya kota
- berlakuHingga hanya boleh satu tanggal atau "SEUMUR HIDUP"

Output JSON (isi semua field, kosongkan jika tidak terbaca):
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

// ─── Main OCR Function (tries multiple models) ────────────────────────────────
export async function scanKTPWithGemini(imageSource, apiKey) {
  if (!apiKey || !apiKey.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');

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

  let lastError = null;

  for (const modelName of GEMINI_MODELS) {
    try {
      const url = `${GEMINI_BASE}/${modelName}:generateContent?key=${apiKey}`;
      console.log(`[Gemini] Trying model: ${modelName}`);

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let errBody = '';
        try { errBody = await response.text(); } catch (_) {}
        console.warn(`[Gemini] ${modelName} → HTTP ${response.status}:`, errBody.substring(0, 200));

        // Auth errors — stop immediately, no point retrying
        if (response.status === 403 ||
            (response.status === 400 && (errBody.includes('API_KEY_INVALID') || errBody.includes('API key not valid')))) {
          throw new Error('API_KEY_INVALID');
        }
        if (response.status === 429) {
          throw new Error('Gemini quota habis. Tunggu 1 menit lalu coba lagi.');
        }
        // Model not found — try next
        if (response.status === 404 || errBody.includes('not found') || errBody.includes('not supported')) {
          lastError = new Error(`Model ${modelName} tidak tersedia`);
          continue;
        }
        lastError = new Error(`HTTP ${response.status}: ${errBody.substring(0, 120)}`);
        continue;
      }

      const result = await response.json();
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        lastError = new Error('Response kosong dari Gemini');
        continue;
      }

      console.log(`[Gemini] ✓ Berhasil dengan model: ${modelName}`);

      // Extract JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        lastError = new Error('JSON tidak ditemukan dalam response Gemini');
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        lastError = new Error('JSON tidak valid: ' + e.message);
        continue;
      }

      return normalizeAndValidate(parsed);

    } catch (err) {
      // Hard errors — don't retry
      if (err.message === 'API_KEY_INVALID' ||
          err.message.includes('quota') ||
          err.message.includes('Tunggu')) {
        throw err;
      }
      lastError = err;
      console.warn(`[Gemini] ${modelName} threw:`, err.message);
    }
  }

  throw lastError || new Error('Semua model Gemini gagal. Periksa API key Anda.');
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

  // NIK cross-validation with birth date
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
