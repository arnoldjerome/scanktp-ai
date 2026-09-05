import React from 'react';
import { Scan, Sparkles, Zap, ShieldCheck, FileText } from 'lucide-react';

export default function Header({ onLoadSample, fileCount }) {
  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand Logo */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 p-[1px] shadow-glow-brand flex items-center justify-center">
            <div className="w-full h-full bg-slate-950 rounded-[11px] flex items-center justify-center">
              <Scan className="w-5 h-5 text-cyan-400 animate-pulse" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
                ScanKTP<span className="text-cyan-400">.ai</span>
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                PRO OCR
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Convert Foto & PDF KTP ke Tabel Data • Fitur Salin Clipboard Instan
            </p>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center space-x-3">
          <button
            onClick={onLoadSample}
            className="flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700/80 text-cyan-300 border border-cyan-500/30 transition-all shadow-sm hover:shadow-glow-cyan"
            title="Uji coba langsung 1-click dengan sampel foto KTP"
          >
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Coba Demo KTP</span>
          </button>

          <div className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>100% Privasi (Client-Side)</span>
          </div>

          <div className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-400">
            Kapasitas: <span className={fileCount >= 10 ? "text-amber-400 font-bold" : "text-white"}>{fileCount}/10</span>
          </div>
        </div>

      </div>
    </header>
  );
}
