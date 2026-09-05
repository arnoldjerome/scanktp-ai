/**
 * Super-Resilient Positional & Regex e-KTP Parser
 * Combines fuzzy keyword matching, colon extraction, 16-digit NIK detection,
 * and standard e-KTP line sequence positional fallbacks.
 */

export function parseKTPText(rawText) {
  if (!rawText) return getDefaultKTPData();

  const data = getDefaultKTPData();
  data.rawText = rawText;

  // Clean lines
  const lines = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // Helper to extract text after colon or key
  const getValue = (line) => {
    if (!line) return '';
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      return line.substring(colonIdx + 1).trim();
    }
    return line.trim();
  };

  // 1. Search for 16-Digit NIK across entire text
  // Replace common OCR digit typos
  const digitFixedText = rawText
    .replace(/[O]/g, '0')
    .replace(/[Il|i]/g, '1')
    .replace(/[S]/g, '5')
    .replace(/[B]/g, '8')
    .replace(/[Z]/g, '2')
    .replace(/[gq]/g, '9');

  // Match 16-digit sequence or 15-17 digits
  const nikMatch = digitFixedText.match(/\b\d{15,17}\b/);
  if (nikMatch) {
    data.nik = nikMatch[0].substring(0, 16);
  }

  // 2. Keyword & Positional Processing
  let nikLineIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    // PROVINSI
    if (upper.includes('PROV') || upper.includes('PROVINSI')) {
      data.provinsi = upper.replace(/.*PROV[IINSI]*\s*/i, '').replace(/^[:;\s]+/, '').trim();
    }

    // KABUPATEN / KOTA
    if (upper.includes('KABUPATEN') || upper.includes('KOTA') || upper.includes('PEKALONGAN') || upper.includes('JAKARTA')) {
      if (!upper.includes('PROVINSI')) {
        data.kota = upper.replace(/.*(?:KABUPATEN|KOTA)\s*/i, '').replace(/^[:;\s]+/, '').trim();
        if (!data.kota && upper.includes('KABUPATEN')) data.kota = line;
      }
    }

    // NIK Line
    if (upper.includes('NIK') || upper.includes('N1K') || upper.match(/\b\d{15,16}\b/)) {
      nikLineIdx = i;
      if (!data.nik) {
        const val = getValue(line);
        const cleaned = val.replace(/\D/g, '');
        if (cleaned.length >= 14) data.nik = cleaned.substring(0, 16);
      }
    }

    // NAMA
    if (upper.includes('NAMA') && !upper.includes('AGAMA') && !upper.includes('NEGARA')) {
      const val = getValue(line);
      if (val) data.nama = cleanName(val);
    }

    // TEMPAT / TGL LAHIR
    if (upper.includes('TEMPAT') || upper.includes('LAHIR') || upper.includes('TGL') || upper.match(/\b\d{2}[\-\/]\d{2}[\-\/]\d{4}\b/)) {
      const val = getValue(line);
      if (val) data.tempatTglLahir = val;
    }

    // JENIS KELAMIN & GOL DARAH
    if (upper.includes('KELAMIN') || upper.includes('LAKI') || upper.includes('PEREMPUAN')) {
      if (upper.includes('LAKI')) data.jenisKelamin = 'LAKI-LAKI';
      else if (upper.includes('PEREMPUAN')) data.jenisKelamin = 'PEREMPUAN';

      if (upper.includes('GOL') || upper.includes('DARAH')) {
        const golMatch = upper.match(/GOL\.?\s*DARAH\s*:?\s*([A-B-O\-]+)/i) || upper.match(/\b(A|B|AB|O|-)\b/);
        if (golMatch) data.golDarah = golMatch[1] || '-';
      }
    }

    // ALAMAT
    if (upper.includes('ALAMAT')) {
      const val = getValue(line);
      if (val) data.alamat = val;
    }

    // RT / RW
    const rtMatch = upper.match(/\b\d{2,3}\s*[\/\\]\s*\d{2,3}\b/);
    if (rtMatch) {
      data.rtRw = rtMatch[0].replace(/\s+/g, '');
    }

    // KEL / DESA
    if (upper.includes('KEL') || upper.includes('DESA') || upper.includes('KELURAHAN')) {
      const val = getValue(line);
      if (val) data.kelDesa = val;
    }

    // KECAMATAN
    if (upper.includes('KECAMATAN') || upper.includes('KEC')) {
      const val = getValue(line);
      if (val) data.kecamatan = val;
    }

    // AGAMA
    if (upper.includes('AGAMA') || upper.includes('ISLAM') || upper.includes('KRISTEN') || upper.includes('HINDU') || upper.includes('BUDDHA')) {
      const val = getValue(line);
      if (val) data.agama = normalizeAgama(val);
    }

    // STATUS PERKAWINAN
    if (upper.includes('KAWIN') || upper.includes('PERKAWINAN') || upper.includes('STATUS')) {
      if (upper.includes('BELUM')) data.statusPerkawinan = 'BELUM KAWIN';
      else if (upper.includes('CERAI MATI')) data.statusPerkawinan = 'CERAI MATI';
      else if (upper.includes('CERAI HIDUP')) data.statusPerkawinan = 'CERAI HIDUP';
      else if (upper.includes('KAWIN')) data.statusPerkawinan = 'KAWIN';
    }

    // PEKERJAAN
    if (upper.includes('PEKERJAAN') || upper.includes('PEDAGANG') || upper.includes('SWASTA') || upper.includes('PNS') || upper.includes('WIRASWASTA') || upper.includes('PELAJAR')) {
      const val = getValue(line);
      if (val) data.pekerjaan = val;
      else if (!upper.includes('PEKERJAAN')) data.pekerjaan = line;
    }

    // KEWARGANEGARAAN
    if (upper.includes('KEWARGANEGARAAN') || upper.includes('WNI') || upper.includes('WNA')) {
      if (upper.includes('WNI')) data.kewarganegaraan = 'WNI';
      else if (upper.includes('WNA')) data.kewarganegaraan = 'WNA';
    }

    // BERLAKU HINGGA
    if (upper.includes('BERLAKU') || upper.includes('SEUMUR') || upper.includes('HINGGA')) {
      if (upper.includes('SEUMUR')) data.berlakuHingga = 'SEUMUR HIDUP';
      else {
        const val = getValue(line);
        if (val) data.berlakuHingga = val;
      }
    }
  }

  // 3. Positional Sequence Fallbacks
  // If labels like 'Nama', 'Alamat' were blurred, use colon-values after NIK line!
  if (nikLineIdx !== -1) {
    const remainingLines = lines.slice(nikLineIdx + 1);
    
    // Search remaining lines sequentially for missing fields
    for (const remLine of remainingLines) {
      const remUpper = remLine.toUpperCase();
      const val = getValue(remLine);

      // Candidate for Name (line after NIK containing letters without numbers)
      if (!data.nama && val && !val.match(/\d/) && val.length > 3 && !remUpper.includes('LAKI') && !remUpper.includes('PEREMPUAN') && !remUpper.includes('ISLAM')) {
        data.nama = cleanName(val);
      }

      // Candidate for Tempat/Tgl Lahir (contains date or numbers)
      if (!data.tempatTglLahir && (remLine.includes('-') || remLine.includes('/') || remUpper.includes('PEKALONGAN') || remUpper.includes('JAKARTA'))) {
        if (remLine.match(/\d{2}[\-\/]\d{2}[\-\/]\d{4}/)) {
          data.tempatTglLahir = val || remLine;
        }
      }

      // Candidate for Alamat (line after Gender)
      if (!data.alamat && (remUpper.includes('DUSUN') || remUpper.includes('JL') || remUpper.includes('JALAN') || remUpper.includes('DESA') || remUpper.includes('KAUMAN'))) {
        data.alamat = val || remLine;
      }
    }
  }

  return data;
}

function cleanName(raw) {
  if (!raw) return '';
  return raw
    .replace(/^[:;\s]+/, '')
    .replace(/[^A-Za-z\s\.,']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAgama(raw) {
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (upper.includes('ISLAM')) return 'ISLAM';
  if (upper.includes('KRISTEN')) return 'KRISTEN';
  if (upper.includes('KATHOLIK') || upper.includes('KATOLIK')) return 'KATHOLIK';
  if (upper.includes('HINDU')) return 'HINDU';
  if (upper.includes('BUDDHA') || upper.includes('BUDHA')) return 'BUDDHA';
  if (upper.includes('KHONGHUCU') || upper.includes('KONGHUCU')) return 'KHONGHUCU';
  return raw.replace(/.*AGAMA\s*:?/i, '').replace(/^[:;\s]+/, '').trim();
}

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
    rawText: ''
  };
}

export function formatKTPForClipboard(ktp, index = null) {
  const header = index !== null ? `=== DATA KTP #${index + 1} ===` : `=== DATA KTP ===`;
  
  return [
    header,
    ktp.provinsi ? `PROVINSI           : ${ktp.provinsi}` : null,
    ktp.kota ? `KOTA/KABUPATEN     : ${ktp.kota}` : null,
    `NIK                : ${ktp.nik || '-'}`,
    `Nama               : ${ktp.nama || '-'}`,
    `Tempat/Tgl Lahir   : ${ktp.tempatTglLahir || '-'}`,
    `Jenis Kelamin      : ${ktp.jenisKelamin || '-'}  (Gol. Darah: ${ktp.golDarah || '-'})`,
    `Alamat             : ${ktp.alamat || '-'}`,
    `RT/RW              : ${ktp.rtRw || '-'}`,
    `Kel/Desa           : ${ktp.kelDesa || '-'}`,
    `Kecamatan          : ${ktp.kecamatan || '-'}`,
    `Agama              : ${ktp.agama || '-'}`,
    `Status Perkawinan  : ${ktp.statusPerkawinan || '-'}`,
    `Pekerjaan          : ${ktp.pekerjaan || '-'}`,
    `Kewarganegaraan    : ${ktp.kewarganegaraan || 'WNI'}`,
    `Berlaku Hingga     : ${ktp.berlakuHingga || 'SEUMUR HIDUP'}`,
    `==============================`
  ].filter(Boolean).join('\n');
}

export function formatAllKTPsForClipboard(ktpList) {
  if (!ktpList || ktpList.length === 0) return '';
  return ktpList
    .map((ktp, i) => formatKTPForClipboard(ktp, i))
    .join('\n\n');
}
