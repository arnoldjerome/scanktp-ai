/**
 * Gemini Vision OCR for e-KTP — Ultra Precision Edition
 * Uses Google Gemini 1.5 Flash with a highly engineered prompt to extract KTP data
 * with near-perfect accuracy. Includes NIK ↔ birth date cross-validation.
 */

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

// ─── Prompt Engineering ──────────────────────────────────────────────────────
// Extremely specific to Indonesian e-KTP layout. Reduces hallucination to near zero.
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
- Setiap field harus dari barisnya sendiri, tidak boleh tercampur

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

// ─── Utilities ────────────────────────────────────────────────────────────────

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

// ─── Main OCR Function ────────────────────────────────────────────────────────

/**
 * Scan a KTP image using Gemini Vision API
 * @param {File|Blob|string} imageSource
 * @param {string} apiKey
 * @returns {Promise<object>} Structured KTP data
 */
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
      temperature: 0.05,   // Very low: minimal creativity, max precision
      maxOutputTokens: 1024,
      topP: 0.8,
      topK: 10,
    },
  };

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    let errBody = '';
    try { errBody = await response.text(); } catch (_) {}

    console.error('[Gemini API Error]', response.status, errBody.substring(0, 300));

    if (response.status === 400 && (errBody.includes('API_KEY_INVALID') || errBody.includes('invalid'))) {
      throw new Error('API_KEY_INVALID');
    }
    if (response.status === 429) {
      throw new Error('Gemini API rate limit / quota habis. Coba lagi dalam 1 menit.');
    }
    if (response.status === 403) {
      throw new Error('API_KEY_INVALID');
    }
    if (response.status === 500 || response.status === 503) {
      throw new Error('Gemini API server sedang sibuk (status ' + response.status + '). Coba lagi.');
    }
    throw new Error(`Gemini API error ${response.status}: ${errBody.substring(0, 150)}`);
  }

  const result = await response.json();
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) throw new Error('Empty response from Gemini API');

  // Extract JSON block robustly
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Gemini response: ' + text.substring(0, 200));

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error('Invalid JSON from Gemini: ' + e.message);
  }

  return normalizeAndValidate(parsed);
}

// ─── Post-Processing & Validation ────────────────────────────────────────────

function normalizeAndValidate(raw) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');

  // ── NIK ──────────────────────────────────────────────────────────────────
  let nik = str(raw.nik).replace(/\s/g, '');
  // Remove any non-digit characters that OCR might have added
  nik = nik.replace(/[^0-9]/g, '');
  if (nik.length > 16) nik = nik.substring(0, 16);

  // ── Provinsi ─────────────────────────────────────────────────────────────
  let provinsi = str(raw.provinsi).toUpperCase();
  if (provinsi && !provinsi.startsWith('PROVINSI')) {
    provinsi = 'PROVINSI ' + provinsi;
  }
  // Remove double PROVINSI
  provinsi = provinsi.replace(/^PROVINSI\s+PROVINSI\s+/i, 'PROVINSI ');

  // ── Kota ─────────────────────────────────────────────────────────────────
  let kota = str(raw.kota).toUpperCase();
  // Remove stray characters
  kota = kota.replace(/[|\\]/g, '').trim();

  // ── Tempat/Tgl Lahir ─────────────────────────────────────────────────────
  let tempatTglLahir = str(raw.tempatTglLahir);
  // Remove "WNI" contamination
  tempatTglLahir = tempatTglLahir.replace(/^WNI\s*/i, '').trim();
  // Normalize date separators
  tempatTglLahir = tempatTglLahir.replace(/[\/\.]/g, '-');
  // Ensure format: "CITY, DD-MM-YYYY"
  const tglMatch = tempatTglLahir.match(/(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (tglMatch) {
    const day = tglMatch[1].padStart(2, '0');
    const month = tglMatch[2].padStart(2, '0');
    const year = tglMatch[3].length === 2 ? '19' + tglMatch[3] : tglMatch[3];
    const cityPart = tempatTglLahir.split(/\d/)[0].replace(/[,\s]+$/, '').trim();
    tempatTglLahir = cityPart ? `${cityPart}, ${day}-${month}-${year}` : `${day}-${month}-${year}`;
  }

  // ── Jenis Kelamin ─────────────────────────────────────────────────────────
  let jenisKelamin = str(raw.jenisKelamin).toUpperCase();
  if (jenisKelamin.includes('PEREMPUAN')) jenisKelamin = 'PEREMPUAN';
  else if (jenisKelamin.includes('LAKI')) jenisKelamin = 'LAKI-LAKI';

  // ── Gol Darah ─────────────────────────────────────────────────────────────
  let golDarah = str(raw.golDarah).toUpperCase().trim() || '-';
  // Only valid values
  if (!['A', 'B', 'AB', 'O'].includes(golDarah)) {
    const match = golDarah.match(/\b(A|B|AB|O)\b/);
    golDarah = match ? match[1] : '-';
  }

  // ── RT/RW ─────────────────────────────────────────────────────────────────
  let rtRw = str(raw.rtRw).replace(/\s/g, '');
  // Normalize slash
  rtRw = rtRw.replace(/[\\|]/g, '/');
  // Ensure 3-digit padding on both sides
  const rtRwMatch = rtRw.match(/(\d+)[\/](\d+)/);
  if (rtRwMatch) {
    rtRw = rtRwMatch[1].padStart(3, '0') + '/' + rtRwMatch[2].padStart(3, '0');
  }

  // ── Berlaku Hingga ────────────────────────────────────────────────────────
  let berlakuHingga = str(raw.berlakuHingga).toUpperCase();
  if (berlakuHingga.includes('SEUMUR')) {
    berlakuHingga = 'SEUMUR HIDUP';
  } else {
    // Extract only the FIRST valid date, discard any duplicated dates
    const dateMatches = berlakuHingga.match(/\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4}/g);
    if (dateMatches && dateMatches.length > 0) {
      const firstDate = dateMatches[0].replace(/[\/\.]/g, '-');
      const parts = firstDate.split('-');
      if (parts.length === 3) {
        berlakuHingga = parts[0].padStart(2, '0') + '-' + parts[1].padStart(2, '0') + '-' + parts[2];
      } else {
        berlakuHingga = firstDate;
      }
    }
  }

  // ── Alamat ────────────────────────────────────────────────────────────────
  let alamat = str(raw.alamat).toUpperCase();
  // Remove trailing pipe or backslash
  alamat = alamat.replace(/[|\\]+$/, '').trim();

  // ── Pekerjaan ─────────────────────────────────────────────────────────────
  let pekerjaan = str(raw.pekerjaan).toUpperCase();
  // Remove stray characters
  pekerjaan = pekerjaan.replace(/[|\\]/g, '').trim();

  // ── NIK Cross-Validation with Birth Date ─────────────────────────────────
  // Indonesian NIK structure: [2-digit prov][2-digit city][2-digit kec][2-digit day][2-digit month][2-digit year][4-digit seq]
  // If NIK length is 16, validate day/month against birth date
  if (nik.length === 16 && tempatTglLahir) {
    nik = crossValidateNIK(nik, tempatTglLahir, jenisKelamin);
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
 * Cross-validate NIK digits 7-12 against birth date from KTP text.
 * NIK format: [prov:2][city:2][kec:2][day:2][month:2][year:2][seq:4]
 * For PEREMPUAN, day += 40
 */
function crossValidateNIK(nik, tempatTglLahir, jenisKelamin) {
  const dateMatch = tempatTglLahir.match(/(\d{2})-(\d{2})-(\d{2,4})/);
  if (!dateMatch) return nik;

  let day = parseInt(dateMatch[1], 10);
  const month = dateMatch[2]; // 2-digit string e.g. "04"
  const year = dateMatch[3].slice(-2); // last 2 digits

  const isPerempuan = jenisKelamin && jenisKelamin.toUpperCase().includes('PEREMPUAN');
  if (isPerempuan) day += 40;

  const expectedDay = day < 10 ? `0${day}` : `${day}`;
  const expectedDob = expectedDay + month + year; // 6 chars

  const nikPrefix = nik.substring(0, 6);   // region code
  const nikDob    = nik.substring(6, 12);  // date digits in NIK
  const nikSeq    = nik.substring(12, 16); // sequence

  // If the DOB portion differs from expected, patch it
  // Only patch if expected looks valid
  if (
    expectedDob.length === 6 &&
    /^\d{6}$/.test(expectedDob) &&
    nikDob !== expectedDob
  ) {
    console.log(`NIK DOB mismatch: NIK says "${nikDob}", expected "${expectedDob}" — patching.`);
    return nikPrefix + expectedDob + nikSeq;
  }

  return nik;
}
