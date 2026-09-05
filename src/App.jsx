import React, { useState, useEffect } from 'react';
import { createWorker } from 'tesseract.js';
import Header from './components/Header';
import UploadZone from './components/UploadZone';
import FileList from './components/FileList';
import ResultPanel from './components/ResultPanel';
import ApiKeyModal from './components/ApiKeyModal';
import { preprocessImageForOCR } from './utils/imageProcessor';
import { convertPdfToImages } from './utils/pdfProcessor';
import { parseKTPText } from './utils/ktpParser';
import { scanKTPWithGemini } from './utils/geminiOCR';
import { SAMPLE_PARSED_KTP } from './utils/sampleKtp';
import { Sparkles, Zap, FileSpreadsheet, ShieldCheck, Key } from 'lucide-react';

const STORAGE_KEY = 'scanktp_gemini_api_key';
// Default key from Vercel environment variable (set in Vercel dashboard, never committed to git)
const ENV_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

export default function App() {
  const [items, setItems] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isProcessingAny, setIsProcessingAny] = useState(false);
  // Priority: localStorage (user override) → env variable (Vercel default)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE_KEY) || ENV_API_KEY);
  const [showApiModal, setShowApiModal] = useState(false);

  // Persist API key to localStorage
  const handleSaveApiKey = (key) => {
    setApiKey(key);
    if (key) {
      localStorage.setItem(STORAGE_KEY, key);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  // Handle file addition
  const handleFilesSelected = (newFiles) => {
    const formatted = newFiles.map(file => ({
      id: Math.random().toString(36).substring(2, 9),
      file: file,
      name: file.name,
      size: file.size,
      type: file.type,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      status: 'pending',
      progress: 0,
      parsedData: null,
      error: null,
      engine: null // 'gemini' | 'tesseract'
    }));

    setItems(prev => {
      const updated = [...prev, ...formatted];
      return updated.slice(0, 10);
    });

    if (items.length === 0 && formatted.length > 0) {
      setSelectedIndex(0);
    }
  };

  // Load sample demo KTP
  const handleLoadSample = () => {
    const sampleItem = {
      id: 'demo-sample-ktp',
      file: null,
      name: 'KTP_DEMO.png',
      size: 345000,
      type: 'image/png',
      previewUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80',
      status: 'done',
      progress: 100,
      parsedData: SAMPLE_PARSED_KTP,
      error: null,
      engine: 'demo'
    };

    setItems([sampleItem]);
    setSelectedIndex(0);
  };

  // Remove individual item
  const handleRemoveItem = (index) => {
    setItems(prev => prev.filter((_, idx) => idx !== index));
    if (selectedIndex >= index && selectedIndex > 0) {
      setSelectedIndex(prev => prev - 1);
    }
  };

  // Clear all queue items
  const handleClearAll = () => {
    setItems([]);
    setSelectedIndex(0);
  };

  // Update parsed KTP data from right panel table edits
  const handleUpdateKTPData = (index, newData) => {
    setItems(prev => {
      const copy = [...prev];
      if (copy[index]) {
        copy[index] = { ...copy[index], parsedData: newData };
      }
      return copy;
    });
  };

  const updateItemStatus = (index, updates) => {
    setItems(prev => {
      const copy = [...prev];
      if (copy[index]) {
        copy[index] = { ...copy[index], ...updates };
      }
      return copy;
    });
  };

  // Run OCR scanning on a single item
  const scanSingleItem = async (index, itemsList = null) => {
    const currentItems = itemsList || items;
    const item = currentItems[index];
    if (!item || item.status === 'done') return;

    updateItemStatus(index, { status: 'processing', progress: 5, error: null });

    try {
      // === STRATEGY 1: Use Gemini Vision API (if API key available) ===
      if (apiKey && apiKey.trim()) {
        try {
          updateItemStatus(index, { progress: 20 });

          let imageSource;
          if (item.file) {
            if (item.file.type === 'application/pdf') {
              // For PDF: convert first page to image
              const pages = await convertPdfToImages(item.file);
              if (pages.length === 0) throw new Error('PDF kosong');
              imageSource = pages[0]; // Use first page as data URL
            } else {
              imageSource = item.file;
            }
          } else if (item.previewUrl) {
            imageSource = item.previewUrl;
          } else {
            throw new Error('Tidak ada sumber gambar');
          }

          updateItemStatus(index, { progress: 40 });

          const parsedData = await scanKTPWithGemini(imageSource, apiKey);

          updateItemStatus(index, {
            status: 'done',
            progress: 100,
            parsedData,
            engine: 'gemini'
          });
          return;

        } catch (geminiErr) {
          if (geminiErr.message === 'API_KEY_INVALID') {
            // Invalid key, prompt user to update
            updateItemStatus(index, {
              status: 'error',
              progress: 0,
              error: 'API Key Gemini tidak valid. Klik "Set API Key" untuk memperbarui.',
              engine: null
            });
            return;
          }
          // Other Gemini errors → fallback to Tesseract
          console.warn('Gemini failed, falling back to Tesseract:', geminiErr.message);
          updateItemStatus(index, { progress: 30 });
        }
      }

      // === STRATEGY 2: Tesseract OCR (fallback / no API key) ===
      updateItemStatus(index, { progress: 35 });

      let imageSources = [];
      if (item.file) {
        if (item.file.type === 'application/pdf') {
          imageSources = await convertPdfToImages(item.file);
        } else {
          const preprocessed = await preprocessImageForOCR(item.file);
          imageSources = [preprocessed];
        }
      } else if (item.previewUrl) {
        imageSources = [item.previewUrl];
      }

      if (imageSources.length === 0) throw new Error('Tidak ada sumber gambar yang valid');

      const worker = await createWorker('ind+eng');
      await worker.setParameters({
        tessedit_pageseg_mode: '6', // Assume single uniform block of text
      });

      let combinedRawText = '';
      for (let i = 0; i < imageSources.length; i++) {
        const result = await worker.recognize(imageSources[i]);
        combinedRawText += result.data.text + '\n';
        const p = 35 + Math.round(((i + 1) / imageSources.length) * 55);
        updateItemStatus(index, { progress: p });
      }

      await worker.terminate();

      const parsedData = parseKTPText(combinedRawText);

      updateItemStatus(index, {
        status: 'done',
        progress: 100,
        parsedData,
        engine: 'tesseract'
      });

    } catch (err) {
      console.error('Scan error:', err);
      updateItemStatus(index, {
        status: 'error',
        progress: 0,
        error: err.message || 'Gagal melakukan scan',
        engine: null
      });
    }
  };

  // Run OCR on all pending items
  const handleScanAll = async () => {
    if (items.length === 0 || isProcessingAny) return;
    setIsProcessingAny(true);

    // If no API key, prompt user
    if (!apiKey || !apiKey.trim()) {
      setShowApiModal(true);
      setIsProcessingAny(false);
      return;
    }

    // Get current snapshot of items to process
    const snapshot = [...items];
    for (let i = 0; i < snapshot.length; i++) {
      if (snapshot[i].status !== 'done') {
        setSelectedIndex(i);
        await scanSingleItem(i);
      }
    }

    setIsProcessingAny(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080c14] text-slate-100 font-sans">
      
      {/* Top Navbar */}
      <Header
        onLoadSample={handleLoadSample}
        fileCount={items.length}
        hasApiKey={!!(apiKey && apiKey.trim())}
        onOpenApiKey={() => setShowApiModal(true)}
      />

      {/* API Key Modal */}
      {showApiModal && (
        <ApiKeyModal
          apiKey={apiKey}
          onSave={handleSaveApiKey}
          onClose={() => setShowApiModal(false)}
        />
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col">
        
        {/* Subheader Banner */}
        <div className="mb-6 p-4 rounded-2xl glass-panel border border-indigo-500/20 bg-gradient-to-r from-indigo-950/40 via-slate-900/60 to-cyan-950/40 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 flex items-center justify-center flex-shrink-0">
              <Zap className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center">
                Scan e-KTP dengan Gemini AI Vision
              </h2>
              <p className="text-xs text-slate-400">
                {apiKey
                  ? 'Gemini AI aktif — akurasi maksimal. Unggah foto KTP dan scan otomatis.'
                  : 'Klik "Set API Key" di atas untuk mengaktifkan AI Vision. Gratis di aistudio.google.com'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs text-slate-400">
            {!apiKey && (
              <button
                onClick={() => setShowApiModal(true)}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 font-semibold transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                <span>Set API Key Sekarang</span>
              </button>
            )}
            <span className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800">
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              <span>Format Tabel Rapi</span>
            </span>
            <span className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              <span>Privasi Terjaga</span>
            </span>
          </div>
        </div>

        {/* Split Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-start">
          
          {/* Left Column */}
          <div className="lg:col-span-5 flex flex-col space-y-4">
            <UploadZone
              onFilesSelected={handleFilesSelected}
              currentCount={items.length}
              maxFiles={10}
            />

            <FileList
              items={items}
              onRemoveItem={handleRemoveItem}
              onClearAll={handleClearAll}
              onScanItem={(idx) => scanSingleItem(idx)}
              onScanAll={handleScanAll}
              isProcessingAny={isProcessingAny}
              selectedIndex={selectedIndex}
              onSelectIndex={setSelectedIndex}
            />
          </div>

          {/* Right Column */}
          <div className="lg:col-span-7 h-full min-h-[500px]">
            <ResultPanel
              items={items}
              selectedIndex={selectedIndex}
              onSelectIndex={setSelectedIndex}
              onUpdateKTPData={handleUpdateKTPData}
            />
          </div>
        </div>

      </main>

      {/* Footer */}
      <footer className="py-4 border-t border-slate-800/80 text-center text-xs text-slate-500">
        ScanKTP.ai — Powered by Gemini Vision AI + Tesseract OCR • Client-Side • Siap Deploy di Vercel
      </footer>

    </div>
  );
}
