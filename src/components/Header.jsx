import React from 'react';
import { Scan, Sparkles, Zap, ShieldCheck, FileText, Key, CheckCircle, LogOut } from 'lucide-react';

export default function Header({ onLoadSample, fileCount, hasApiKey, onOpenApiKey, currentUser, onLogout }) {
  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        
        {/* Brand */}
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Scan className="w-4 h-4 text-white" />
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-bold text-white text-sm tracking-tight">ScanKTP</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-semibold">AI</span>
          </div>
        </div>

        {/* Center badges */}
        <div className="hidden md:flex items-center space-x-4 text-xs text-slate-400">
          <span className="flex items-center space-x-1">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span>Gemini Vision OCR</span>
          </span>
          <span className="w-1 h-1 rounded-full bg-slate-700" />
          <span className="flex items-center space-x-1">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>100% Client-Side</span>
          </span>
          <span className="w-1 h-1 rounded-full bg-slate-700" />
          <span className="flex items-center space-x-1">
            <FileText className="w-3 h-3 text-cyan-400" />
            <span>Max {fileCount}/10 File</span>
          </span>
        </div>

        {/* Right: User Greeting, API key status & sample */}
        <div className="flex items-center space-x-2">
          {/* User greeting */}
          {currentUser && (
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Hi {currentUser}</span>
            </div>
          )}

          {/* API Key Button */}
          <button
            id="btn-api-key"
            onClick={onOpenApiKey}
            className={`flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-200 ${
              hasApiKey
                ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-400 hover:bg-emerald-900/60'
                : 'bg-amber-950/60 border-amber-500/40 text-amber-400 hover:bg-amber-900/60 animate-pulse'
            }`}
          >
            {hasApiKey ? (
              <CheckCircle className="w-3.5 h-3.5" />
            ) : (
              <Key className="w-3.5 h-3.5" />
            )}
            <span className="hidden xs:inline">{hasApiKey ? 'Gemini Aktif' : 'Set API Key'}</span>
          </button>

          {/* Sample Demo */}
          <button
            id="btn-load-sample"
            onClick={onLoadSample}
            className="flex items-center space-x-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg bg-indigo-600/20 border border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/40 text-xs font-semibold transition-all duration-200"
          >
            <Zap className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Demo</span>
          </button>

          {/* Logout button */}
          {currentUser && (
            <button
              onClick={onLogout}
              title="Keluar"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/30 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
