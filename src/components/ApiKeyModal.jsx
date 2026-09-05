import React, { useState } from 'react';
import { Key, Eye, EyeOff, ExternalLink, CheckCircle, AlertCircle, X } from 'lucide-react';

/**
 * Gemini API Key configuration modal / inline form
 */
export default function ApiKeyModal({ apiKey, onSave, onClose }) {
  const [inputVal, setInputVal] = useState(apiKey || '');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState('idle'); // 'idle' | 'testing' | 'ok' | 'error'
  const [errMsg, setErrMsg] = useState('');

  const handleTest = async () => {
    const key = inputVal.trim();
    if (!key) { setErrMsg('Masukkan API Key terlebih dahulu'); setStatus('error'); return; }
    setStatus('testing');
    setErrMsg('');

    const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash-latest', 'gemini-1.5-flash'];
    let lastErr = '';

    for (const model of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${key}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Balas dengan kata: OK' }] }],
              generationConfig: { maxOutputTokens: 5 }
            })
          }
        );
        if (res.ok) {
          setStatus('ok');
          setErrMsg(`Terhubung dengan model: ${model}`);
          return;
        }
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.message || `Status ${res.status}`;
        if (res.status === 403 || res.status === 401 || msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
          setStatus('error');
          setErrMsg('API Key tidak valid. Pastikan key dari aistudio.google.com (diawali AIza...)');
          return;
        }
        if (res.status === 429) {
          setStatus('error');
          setErrMsg('Quota API habis. Tunggu 1 menit lalu coba lagi.');
          return;
        }
        lastErr = msg;
        // 404 = model not found, try next
      } catch (e) {
        lastErr = e.message;
      }
    }
    setStatus('error');
    setErrMsg(lastErr || 'Gagal terhubung ke Gemini API');
  };

  const handleSave = () => {
    const key = inputVal.trim();
    onSave(key);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl shadow-indigo-500/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-gradient-to-r from-indigo-950/60 to-slate-900">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
              <Key className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Gemini API Key</h3>
              <p className="text-xs text-slate-400">Diperlukan untuk OCR berbasis AI</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-slate-700/60 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          {/* Instruction */}
          <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/20 text-xs text-slate-300 space-y-1">
            <p className="font-semibold text-indigo-300 flex items-center space-x-1">
              <span>📖</span><span>Cara Mendapatkan API Key Gratis:</span>
            </p>
            <ol className="list-decimal list-inside space-y-1 text-slate-400">
              <li>Buka <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-400 underline hover:text-indigo-300">aistudio.google.com</a></li>
              <li>Login dengan Google Account</li>
              <li>Klik "Get API Key" → "Create API Key"</li>
              <li>Copy key yang muncul dan paste di bawah</li>
            </ol>
            <p className="text-emerald-400 font-medium flex items-center space-x-1 pt-1">
              <span>✅</span><span>Gratis — tidak perlu kartu kredit</span>
            </p>
          </div>

          {/* Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={inputVal}
                onChange={e => { setInputVal(e.target.value); setStatus('idle'); setErrMsg(''); }}
                placeholder="AIzaSy..."
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 pr-10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40 font-mono"
              />
              <button
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Test result */}
          {status === 'ok' && (
            <div className="flex items-center space-x-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 rounded-xl px-3 py-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>API Key valid dan terhubung! Siap digunakan.</span>
            </div>
          )}
          {status === 'error' && (
            <div className="flex items-start space-x-2 text-xs text-red-400 bg-red-950/40 border border-red-500/30 rounded-xl px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{errMsg || 'API Key tidak valid'}</span>
            </div>
          )}

          {/* Note: API key stays in browser only */}
          <p className="text-xs text-slate-500 text-center">
            🔒 API Key disimpan di localStorage browser Anda saja. Tidak dikirim ke server kami.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex items-center space-x-3">
          <button
            onClick={handleTest}
            disabled={status === 'testing' || !inputVal.trim()}
            className="flex-1 py-2.5 rounded-xl border border-slate-600 text-sm font-medium text-slate-300 hover:bg-slate-700/60 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === 'testing' ? 'Testing...' : 'Test Koneksi'}
          </button>
          <button
            onClick={handleSave}
            disabled={!inputVal.trim()}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Simpan & Gunakan
          </button>
        </div>
      </div>
    </div>
  );
}
