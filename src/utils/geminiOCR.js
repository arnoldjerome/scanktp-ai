/**
 * Gemini Vision OCR for e-KTP
 * Uses Google Gemini Flash API to intelligently read KTP photos
 * and return structured data directly — far more accurate than Tesseract
 */

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const KTP_PROMPT = `Kamu adalah sistem OCR sangat akurat untuk Kartu Tanda Penduduk (e-KTP) Indonesia.

Analisa foto KTP ini dengan SANGAT TELITI. Baca hanya bagian KIRI dari KTP (kolom data teks), ABAIKAN bagian kanan yang berisi foto wajah dan tanda tangan.

Ekstrak data berikut secara presisi:
1. PROVINSI (biasanya baris paling atas, contoh: PROVINSI JAWA TENGAH)
2. KOTA/KABUPATEN (baris kedua, contoh: KOTA SEMARANG atau KABUPATEN GRESIK)
3. NIK (16 digit angka persis, baca dengan sangat hati-hati setiap digit)
4. Nama Lengkap
5. Tempat/Tgl Lahir (format: KOTA, DD-MM-YYYY)
6. Jenis Kelamin (LAKI-LAKI atau PEREMPUAN)
7. Gol. Darah (A/B/AB/O/-)
8. Alamat (nama jalan)
9. RT/RW (format: XXX/XXX)
10. Kel/Desa
11. Kecamatan
12. Agama
13. Status Perkawinan
14. Pekerjaan
15. Kewarganegaraan (WNI atau WNA)
16. Berlaku Hingga

ATURAN PENTING:
- NIK HARUS tepat 16 digit angka. Baca setiap digit dengan sangat hati-hati. Jangan ganti huruf dengan angka secara asal.
- Jika suatu field tidak terbaca / tidak ada, isi dengan string kosong ""
- Jangan hardcode atau mengarang data
- Kembalikan HANYA JSON valid, tidak ada teks lain

Format output JSON:
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

/**
 * Convert file/blob to base64
 */
async function fileToBase64(fileOrUrl) {
  if (typeof fileOrUrl === 'string') {
    // It's already a data URL or regular URL
    if (fileOrUrl.startsWith('data:')) {
      return {
        data: fileOrUrl.split(',')[1],
        mimeType: fileOrUrl.split(';')[0].split(':')[1]
      };
    }
    // Fetch from URL
    const response = await fetch(fileOrUrl);
    const blob = await response.blob();
    return blobToBase64(blob);
  } else if (fileOrUrl instanceof File || fileOrUrl instanceof Blob) {
    return blobToBase64(fileOrUrl);
  }
  throw new Error('Invalid input');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve({
        data: result.split(',')[1],
        mimeType: blob.type || 'image/jpeg'
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Main function: Use Gemini Vision to parse KTP image
 * @param {File|Blob|string} imageSource - image file, blob, or data URL
 * @param {string} apiKey - Gemini API Key
 * @returns {object} - Parsed KTP data fields
 */
export async function scanKTPWithGemini(imageSource, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('GEMINI_API_KEY_REQUIRED');
  }

  const { data: base64Data, mimeType } = await fileToBase64(imageSource);

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: KTP_PROMPT
          },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024
    }
  };

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 400 && errText.includes('API_KEY_INVALID')) {
      throw new Error('API_KEY_INVALID');
    }
    throw new Error(`Gemini API error: ${response.status} - ${errText}`);
  }

  const result = await response.json();

  // Extract text from response
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Empty response from Gemini API');
  }

  // Parse JSON from response
  try {
    // Extract JSON block from text (in case there's surrounding text)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Gemini response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Normalize and validate fields
    return normalizeGeminiResult(parsed);
  } catch (parseErr) {
    console.error('Gemini JSON parse error:', parseErr, '\nRaw text:', text);
    throw new Error('Gagal memparse hasil Gemini: ' + parseErr.message);
  }
}

/**
 * Normalize and clean up Gemini's output
 */
function normalizeGeminiResult(raw) {
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');

  // Clean NIK: must be exactly 16 digits
  let nik = clean(raw.nik).replace(/\D/g, '');
  if (nik.length > 16) nik = nik.substring(0, 16);
  if (nik.length < 16) nik = nik; // keep as-is if < 16, don't pad

  // Normalize provinsi: ensure it starts with PROVINSI
  let provinsi = clean(raw.provinsi).toUpperCase();
  if (provinsi && !provinsi.startsWith('PROVINSI')) {
    provinsi = 'PROVINSI ' + provinsi;
  }

  // Normalize kota
  let kota = clean(raw.kota).toUpperCase();

  // Normalize jenis kelamin
  let jenisKelamin = clean(raw.jenisKelamin).toUpperCase();
  if (jenisKelamin.includes('LAKI')) jenisKelamin = 'LAKI-LAKI';
  if (jenisKelamin.includes('PEREMPUAN')) jenisKelamin = 'PEREMPUAN';

  // Normalize gol darah
  let golDarah = clean(raw.golDarah).toUpperCase() || '-';
  if (!['A', 'B', 'AB', 'O', '-'].includes(golDarah)) golDarah = golDarah || '-';

  // Normalize kewarganegaraan
  let kewarganegaraan = clean(raw.kewarganegaraan).toUpperCase() || 'WNI';

  // Normalize berlaku hingga
  let berlakuHingga = clean(raw.berlakuHingga).toUpperCase();
  if (berlakuHingga.includes('SEUMUR') || berlakuHingga === 'SEUMUR HIDUP') {
    berlakuHingga = 'SEUMUR HIDUP';
  }

  return {
    provinsi,
    kota,
    nik,
    nama: clean(raw.nama).toUpperCase(),
    tempatTglLahir: clean(raw.tempatTglLahir),
    jenisKelamin,
    golDarah,
    alamat: clean(raw.alamat).toUpperCase(),
    rtRw: clean(raw.rtRw),
    kelDesa: clean(raw.kelDesa).toUpperCase(),
    kecamatan: clean(raw.kecamatan).toUpperCase(),
    agama: clean(raw.agama).toUpperCase(),
    statusPerkawinan: clean(raw.statusPerkawinan).toUpperCase(),
    pekerjaan: clean(raw.pekerjaan).toUpperCase(),
    kewarganegaraan,
    berlakuHingga,
    rawText: JSON.stringify(raw)
  };
}
