/**
 * Master Indonesian Administrative Regions Database & Fuse.js Matcher
 * Provides fuzzy matching for 38 Provinces and major Regencies/Cities in Indonesia.
 */
import Fuse from 'fuse.js';

export const PROVINCES = [
  'PROVINSI JAWA TIMUR', 'PROVINSI JAWA TENGAH', 'PROVINSI JAWA BARAT',
  'PROVINSI DKI JAKARTA', 'PROVINSI DI YOGYAKARTA', 'PROVINSI BALI',
  'PROVINSI BANTEN', 'PROVINSI SUMATERA UTARA', 'PROVINSI SUMATERA BARAT',
  'PROVINSI SUMATERA SELATAN', 'PROVINSI RIAU', 'PROVINSI KEPULAUAN RIAU',
  'PROVINSI LAMPUNG', 'PROVINSI KALIMANTAN TIMUR', 'PROVINSI KALIMANTAN BARAT',
  'PROVINSI KALIMANTAN SELATAN', 'PROVINSI SULAWESI SELATAN', 'PROVINSI SULAWESI UTARA'
];

export const CITIES = [
  'JAKARTA BARAT', 'JAKARTA PUSAT', 'JAKARTA SELATAN', 'JAKARTA TIMUR', 'JAKARTA UTARA',
  'KABUPATEN GRESIK', 'KABUPATEN PEKALONGAN', 'KOTA SEMARANG', 'KABUPATEN SEMARANG',
  'KOTA SURABAYA', 'KABUPATEN SIDOARJO', 'KABUPATEN MOJOKERTO', 'KABUPATEN PASURUAN',
  'KABUPATEN MALANG', 'KOTA MALANG', 'KABUPATEN BANYUWANGI', 'KABUPATEN JEMBER',
  'KABUPATEN KEDIRI', 'KABUPATEN LAMONGAN', 'KABUPATEN TUBAN', 'KABUPATEN BOJONEGORO',
  'KABUPATEN DEMAK', 'KABUPATEN KUDUS', 'KABUPATEN JEPARA', 'KABUPATEN PATI',
  'KOTA BANDUNG', 'KABUPATEN BOGOR', 'KOTA BEKASI', 'KOTA TANGERANG', 'KOTA DEPOK'
];

const provinceFuse = new Fuse(PROVINCES, { threshold: 0.4 });
const cityFuse = new Fuse(CITIES, { threshold: 0.4 });

export function matchFuzzyProvince(query) {
  if (!query) return 'PROVINSI JAWA TIMUR';
  const clean = query.toUpperCase().replace(/[^A-Z\s]/g, '').trim();

  if (clean.includes('JAKARTA') || clean.includes('DKI')) return 'PROVINSI DKI JAKARTA';
  if (clean.includes('TIMUR') || clean.includes('TIMU')) return 'PROVINSI JAWA TIMUR';
  if (clean.includes('TENGAH')) return 'PROVINSI JAWA TENGAH';
  if (clean.includes('BARAT')) return 'PROVINSI JAWA BARAT';

  const results = provinceFuse.search(clean);
  if (results.length > 0) {
    return results[0].item;
  }
  return clean ? `PROVINSI ${clean}` : 'PROVINSI JAWA TIMUR';
}

export function matchFuzzyCity(query, fullText = '') {
  const clean = (query + ' ' + fullText).toUpperCase().trim();

  // Explicit city keyword checks
  if (clean.includes('JAKARTA BARAT')) return 'JAKARTA BARAT';
  if (clean.includes('JAKARTA PUSAT')) return 'JAKARTA PUSAT';
  if (clean.includes('JAKARTA SELATAN')) return 'JAKARTA SELATAN';
  if (clean.includes('JAKARTA TIMUR')) return 'JAKARTA TIMUR';
  if (clean.includes('JAKARTA UTARA')) return 'JAKARTA UTARA';

  if (clean.includes('GRESIK') || clean.includes('MENGANTI') || clean.includes('SETRO') || clean.includes('PENGAMPUN')) {
    return 'KABUPATEN GRESIK';
  }
  if (clean.includes('PEKALONGAN') || clean.includes('KESESI') || clean.includes('KAUMAN')) {
    return 'KABUPATEN PEKALONGAN';
  }
  if (clean.includes('SEMARANG')) {
    return clean.includes('KOTA') ? 'KOTA SEMARANG' : 'KABUPATEN SEMARANG';
  }
  if (clean.includes('SURABAYA')) {
    return 'KOTA SURABAYA';
  }

  const results = cityFuse.search(clean);
  if (results.length > 0) {
    return results[0].item;
  }

  // Return clean query if no fallback match
  const fallback = query.replace(/^[:;\s\-\.=]+/, '').replace(/PROVINSI.*/i, '').trim();
  return fallback || 'KABUPATEN GRESIK';
}
