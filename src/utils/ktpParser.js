/**
 * Indonesian e-KTP Text Parser — Improved Fallback for Tesseract OCR
 * Used when Gemini API is unavailable. More robust regex + validation.
 */
import { matchFuzzyProvince, matchFuzzyCity } from './indonesiaData.js';

export function parseKTPText(rawText) {
  if (!rawText) return getDefaultKTPData();

  const data = getDefaultKTPData();
  data.rawText = rawText;

  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // ── Utility helpers ─────────────────────────────────────────────────────────
  const getValueAfterLabel = (line, labels = []) => {
    if (!line) return '';
    for (const lbl of labels) {
      const idx = line.toUpperCase().indexOf(lbl.toUpperCase());
      if (idx !== -1) {
        return line.substring(idx + lbl.length).replace(/^[\s:;.\-=|]+/, '').trim();
      }
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) return line.substring(colonIdx + 1).replace(/^[\s:;.\-=|]+/, '').trim();
    return line.trim();
  };

  // ── Line-by-line extraction ──────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    // PROVINSI (line 0 or contains PROVINSI keyword)
    if ((i === 0 || upper.includes('PROVINSI') || upper.includes('PROV')) && !data.provinsi) {
      if (upper.includes('JAWA') || upper.includes('JAKARTA') || upper.includes('DKI') ||
          upper.includes('BALI') || upper.includes('BANTEN') || upper.includes('RIAU') ||
          upper.includes('SUMATERA') || upper.includes('KALIMANTAN') || upper.includes('SULAWESI') ||
          upper.includes('PROV') || i === 0) {
        data.provinsi = matchFuzzyProvince(upper);
      }
    }

    // KOTA / KABUPATEN (line 1 only, if not already captured)
    if (!data.kota && i <= 2) {
      if (!upper.includes('PROVINSI') && !upper.includes('REPUBLIK')) {
        if (upper.includes('KAB') || upper.includes('KOTA') || upper.includes('JAKARTA') ||
            upper.includes('GRESIK') || upper.includes('SEMARANG') || upper.includes('SURABAYA') ||
            i === 1) {
          data.kota = matchFuzzyCity(line, rawText);
        }
      }
    }

    // NIK — look for explicit NIK/NIX label first
    if ((upper.includes('NIK') || upper.includes('NIX') || upper.match(/^N[I1!|]?[KX]/i)) && !data.nik) {
      const val = getValueAfterLabel(line, ['NIK', 'NIX', 'N1K', 'NI K', 'N.I.K', 'N!K']);
      const digits = extractDigits(val);
      if (digits.length >= 15) {
        data.nik = digits.substring(0, 16);
      }
    }

    // NAMA
    if (upper.match(/^NAMA\b/) || upper.match(/NAMA\s*:/) || upper.match(/^N[A4]M[A4]/i)) {
      if (!upper.includes('AGAMA') && !upper.includes('NEGARA') && !upper.includes('KEWARGANEGARAAN')) {
        const val = getValueAfterLabel(line, ['NAMA']);
        if (val && val.length > 2) data.nama = cleanName(val);
      }
    }

    // TEMPAT / TGL LAHIR
    if ((upper.includes('TEMPAT') || upper.match(/TGL\s*LAHIR/) || upper.match(/TANGGAL\s*LAHIR/)) &&
        !upper.includes('BERLAKU') && !upper.includes('HINGGA')) {
      const val = getValueAfterLabel(line, [
        'TEMPAT/TGL LAHIR', 'TEMPAT TGL LAHIR', 'TEMPAT/TGL', 'TEMPAT', 'TGL LAHIR', 'TANGGAL LAHIR'
      ]);
      if (val && val.length > 2) data.tempatTglLahir = normalizeDate(val);
    }

    // JENIS KELAMIN + GOL DARAH (same line)
    if (upper.includes('KELAMIN') || upper.match(/^(LAKI|PEREMPUAN)/)) {
      if (upper.includes('PEREMPUAN')) data.jenisKelamin = 'PEREMPUAN';
      else if (upper.includes('LAKI')) data.jenisKelamin = 'LAKI-LAKI';

      const golMatch = line.match(/(?:GOL(?:\.|\s)*DARAH\s*:?[\s\d]*)([ABO]+)\b/i) ||
                       line.match(/\d([ABO])\b/i) ||
                       line.match(/\b(AB|A|B|O)\b/i);
      if (golMatch) {
        data.golDarah = golMatch[1].toUpperCase();
      }
    }

    // GOL DARAH (standalone or on same line as kelamin)
    if ((upper.includes('GOL') || upper.includes('DARAH')) && !data.golDarah) {
      const golMatch = line.match(/(?:GOL(?:\.|\s)*DARAH\s*:?[\s\d]*)([ABO]+)\b/i) ||
                       line.match(/\d([ABO])\b/i) ||
                       line.match(/\b(AB|A|B|O)\b/i);
      if (golMatch) data.golDarah = golMatch[1].toUpperCase();
    }

    // ALAMAT — strictly the address line, no RT/RW/Kel
    if ((upper.match(/^ALAMAT\b/) || upper.match(/ALAMAT\s*:/)) &&
        !upper.includes('RT') && !upper.includes('KEL') && !upper.includes('KEC')) {
      const val = getValueAfterLabel(line, ['ALAMAT']);
      if (val && val.length > 2) {
        data.alamat = val.replace(/\bDUEUN\b/i, 'DUSUN').toUpperCase();
      }
    }

    // RT / RW — pattern: digits/digits
    if (!data.rtRw && (upper.match(/\bRT\b/) || upper.match(/\bRW\b/) || upper.match(/\d{2,3}\s*[\/\\]\s*\d{2,3}/))) {
      const rtMatch = line.match(/(\d{1,3})\s*[\/\\]\s*(\d{1,3})/);
      if (rtMatch) {
        const rt = rtMatch[1].padStart(3, '0');
        const rw = rtMatch[2].padStart(3, '0');
        data.rtRw = `${rt}/${rw}`;
      }
    }

    // KEL / DESA — must NOT contain KELAMIN
    if (!upper.includes('KELAMIN') &&
        (upper.match(/\bKEL\b/) || upper.includes('DESA') || upper.includes('KELURAHAN'))) {
      const val = getValueAfterLabel(line, ['KEL/DESA', 'KELURAHAN', 'DESA', 'KEL']);
      if (val && val.length > 1) data.kelDesa = val.toUpperCase();
    }

    // KECAMATAN
    if (upper.includes('KECAMATAN') || upper.match(/\bKEC\b/)) {
      const val = getValueAfterLabel(line, ['KECAMATAN', 'KEC']);
      if (val && val.length > 1) data.kecamatan = val.toUpperCase();
    }

    // AGAMA
    if (upper.match(/^AGAMA\b/) || upper.match(/AGAMA\s*:/)) {
      const val = getValueAfterLabel(line, ['AGAMA']);
      if (val) data.agama = normalizeAgama(val || line);
    }
    // Detect religion by keyword if AGAMA label not found
    if (!data.agama) {
      if (upper.match(/\bISLAM\b/)) data.agama = 'ISLAM';
      else if (upper.match(/\bKRISTEN\b/)) data.agama = 'KRISTEN';
      else if (upper.match(/\bKATHOLIK\b|\bKATOLIK\b/)) data.agama = 'KATHOLIK';
      else if (upper.match(/\bHINDU\b/)) data.agama = 'HINDU';
      else if (upper.match(/\bBUDDHA\b|\bBUDHA\b/)) data.agama = 'BUDDHA';
    }

    // STATUS PERKAWINAN
    if (upper.includes('KAWIN') || upper.includes('PERKAWINAN')) {
      if (upper.includes('BELUM')) data.statusPerkawinan = 'BELUM KAWIN';
      else if (upper.includes('CERAI MATI')) data.statusPerkawinan = 'CERAI MATI';
      else if (upper.includes('CERAI HIDUP')) data.statusPerkawinan = 'CERAI HIDUP';
      else if (upper.includes('KAWIN')) data.statusPerkawinan = 'KAWIN';
    }

    // PEKERJAAN — strictly after PEKERJAAN label
    if (upper.match(/^PEKERJAAN\b/) || upper.match(/PEKERJAAN\s*:/)) {
      const val = getValueAfterLabel(line, ['PEKERJAAN']);
      if (val) {
        data.pekerjaan = val
          .replace(/\s*(?:WNI|WNA)\s*$/i, '')
          .replace(/\s*\d{2}[-\/]\d{2}[-\/]\d{4}.*$/, '')
          .replace(/\s+(?:GRESIK|JAKARTA|SURABAYA|SEMARANG|BANDUNG|SIDOARJO)\b.*$/i, '')
          .toUpperCase()
          .trim();
      }
    }

    // KEWARGANEGARAAN
    if (upper.includes('KEWARGANEGARAAN') || upper.match(/\bWNI\b/) || upper.match(/\bWNA\b/)) {
      if (upper.includes('WNA')) data.kewarganegaraan = 'WNA';
      else data.kewarganegaraan = 'WNI';
    }

    // BERLAKU HINGGA — extract FIRST date only
    if (upper.includes('BERLAKU') || upper.includes('HINGGA')) {
      if (upper.includes('SEUMUR')) {
        data.berlakuHingga = 'SEUMUR HIDUP';
      } else {
        const val = getValueAfterLabel(line, ['BERLAKU HINGGA', 'BERLAKU']);
        // Extract only first date
        const dateMatches = val.match(/\d{1,2}[-\/.\s]\d{1,2}[-\/.\s]\d{2,4}/g);
        if (dateMatches && dateMatches.length > 0) {
          data.berlakuHingga = dateMatches[0].replace(/[\/.\s]/g, '-');
        } else if (val && val.toUpperCase().includes('SEUMUR')) {
          data.berlakuHingga = 'SEUMUR HIDUP';
        }
      }
    }
  }

  // ── Fallbacks ─────────────────────────────────────────────────────────────
  if (!data.provinsi) {
    data.provinsi = matchFuzzyProvince((lines[0] || '') + ' ' + rawText);
  }
  if (!data.kota || data.kota.length < 3) {
    data.kota = matchFuzzyCity('', rawText);
  }

  // ── NIK fallback: scan entire text for 16-digit sequence ──────────────────
  if (!data.nik) {
    // Remove NIK label to avoid it being counted as digits
    const noLabel = rawText.replace(/NIK/gi, '').replace(/N1K/gi, '');
    const cleaned = extractDigits(noLabel);
    const m = cleaned.match(/\d{16}/);
    if (m) data.nik = m[0];
  }
  if (data.nik && data.nik.length > 16) {
    data.nik = data.nik.substring(0, 16);
  }

  // ── NIK ↔ DOB cross-validation ────────────────────────────────────────────
  if (data.nik && data.nik.length === 16 && data.tempatTglLahir) {
    data.nik = repairNikWithDOB(data.nik, data.tempatTglLahir, data.jenisKelamin);
  }

  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract only digit characters from string (no OCR char substitution — that's too risky)
 */
function extractDigits(str) {
  if (!str) return '';
  return str
    .replace(/[Oo]/g, '0')
    .replace(/[lIi|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[AaYy]/g, '4')
    .replace(/[Ss]/g, '5')
    .replace(/[b]/g, '6')
    .replace(/[B]/g, '8')
    .replace(/[gq]/g, '9')
    .replace(/\D/g, '');
}

/**
 * Normalize date string to "KOTA, DD-MM-YYYY" format
 */
function normalizeDate(val) {
  // Remove known non-date contamination
  const clean = val.replace(/^WNI\s*/i, '').replace(/^WNA\s*/i, '').trim();
  // Try to fix separator
  return clean.replace(/[\/\.]/g, '-');
}

/**
 * Repair NIK date portion using known birth date from KTP text,
 * and fix common OCR sequence number transposition (e.g. 0040 -> 0004)
 */
export function repairNikWithDOB(nik, tempatTglLahir, jenisKelamin) {
  if (!nik || nik.length < 16) return nik;

  const dateMatch = tempatTglLahir ? tempatTglLahir.match(/(\d{2})-(\d{2})-(\d{2,4})/) : null;

  let prefix   = nik.substring(0, 6);
  let nikDob   = nik.substring(6, 12);
  let sequence = nik.substring(12, 16);

  // Fix sequence number OCR shift: e.g. "0040" -> "0004"
  // In Dukcapil (UU Adminduk), daily registration sequence starts from 0001.
  // Dot matrix OCR often misreads "0004" as "0040" due to trailing space noise.
  if (/^00[1-9]0$/.test(sequence)) {
    const digit = sequence[2];
    console.log(`[NIK Sequence Repair] ${sequence} → 000${digit}`);
    sequence = `000${digit}`;
  }

  if (dateMatch) {
    let day = parseInt(dateMatch[1], 10);
    const month = dateMatch[2];
    const year = dateMatch[3].slice(-2);

    const isPerempuan = jenisKelamin && jenisKelamin.toUpperCase().includes('PEREMPUAN');
    if (isPerempuan) day += 40;

    const expectedDay = day < 10 ? `0${day}` : `${day}`;
    const expectedDob = expectedDay + month + year;

    if (/^\d{6}$/.test(expectedDob)) {
      nikDob = expectedDob;
    }
  }

  return prefix + nikDob + sequence;
}

function cleanName(raw) {
  return raw
    .replace(/^[\s:;|]+/, '')
    .replace(/[^A-Za-z\s.',\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeAgama(raw) {
  const upper = raw.toUpperCase();
  if (upper.includes('ISLAM')) return 'ISLAM';
  if (upper.includes('KRISTEN')) return 'KRISTEN';
  if (upper.includes('KATHOL') || upper.includes('KATOL')) return 'KATHOLIK';
  if (upper.includes('HINDU')) return 'HINDU';
  if (upper.includes('BUDDHA') || upper.includes('BUDHA')) return 'BUDDHA';
  if (upper.includes('KHONG') || upper.includes('KONG')) return 'KHONGHUCU';
  return raw.replace(/.*AGAMA\s*:?/i, '').replace(/^[\s:;]+/, '').trim().toUpperCase();
}

// ── Default data structure ─────────────────────────────────────────────────────
export function getDefaultKTPData() {
  return {
    provinsi: '',
    kota: '',
    nik: '',
    nama: '',
    tempatTglLahir: '',
    jenisKelamin: '',
    golDarah: '-',
    alamat: '',
    rtRw: '',
    kelDesa: '',
    kecamatan: '',
    agama: '',
    statusPerkawinan: '',
    pekerjaan: '',
    kewarganegaraan: 'WNI',
    berlakuHingga: 'SEUMUR HIDUP',
    rawText: '',
  };
}

// ── Clipboard Formatters ───────────────────────────────────────────────────────
export function formatKTPForClipboard(ktp, index = null) {
  const header = index !== null ? `=== DATA KTP #${index + 1} ===` : `=== DATA KTP ===`;
  return [
    header,
    ktp.provinsi    ? `PROVINSI          : ${ktp.provinsi}` : null,
    ktp.kota        ? `KOTA/KABUPATEN    : ${ktp.kota}` : null,
    `NIK               : ${ktp.nik || '-'}`,
    `Nama              : ${ktp.nama || '-'}`,
    `Tempat/Tgl Lahir  : ${ktp.tempatTglLahir || '-'}`,
    `Jenis Kelamin     : ${ktp.jenisKelamin || '-'}  (Gol. Darah: ${ktp.golDarah || '-'})`,
    `Alamat            : ${ktp.alamat || '-'}`,
    `RT/RW             : ${ktp.rtRw || '-'}`,
    `Kel/Desa          : ${ktp.kelDesa || '-'}`,
    `Kecamatan         : ${ktp.kecamatan || '-'}`,
    `Agama             : ${ktp.agama || '-'}`,
    `Status Perkawinan : ${ktp.statusPerkawinan || '-'}`,
    `Pekerjaan         : ${ktp.pekerjaan || '-'}`,
    `Kewarganegaraan   : ${ktp.kewarganegaraan || 'WNI'}`,
    `Berlaku Hingga    : ${ktp.berlakuHingga || '-'}`,
    `==============================`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatAllKTPsForClipboard(ktpList) {
  if (!ktpList || ktpList.length === 0) return '';
  return ktpList.map((ktp, i) => formatKTPForClipboard(ktp, i)).join('\n\n');
}
