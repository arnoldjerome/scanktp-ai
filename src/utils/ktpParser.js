/**
 * Advanced e-KTP Fuzzy Parser
 * Designed to extract Indonesian ID Card fields even from imperfect OCR outputs.
 */

export function parseKTPText(rawText) {
  if (!rawText) return getDefaultKTPData();

  const data = getDefaultKTPData();
  data.rawText = rawText;

  const lines = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // Helper to extract text after key or delimiter
  const getValue = (line, keys) => {
    for (const key of keys) {
      const idx = line.toUpperCase().indexOf(key.toUpperCase());
      if (idx !== -1) {
        let remainder = line.substring(idx + key.length).trim();
        return remainder.replace(/^[:;\s\-\.=]+/, '').trim();
      }
    }
    return '';
  };

  // 1. Standalone NIK Search (16 Digits)
  // Scan entire raw text for 16-digit candidates (fixing common digit OCR errors)
  const fullCleanedDigitsText = rawText
    .replace(/[O]/gi, '0')
    .replace(/[Il|i]/g, '1')
    .replace(/[S]/gi, '5')
    .replace(/[B]/gi, '8')
    .replace(/[Z]/gi, '2')
    .replace(/[gq]/gi, '9');

  // Match 16 consecutive digits anywhere
  const nikMatch = fullCleanedDigitsText.match(/\b\d{16}\b/);
  if (nikMatch) {
    data.nik = nikMatch[0];
  }

  let nikLineIndex = -1;

  // Process line by line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    // 2. Provinsi & Kota/Kabupaten
    if (upper.includes('PROVINSI') || upper.includes('PROV')) {
      data.provinsi = upper.replace(/.*PROVINSI\s*/i, '').replace(/^[:;\s]+/, '').trim();
    } else if (upper.includes('KABUPATEN') || upper.includes('KOTA') || upper.includes('JAKARTA')) {
      if (!upper.includes('PROVINSI')) {
        data.kota = upper.replace(/^[:;\s]+/, '').trim();
      }
    }

    // 3. NIK Line Detection if not captured above
    if (upper.includes('NIK') || upper.includes('N1K') || upper.includes('NI K')) {
      nikLineIndex = i;
      if (!data.nik) {
        const val = getValue(line, ['NIK', 'N1K', 'NI K']);
        const cleaned = val
          .replace(/[O]/gi, '0')
          .replace(/[Il|i]/g, '1')
          .replace(/[S]/gi, '5')
          .replace(/[B]/gi, '8')
          .replace(/\D/g, '');
        if (cleaned.length >= 15) {
          data.nik = cleaned.substring(0, 16);
        } else if (val) {
          data.nik = val;
        }
      }
    }

    // 4. Nama (Check key 'NAMA' or line immediately following NIK line)
    if (upper.includes('NAMA') && !upper.includes('NEGARA') && !upper.includes('AGAMA')) {
      const val = getValue(line, ['NAMA', 'NAMA:']);
      if (val) data.nama = cleanName(val);
    } else if (nikLineIndex !== -1 && i === nikLineIndex + 1 && !data.nama) {
      // Positional fallback: line right after NIK
      if (!upper.includes('TEMPAT') && !upper.includes('LAHIR')) {
        data.nama = cleanName(line.replace(/^[:;\s]+/, ''));
      }
    }

    // 5. Tempat / Tgl Lahir
    if (upper.includes('TEMPAT') || upper.includes('LAHIR') || upper.includes('TGL') || upper.match(/\b\d{2}[\-\/]\d{2}[\-\/]\d{4}\b/)) {
      const val = getValue(line, ['TEMPAT/TGL LAHIR', 'TEMPAT TGL LAHIR', 'TEMPAT/TGL', 'LAHIR', 'TEMPAT']);
      if (val) {
        data.tempatTglLahir = val;
      } else {
        const dateMatch = upper.match(/([A-Z\s]+)?,?\s*(\d{2}[\-\/]\d{2}[\-\/]\d{4})/);
        if (dateMatch) {
          data.tempatTglLahir = line;
        }
      }
    }

    // 6. Jenis Kelamin & Gol Darah
    if (upper.includes('KELAMIN') || upper.includes('LAKI') || upper.includes('PEREMPUAN')) {
      if (upper.includes('LAKI')) data.jenisKelamin = 'LAKI-LAKI';
      else if (upper.includes('PEREMPUAN')) data.jenisKelamin = 'PEREMPUAN';

      const golMatch = upper.match(/GOL\.?\s*DARAH\s*:?\s*([A-B-O\-]+)/i) || upper.match(/\b(A|B|AB|O|-)\b/);
      if (golMatch && upper.includes('GOL')) {
        data.golDarah = golMatch[1] || '-';
      }
    }

    // 7. Alamat
    if (upper.includes('ALAMAT')) {
      const val = getValue(line, ['ALAMAT']);
      if (val) data.alamat = val;
    }

    // 8. RT / RW (Pattern 000/000)
    const rtRwMatch = upper.match(/\b\d{2,3}\s*[\/\\]\s*\d{2,3}\b/);
    if (rtRwMatch) {
      data.rtRw = rtRwMatch[0].replace(/\s+/g, '');
    } else if (upper.includes('RT/') || upper.includes('RT /') || upper.includes('RT')) {
      const val = getValue(line, ['RT/RW', 'RT / RW', 'RT']);
      if (val) data.rtRw = val;
    }

    // 9. Kel / Desa
    if (upper.includes('KEL') || upper.includes('DESA') || upper.includes('KELURAHAN')) {
      const val = getValue(line, ['KEL/DESA', 'KEL / DESA', 'KELURAHAN', 'DESA', 'KEL']);
      if (val) data.kelDesa = val;
    }

    // 10. Kecamatan
    if (upper.includes('KECAMATAN') || upper.includes('KEC')) {
      const val = getValue(line, ['KECAMATAN', 'KEC']);
      if (val) data.kecamatan = val;
    }

    // 11. Agama
    if (upper.includes('AGAMA') || upper.includes('ISLAM') || upper.includes('KRISTEN') || upper.includes('HINDU') || upper.includes('BUDDHA')) {
      const val = getValue(line, ['AGAMA']) || line;
      if (val) data.agama = normalizeAgama(val);
    }

    // 12. Status Perkawinan
    if (upper.includes('KAWIN') || upper.includes('STATUS') || upper.includes('PERKAWINAN')) {
      if (upper.includes('BELUM')) data.statusPerkawinan = 'BELUM KAWIN';
      else if (upper.includes('CERAI MATI')) data.statusPerkawinan = 'CERAI MATI';
      else if (upper.includes('CERAI HIDUP')) data.statusPerkawinan = 'CERAI HIDUP';
      else if (upper.includes('KAWIN')) data.statusPerkawinan = 'KAWIN';
    }

    // 13. Pekerjaan
    if (upper.includes('PEKERJAAN') || upper.includes('PEDAGANG') || upper.includes('SWASTA') || upper.includes('PNS') || upper.includes('WIRASWASTA') || upper.includes('PELAJAR')) {
      const val = getValue(line, ['PEKERJAAN']);
      if (val) data.pekerjaan = val;
      else if (!upper.includes('PEKERJAAN')) data.pekerjaan = line;
    }

    // 14. Kewarganegaraan
    if (upper.includes('KEWARGANEGARAAN') || upper.includes('WNI') || upper.includes('WNA')) {
      if (upper.includes('WNI')) data.kewarganegaraan = 'WNI';
      else if (upper.includes('WNA')) data.kewarganegaraan = 'WNA';
    }

    // 15. Berlaku Hingga
    if (upper.includes('BERLAKU') || upper.includes('SEUMUR') || upper.includes('HINGGA')) {
      if (upper.includes('SEUMUR')) data.berlakuHingga = 'SEUMUR HIDUP';
      else {
        const val = getValue(line, ['BERLAKU HINGGA', 'BERLAKU']);
        if (val) data.berlakuHingga = val;
      }
    }
  }

  return data;
}

function cleanName(raw) {
  return raw
    .replace(/[^A-Za-z\s\.,']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAgama(raw) {
  const upper = raw.toUpperCase();
  if (upper.includes('ISLAM')) return 'ISLAM';
  if (upper.includes('KRISTEN')) return 'KRISTEN';
  if (upper.includes('KATHOLIK') || upper.includes('KATOLIK')) return 'KATHOLIK';
  if (upper.includes('HINDU')) return 'HINDU';
  if (upper.includes('BUDDHA') || upper.includes('BUDHA')) return 'BUDDHA';
  if (upper.includes('KHONGHUCU') || upper.includes('KONGHUCU')) return 'KHONGHUCU';
  return raw.replace(/AGAMA\s*:?/i, '').trim();
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
