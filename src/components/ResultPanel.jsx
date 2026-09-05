import React, { useState } from 'react';
import { Copy, Check, FileText, Table, Sparkles, Layers, Edit3, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { formatKTPForClipboard, formatAllKTPsForClipboard } from '../utils/ktpParser';

export default function ResultPanel({
  items,
  selectedIndex,
  onSelectIndex,
  onUpdateKTPData
}) {
  const [copiedSingle, setCopiedSingle] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [activeView, setActiveView] = useState('table'); // 'table' | 'raw'
  const [toastMsg, setToastMsg] = useState('');

  const currentItem = items[selectedIndex];
  const ktpData = currentItem?.parsedData;

  const showToast = (msg) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  const handleCopySingle = () => {
    if (!ktpData) return;
    const formattedText = formatKTPForClipboard(ktpData, selectedIndex);
    navigator.clipboard.writeText(formattedText);
    setCopiedSingle(true);
    showToast(`Berhasil menyalin data KTP #${selectedIndex + 1}!`);
    setTimeout(() => setCopiedSingle(false), 2000);
  };

  const handleCopyAll = () => {
    const completedItems = items.filter(it => it.status === 'done' && it.parsedData);
    if (completedItems.length === 0) return;

    const formattedAll = formatAllKTPsForClipboard(completedItems.map(it => it.parsedData));
    navigator.clipboard.writeText(formattedAll);
    setCopiedAll(true);
    showToast(`Berhasil menyalin seluruh data (${completedItems.length} KTP) ke clipboard!`);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleFieldChange = (field, value) => {
    if (!ktpData) return;
    const updated = { ...ktpData, [field]: value };
    onUpdateKTPData(selectedIndex, updated);
  };

  // If no items at all
  if (!items || items.length === 0) {
    return (
      <div className="h-full min-h-[420px] rounded-2xl glass-panel border border-slate-800/80 p-8 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4">
          <Table className="w-8 h-8 text-indigo-400" />
        </div>
        <h3 className="text-base font-semibold text-slate-200 mb-1">
          Hasil Scan Akan Muncul Di Sini
        </h3>
        <p className="text-xs text-slate-400 max-w-sm">
          Unggah foto KTP atau PDF di panel kiri, lalu klik <span className="text-indigo-400 font-semibold">"Mulai Scan"</span>. Tabel data hasil ekstraksi kata-kata akan langsung tampil di sini.
        </p>
      </div>
    );
  }

  // Count done items
  const doneCount = items.filter(it => it.status === 'done').length;

  return (
    <div className="relative flex flex-col h-full rounded-2xl glass-panel border border-slate-800/80 p-5 shadow-2xl">
      
      {/* Toast Notification */}
      {toastMsg && (
        <div className="absolute top-4 right-4 z-50 px-4 py-2.5 rounded-xl bg-emerald-500 text-slate-950 font-semibold text-xs shadow-glow-emerald flex items-center space-x-2 animate-bounce">
          <CheckCircle2 className="w-4 h-4" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top Header & Copy Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-base font-bold text-white flex items-center">
              <Sparkles className="w-4 h-4 text-cyan-400 mr-1.5" />
              Hasil Ekstraksi Data KTP
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {doneCount}/{items.length} Selesai
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Review & edit hasil scan di tabel bawah sebelum menyalin ke clipboard
          </p>
        </div>

        {/* Global Copy All Button */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleCopyAll}
            disabled={doneCount === 0}
            className="w-full sm:w-auto px-3.5 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white shadow-lg shadow-emerald-600/20 active:scale-95 transition-all flex items-center justify-center space-x-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {copiedAll ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>Salin Semua KTP ({doneCount})</span>
          </button>
        </div>
      </div>

      {/* KTP Selector Tabs (Multi-KTP Navigation) */}
      <div className="flex items-center space-x-1.5 py-3 overflow-x-auto border-b border-slate-800/50 no-scrollbar">
        {items.map((item, idx) => {
          const active = selectedIndex === idx;
          return (
            <button
              key={item.id}
              onClick={() => onSelectIndex(idx)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex items-center space-x-1.5 ${
                active
                  ? 'bg-indigo-600 text-white shadow-glow-brand font-semibold'
                  : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              <span>Foto #{idx + 1}</span>
              {item.status === 'done' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* Main Selected KTP Content View */}
      {currentItem && (
        <div className="flex-1 flex flex-col pt-3 min-h-0">
          
          {/* Subheader Toolbar */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-1 bg-slate-900/80 p-1 rounded-lg border border-slate-800">
              <button
                onClick={() => setActiveView('table')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center space-x-1 transition-all ${
                  activeView === 'table'
                    ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Table className="w-3.5 h-3.5" />
                <span>Tabel Data</span>
              </button>
              <button
                onClick={() => setActiveView('raw')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center space-x-1 transition-all ${
                  activeView === 'raw'
                    ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Teks Mentah (OCR)</span>
              </button>
            </div>

            {/* Single Copy Button for currently selected KTP */}
            {ktpData && (
              <button
                onClick={handleCopySingle}
                className="px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-medium transition-all flex items-center space-x-1.5"
              >
                {copiedSingle ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Salin Data Foto Ini</span>
              </button>
            )}
          </div>

          {/* Pending or Processing Loader State */}
          {currentItem.status === 'pending' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <Layers className="w-10 h-10 text-slate-600 mb-2" />
              <p className="text-xs font-medium">KTP ini dalam antrean.</p>
              <p className="text-[11px] text-slate-500">Klik "Mulai Scan" untuk membaca kata-kata dari foto ini.</p>
            </div>
          )}

          {currentItem.status === 'processing' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <div className="w-12 h-12 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mb-3" />
              <p className="text-sm font-semibold text-cyan-300">Menganalisis & Mengindeks KTP...</p>
              <p className="text-xs text-slate-400 mt-1">Ekstraksi teks dengan kecerdasan OCR ({currentItem.progress || 0}%)</p>
            </div>
          )}

          {currentItem.status === 'error' && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-rose-400">
              <ShieldAlert className="w-10 h-10 mb-2" />
              <p className="text-sm font-semibold">Gagal Memindai Foto KTP</p>
              <p className="text-xs text-slate-400 max-w-xs mt-1">{currentItem.error || 'Foto kurang jelas atau format tidak terbaca.'}</p>
            </div>
          )}

          {/* Table Data View */}
          {currentItem.status === 'done' && ktpData && activeView === 'table' && (
            <div className="flex-1 overflow-y-auto pr-1">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden shadow-inner">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/90 text-slate-400 font-mono text-[10px] uppercase border-b border-slate-800">
                    <tr>
                      <th className="px-3 py-2.5 w-1/3">Field / Kategori</th>
                      <th className="px-3 py-2.5 w-2/3">Data Hasil Scan (Dapat Diedit)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    
                    {/* Provinsi & Kota */}
                    <TableRow label="PROVINSI" value={ktpData.provinsi} onChange={(val) => handleFieldChange('provinsi', val)} />
                    <TableRow label="KOTA / KABUPATEN" value={ktpData.kota} onChange={(val) => handleFieldChange('kota', val)} />
                    
                    {/* NIK Highlighted */}
                    <tr className="bg-indigo-950/20 hover:bg-indigo-950/40">
                      <td className="px-3 py-2.5 font-bold text-indigo-300 flex items-center space-x-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                        <span>NIK (16 Digit)</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="text"
                          value={ktpData.nik}
                          onChange={(e) => handleFieldChange('nik', e.target.value)}
                          className="w-full bg-slate-900 border border-indigo-500/40 rounded px-2 py-1 text-cyan-300 font-mono font-bold tracking-wider focus:outline-none focus:border-cyan-400 text-sm"
                        />
                      </td>
                    </tr>

                    <TableRow label="NAMA LENGKAP" value={ktpData.nama} onChange={(val) => handleFieldChange('nama', val)} isBold />
                    <TableRow label="TEMPAT / TGL LAHIR" value={ktpData.tempatTglLahir} onChange={(val) => handleFieldChange('tempatTglLahir', val)} />
                    
                    {/* Gender & Blood Type */}
                    <tr className="hover:bg-slate-900/40">
                      <td className="px-3 py-2.5 text-slate-400 font-medium">JENIS KELAMIN & GOL DARAH</td>
                      <td className="px-3 py-1.5">
                        <div className="flex space-x-2">
                          <input
                            type="text"
                            value={ktpData.jenisKelamin}
                            onChange={(e) => handleFieldChange('jenisKelamin', e.target.value)}
                            placeholder="PEREMPUAN / LAKI-LAKI"
                            className="w-2/3 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500"
                          />
                          <input
                            type="text"
                            value={ktpData.golDarah}
                            onChange={(e) => handleFieldChange('golDarah', e.target.value)}
                            placeholder="Gol: B"
                            className="w-1/3 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 text-center font-mono focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                      </td>
                    </tr>

                    <TableRow label="ALAMAT" value={ktpData.alamat} onChange={(val) => handleFieldChange('alamat', val)} />
                    <TableRow label="RT / RW" value={ktpData.rtRw} onChange={(val) => handleFieldChange('rtRw', val)} />
                    <TableRow label="KEL / DESA" value={ktpData.kelDesa} onChange={(val) => handleFieldChange('kelDesa', val)} />
                    <TableRow label="KECAMATAN" value={ktpData.kecamatan} onChange={(val) => handleFieldChange('kecamatan', val)} />
                    <TableRow label="AGAMA" value={ktpData.agama} onChange={(val) => handleFieldChange('agama', val)} />
                    <TableRow label="STATUS PERKAWINAN" value={ktpData.statusPerkawinan} onChange={(val) => handleFieldChange('statusPerkawinan', val)} />
                    <TableRow label="PEKERJAAN" value={ktpData.pekerjaan} onChange={(val) => handleFieldChange('pekerjaan', val)} />
                    <TableRow label="KEWARGANEGARAAN" value={ktpData.kewarganegaraan} onChange={(val) => handleFieldChange('kewarganegaraan', val)} />
                    <TableRow label="BERLAKU HINGGA" value={ktpData.berlakuHingga} onChange={(val) => handleFieldChange('berlakuHingga', val)} />

                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Raw OCR Text View */}
          {currentItem.status === 'done' && ktpData && activeView === 'raw' && (
            <div className="flex-1 overflow-y-auto">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                {ktpData.rawText || 'Tidak ada teks mentah.'}
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  );
}

function TableRow({ label, value, onChange, isBold }) {
  return (
    <tr className="hover:bg-slate-900/40">
      <td className="px-3 py-2 text-slate-400 font-medium">{label}</td>
      <td className="px-3 py-1 text-slate-200">
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Input ${label.toLowerCase()}...`}
          className={`w-full bg-slate-900/70 border border-slate-800/80 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-indigo-500/80 focus:bg-slate-900 ${
            isBold ? 'font-bold text-white' : ''
          }`}
        />
      </td>
    </tr>
  );
}
