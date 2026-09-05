/**
 * Indonesian e-KTP Text Parser
 * Cleans raw OCR text output and extracts structured e-KTP fields using regex and fuzzy matching.
 */

export function parseKTPText(rawText) {
  if (!rawText) return getDefaultKTPData();

  const lines = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const data = getDefaultKTPData();
  data.rawText = rawText;

  // Helper function to extract text after colon or label
  const getValueAfterKey = (line, keys) => {
    for (const key of keys) {
      const idx = line.toUpperCase().indexOf(key.toUpperCase());
      if (idx !== -1) {
        let remainder = line.substring(idx + key.length).trim();
        // Remove leading colons or special chars
        remainder = remainder.replace(/^[:;\s\-\.=]+/, '').trim();
        return remainder;
      }
    }
    return '';
  };

  // 1. Provinsi & Kota/Kabupaten
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const uppercaseLine = lines[i].toUpperCase();
    if (uppercaseLine.includes('PROVINSI')) {
      data.provinsi = uppercaseLine.replace(/.*PROVINSI\s*/, '').replace(/^[:;\s]+/, '').trim();
    } else if (uppercaseLine.includes('KOTA') || uppercaseLine.includes('KABUPATEN') || uppercaseLine.includes('JAKARTA')) {
      if (!uppercaseLine.includes('PROVINSI')) {
        data.kota = uppercaseLine.replace(/^[:;\s]+/, '').trim();
      }
    }
  }

  // Iterate lines for standard fields
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    // 2. NIK (16 Digits)
    if (upper.includes('NIK') || upper.match(/\b\d{14,17}\b/) || upper.match(/3[0-9I1lO0]{15}/)) {
      const val = getValueAfterKey(line, ['NIK']);
      // Clean digits (fix OCR 0 vs O, 1 vs I/l)
      let cleanedDigits = (val || line)
        .replace(/O/g, '0')
        .replace(/[Il|]/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/\D/g, '');

      if (cleanedDigits.length >= 15) {
        data.nik = cleanedDigits.substring(0, 16);
      } else if (val) {
        data.nik = val;
      }
    }

    // 3. Nama
    if (upper.includes('NAMA') && !upper.includes('NEGARA') && !upper.includes('AGAMA')) {
      const val = getValueAfterKey(line, ['NAMA']);
      if (val) data.nama = val.replace(/[^A-Za-z\s\.,']/g, '').trim();
    }

    // 4. Tempat/Tgl Lahir
    if (upper.includes('TEMPAT') || upper.includes('LAHIR') || upper.includes('TGL')) {
      const val = getValueAfterKey(line, ['TEMPAT/TGL LAHIR', 'TEMPAT TGL LAHIR', 'TEMPAT/TGL', 'LAHIR']);
      if (val) {
        data.tempatTglLahir = val;
      }
    }

    // 5. Jenis Kelamin & Gol Darah
    if (upper.includes('JENIS KELAMIN') || upper.includes('KELAMIN') || upper.includes('LAKI') || upper.includes('PEREMPUAN')) {
      if (upper.includes('LAKI')) data.jenisKelamin = 'LAKI-LAKI';
      else if (upper.includes('PEREMPUAN')) data.jenisKelamin = 'PEREMPUAN';

      if (upper.includes('GOL') || upper.includes('DARAH')) {
        const golMatch = upper.match(/GOL\.?\s*DARAH\s*:?\s*([A-B-O]+)/i);
        if (golMatch) {
          data.golDarah = golMatch[1];
        }
      }
    } else if (upper.includes('GOL. DARAH') || upper.includes('GOL DARAH')) {
      const gol = getValueAfterKey(line, ['GOL. DARAH', 'GOL DARAH', 'DARAH']);
      if (gol) data.golDarah = gol.substring(0, 3).trim();
    }

    // 6. Alamat
    if (upper.includes('ALAMAT')) {
      const val = getValueAfterKey(line, ['ALAMAT']);
      if (val) data.alamat = val;
    }

    // 7. RT/RW
    if (upper.includes('RT/') || upper.includes('RT /') || upper.includes('RT/RW') || upper.match(/\bRT\b/)) {
      const val = getValueAfterKey(line, ['RT/RW', 'RT / RW', 'RT']);
      if (val) data.rtRw = val;
    }

    // 8. Kel/Desa
    if (upper.includes('KEL') || upper.includes('DESA') || upper.includes('KELURAHAN')) {
      const val = getValueAfterKey(line, ['KEL/DESA', 'KEL / DESA', 'KELURAHAN', 'DESA', 'KEL']);
      if (val) data.kelDesa = val;
    }

    // 9. Kecamatan
    if (upper.includes('KECAMATAN') || upper.includes('KEC')) {
      const val = getValueAfterKey(line, ['KECAMATAN', 'KEC']);
      if (val) data.kecamatan = val;
    }

    // 10. Agama
    if (upper.includes('AGAMA')) {
      const val = getValueAfterKey(line, ['AGAMA']);
      if (val) {
        data.agama = normalizeAgama(val);
      }
    }

    // 11. Status Perkawinan
    if (upper.includes('STATUS') || upper.includes('PERKAWINAN') || upper.includes('KAWIN')) {
      const val = getValueAfterKey(line, ['STATUS PERKAWINAN', 'STATUS', 'PERKAWINAN']);
      if (val) {
        if (val.toUpperCase().includes('BELUM')) data.statusPerkawinan = 'BELUM KAWIN';
        else if (val.toUpperCase().includes('CERAI MATI')) data.statusPerkawinan = 'CERAI MATI';
        else if (val.toUpperCase().includes('CERAI HIDUP')) data.statusPerkawinan = 'CERAI HIDUP';
        else if (val.toUpperCase().includes('KAWIN')) data.statusPerkawinan = 'KAWIN';
        else data.statusPerkawinan = val;
      }
    }

    // 12. Pekerjaan
    if (upper.includes('PEKERJAAN')) {
      const val = getValueAfterKey(line, ['PEKERJAAN']);
      if (val) data.pekerjaan = val;
    }

    // 13. Kewarganegaraan
    if (upper.includes('KEWARGANEGARAAN') || upper.includes('WNI') || upper.includes('WNA')) {
      if (upper.includes('WNI')) data.kewarganegaraan = 'WNI';
      else if (upper.includes('WNA')) data.kewarganegaraan = 'WNA';
      else {
        const val = getValueAfterKey(line, ['KEWARGANEGARAAN']);
        if (val) data.kewarganegaraan = val;
      }
    }

    // 14. Berlaku Hingga
    if (upper.includes('BERLAKU') || upper.includes('HINGGA') || upper.includes('SEUMUR')) {
      const val = getValueAfterKey(line, ['BERLAKU HINGGA', 'BERLAKU']);
      if (val) data.berlakuHingga = val;
    }
  }

  return data;
}

function normalizeAgama(raw) {
  const upper = raw.toUpperCase();
  if (upper.includes('ISLAM')) return 'ISLAM';
  if (upper.includes('KRISTEN')) return 'KRISTEN';
  if (upper.includes('KATHOLIK') || upper.includes('KATOLIK')) return 'KATHOLIK';
  if (upper.includes('HINDU')) return 'HINDU';
  if (upper.includes('BUDDHA') || upper.includes('BUDHA')) return 'BUDDHA';
  if (upper.includes('KHONGHUCU') || upper.includes('KONGHUCU')) return 'KHONGHUCU';
  return raw;
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

/**
 * Formats a single parsed KTP object into clean text for copying to clipboard
 */
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

/**
 * Formats all KTP objects into a combined clipboard text string
 */
export function formatAllKTPsForClipboard(ktpList) {
  if (!ktpList || ktpList.length === 0) return '';
  return ktpList
    .map((ktp, i) => formatKTPForClipboard(ktp, i))
    .join('\n\n');
}
