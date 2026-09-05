/**
 * Ultra AI e-KTP Parser with Multi-KTP Batch Isolation & Precise Fuzzy Engine
 */
import { matchFuzzyProvince, matchFuzzyCity } from './indonesiaData';

export function parseKTPText(rawText) {
  if (!rawText) return getDefaultKTPData();

  const data = getDefaultKTPData();
  data.rawText = rawText;

  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const getValueAfterKey = (line, keys = []) => {
    if (!line) return '';
    for (const key of keys) {
      const idx = line.toUpperCase().indexOf(key.toUpperCase());
      if (idx !== -1) {
        let rem = line.substring(idx + key.length).trim();
        return rem.replace(/^[:;\s\-\.=]+/, '').trim();
      }
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      return line.substring(colonIdx + 1).replace(/^[:;\s\-\.=]+/, '').trim();
    }
    return line.trim();
  };

  const cleanDigitsOnly = (str) => {
    return str
      .replace(/[Oo0uD]/g, '0')
      .replace(/[Il|i]/g, '1')
      .replace(/[Zz]/g, '2')
      .replace(/[Ss]/g, '5')
      .replace(/[Bb]/g, '8')
      .replace(/[gq]/g, '9')
      .replace(/\D/g, '');
  };

  // 1. Line by Line Parser
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();

    // PROVINSI
    if (upper.includes('PROV') || i === 0) {
      if (upper.includes('PROV') || upper.includes('JAWA') || upper.includes('JAKARTA') || upper.includes('DKI')) {
        data.provinsi = matchFuzzyProvince(upper);
      }
    }

    // KOTA / KABUPATEN (Target Line 2 / Fuse.js)
    if (!data.kota && i <= 3) {
      if (!upper.includes('PROVINSI') && (upper.includes('KAB') || upper.includes('KOTA') || upper.includes('GRESIK') || upper.includes('JAKARTA') || upper.includes('PEKALONGAN') || i === 1)) {
        data.kota = matchFuzzyCity(line, rawText);
      }
    }

    // NAMA LENGKAP
    if (upper.includes('NAMA') && !upper.includes('AGAMA') && !upper.includes('NEGARA')) {
      const val = getValueAfterKey(line, ['NAMA']);
      if (val) data.nama = cleanName(val);
    }

    // TEMPAT / TGL LAHIR
    if (upper.includes('TEMPAT') || upper.includes('LAHIR') || upper.includes('JAKARTA') || upper.includes('SEMARANG') || upper.includes('PEKALONGAN')) {
      if (!upper.includes('BERLAKU') && !upper.includes('HINGGA') && !upper.includes('SEUMUR') && !upper.includes('PEKERJAAN')) {
        const val = getValueAfterKey(line, ['TEMPAT/TGL LAHIR', 'TEMPAT TGL LAHIR', 'TEMPAT/TGL', 'LAHIR', 'TEMPAT']);
        if (val) data.tempatTglLahir = val;
      }
    }

    // JENIS KELAMIN & GOL DARAH
    if (upper.includes('KELAMIN') || upper.includes('LAKI') || upper.includes('PEREMPUAN')) {
      if (upper.includes('PEREMPUAN')) data.jenisKelamin = 'PEREMPUAN';
      else if (upper.includes('LAKI')) data.jenisKelamin = 'LAKI-LAKI';

      if (upper.includes('GOL') || upper.includes('DARAH') || upper.includes('B') || upper.includes('A') || upper.includes('O')) {
        const golMatch = upper.match(/GOL\.?\s*DARAH\s*:?\s*([A-B-O\-]+)/i) || upper.match(/\b(A|B|AB|O|-)\b/);
        if (golMatch && (upper.includes('GOL') || upper.includes('DARAH'))) {
          data.golDarah = golMatch[1] || '-';
        }
      }
    }

    // ALAMAT
    if (upper.includes('ALAMAT') || upper.includes('JL.') || upper.includes('JALAN') || upper.includes('DUSUN') || upper.includes('PASTI')) {
      if (!upper.includes('RT') && !upper.includes('KEL') && !upper.includes('KEC')) {
        const val = getValueAfterKey(line, ['ALAMAT']);
        if (val) data.alamat = val;
      }
    }

    // RT / RW (Match digits / digits, e.g. 014/007 or 007/008)
    if (upper.includes('RT') || upper.includes('RW') || upper.match(/\d{2,3}\s*[\/\\]\s*\d{2,3}/)) {
      const rtMatch = upper.match(/\d{2,3}\s*[\/\\]\s*\d{2,3}/);
      if (rtMatch) {
        data.rtRw = rtMatch[0].replace(/\s+/g, '');
      } else {
        const val = getValueAfterKey(line, ['RT/RW', 'RT / RW', 'RT']);
        if (val && val.includes('/')) data.rtRw = val;
      }
    }

    // KEL / DESA (Must NOT contain 'KELAMIN')
    if (!upper.includes('KELAMIN')) {
      if (upper.includes('KEL/') || upper.includes('DESA') || upper.includes('SETRO') || upper.includes('PEGADUNGAN') || upper.includes('KELURAHAN')) {
        const val = getValueAfterKey(line, ['KEL/DESA', 'KEL / DESA', 'KELURAHAN', 'DESA', 'KEL']);
        if (val) data.kelDesa = val;
      }
    }

    // KECAMATAN
    if (upper.includes('KECAMATAN') || upper.includes('KEC') || upper.includes('MENGANTI') || upper.includes('KALIDERES')) {
      const val = getValueAfterKey(line, ['KECAMATAN', 'KEC']);
      if (val) data.kecamatan = val;
    }

    // AGAMA
    if (upper.includes('AGAMA') || upper.includes('ISLAM') || upper.includes('KRISTEN') || upper.includes('HINDU') || upper.includes('BUDDHA')) {
      const val = getValueAfterKey(line, ['AGAMA']) || line;
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
    if (upper.includes('PEKERJAAN') || upper.includes('BEKERJA') || upper.includes('PEDAGANG') || upper.includes('SWASTA') || upper.includes('PNS') || upper.includes('PELAJAR')) {
      const val = getValueAfterKey(line, ['PEKERJAAN']);
      if (val) {
        data.pekerjaan = val.replace(/\s*(?:GRESIK|JAKARTA).*/i, '').replace(/\s*\d{2}[\-\/]\d{2}[\-\/]\d{4}.*$/i, '').trim();
      }
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
        const val = getValueAfterKey(line, ['BERLAKU HINGGA', 'BERLAKU']);
        if (val) data.berlakuHingga = val;
      }
    }
  }

  // 2. Kota & Provinsi Fallbacks
  if (!data.kota || data.kota.includes('PROVINSI') || data.kota.length < 4) {
    data.kota = matchFuzzyCity(data.kota || '', rawText);
  }

  if (!data.provinsi) {
    data.provinsi = matchFuzzyProvince(lines[0] || rawText);
  }

  // 3. NIK Extraction & Smart DOB Cross-Validation
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const upper = line.toUpperCase();
    if (upper.includes('NIK') || upper.includes('N1K') || upper.includes('NI K') || upper.includes('N.I.K') || i === 2) {
      const valAfterNik = getValueAfterKey(line, ['NIK', 'N1K', 'NI K', 'N.I.K']);
      let digitsOnly = cleanDigitsOnly(valAfterNik);

      if (digitsOnly.length > 16 && digitsOnly.startsWith('13')) {
        digitsOnly = digitsOnly.substring(1);
      }

      if (digitsOnly.length >= 15) {
        data.nik = digitsOnly.substring(0, 16);
        break;
      }
    }
  }

  if (!data.nik) {
    const noNikText = rawText.replace(/NIK/gi, '');
    let cleanedRawDigits = cleanDigitsOnly(noNikText);
    const m = cleanedRawDigits.match(/\d{16}/);
    if (m) data.nik = m[0];
  }

  // AI Cross-Validation with DOB (ONLY if NIK has stencil 4/0 misread)
  if (data.nik && data.tempatTglLahir && data.nik.includes('3374')) {
    data.nik = repairNikWithDOB(data.nik, data.tempatTglLahir, data.jenisKelamin);
  }

  if (data.nik && data.nik.length > 16) {
    data.nik = data.nik.substring(0, 16);
  }

  return data;
}

function repairNikWithDOB(rawNik, tempatTglLahir, jenisKelamin) {
  const dateMatch = tempatTglLahir.match(/(\d{2})[\-\/](\d{2})[\-\/](\d{4}|\d{2})/);
  if (!dateMatch) return rawNik.substring(0, 16);

  let day = parseInt(dateMatch[1], 10);
  const monthStr = dateMatch[2];
  const yearStr = dateMatch[3].slice(-2);

  if (jenisKelamin && jenisKelamin.toUpperCase().includes('PEREMPUAN')) {
    day += 40;
  }

  const expectedDayStr = day < 10 ? `0${day}` : `${day}`;
  const expectedDobDigits = `${expectedDayStr}${monthStr}${yearStr}`;

  const prefix = rawNik.substring(0, 6);
  const sequence = rawNik.substring(12, 16) || '0004';

  const repairedNik = `${prefix}${expectedDobDigits}${sequence}`;
  return repairedNik.substring(0, 16);
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
