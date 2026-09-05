import React, { useState } from 'react';
import { createWorker } from 'tesseract.js';
import Header from './components/Header';
import UploadZone from './components/UploadZone';
import FileList from './components/FileList';
import ResultPanel from './components/ResultPanel';
import { preprocessImageForOCR } from './utils/imageProcessor';
import { convertPdfToImages } from './utils/pdfProcessor';
import { parseKTPText } from './utils/ktpParser';
import { SAMPLE_PARSED_KTP } from './utils/sampleKtp';
import { Sparkles, Zap, FileSpreadsheet, ShieldCheck } from 'lucide-react';

export default function App() {
  const [items, setItems] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isProcessingAny, setIsProcessingAny] = useState(false);

  // Handle file addition
  const handleFilesSelected = (newFiles) => {
    const formatted = newFiles.map(file => ({
      id: Math.random().toString(36).substring(2, 9),
      file: file,
      name: file.name,
      size: file.size,
      type: file.type,
      previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      status: 'pending', // 'pending' | 'processing' | 'done' | 'error'
      progress: 0,
      parsedData: null,
      error: null
    }));

    setItems(prev => {
      const updated = [...prev, ...formatted];
      return updated.slice(0, 10); // Cap at 10 items max
    });

    // Auto select first newly added item if none selected
    if (items.length === 0 && formatted.length > 0) {
      setSelectedIndex(0);
    }
  };

  // Load sample demo KTP
  const handleLoadSample = () => {
    const sampleItem = {
      id: 'demo-sample-ktp',
      file: null,
      name: 'KTP_MIRA_SETIAWAN.png',
      size: 345000,
      type: 'image/png',
      previewUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=400&q=80',
      status: 'done',
      progress: 100,
      parsedData: SAMPLE_PARSED_KTP,
      error: null
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

  // Run OCR scanning on a single item index
  const scanSingleItem = async (index, itemsList = items) => {
    const item = itemsList[index];
    if (!item || item.status === 'done') return;

    // Update status to processing
    setItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], status: 'processing', progress: 10, error: null };
      return copy;
    });

    try {
      let imageSources = [];

      if (item.file) {
        if (item.file.type === 'application/pdf') {
          // Convert PDF page to high DPI image
          imageSources = await convertPdfToImages(item.file);
        } else {
          // Pre-process image for better contrast & grayscale OCR
          const preprocessed = await preprocessImageForOCR(item.file);
          imageSources = [preprocessed];
        }
      } else if (item.previewUrl) {
        imageSources = [item.previewUrl];
      }

      if (imageSources.length === 0) {
        throw new Error('Tidak ada sumber gambar yang valid');
      }

      // Initialize Tesseract worker (Indonesian + English)
      const worker = await createWorker('ind+eng');
      
      // Configure Tesseract parameters for e-KTP card layout
      await worker.setParameters({
        tessedit_pageseg_mode: '3', // Fully automatic page segmentation mode
      });

      let combinedRawText = '';
      for (let i = 0; i < imageSources.length; i++) {
        const result = await worker.recognize(imageSources[i]);
        combinedRawText += result.data.text + '\n';
        
        // Update progress
        const p = Math.round(((i + 1) / imageSources.length) * 90);
        setItems(prev => {
          const copy = [...prev];
          if (copy[index]) copy[index].progress = p;
          return copy;
        });
      }

      await worker.terminate();

      // Parse structured fields
      const parsedData = parseKTPText(combinedRawText);

      // Update item to done
      setItems(prev => {
        const copy = [...prev];
        copy[index] = {
          ...copy[index],
          status: 'done',
          progress: 100,
          parsedData: parsedData
        };
        return copy;
      });

    } catch (err) {
      console.error('Scan error:', err);
      setItems(prev => {
        const copy = [...prev];
        copy[index] = {
          ...copy[index],
          status: 'error',
          progress: 0,
          error: err.message || 'Gagal melakukan OCR'
        };
        return copy;
      });
    }
  };

  // Run OCR scanning on all pending items sequentially
  const handleScanAll = async () => {
    if (items.length === 0 || isProcessingAny) return;
    setIsProcessingAny(true);

    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== 'done') {
        setSelectedIndex(i);
        await scanSingleItem(i, items);
      }
    }

    setIsProcessingAny(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080c14] text-slate-100 font-sans">
      
      {/* Top Navbar */}
      <Header onLoadSample={handleLoadSample} fileCount={items.length} />

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
                Scan e-KTP Batch & Langsung Copy Hasil
              </h2>
              <p className="text-xs text-slate-400">
                Unggah hingga 10 foto/PDF KTP. Data NIK, Nama, Alamat, dll. otomatis terekstraksi ke tabel di panel kanan.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 text-xs text-slate-400">
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

        {/* Split Grid Layout (Left Panel vs Right Panel) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-start">
          
          {/* Left Column: Upload Zone & Queue List (5 cols) */}
          <div className="lg:col-span-5 flex flex-col space-y-4">
            
            {/* Dropzone */}
            <UploadZone
              onFilesSelected={handleFilesSelected}
              currentCount={items.length}
              maxFiles={10}
            />

            {/* Queue File List */}
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

          {/* Right Column: Live Table Review & Copy Panel (7 cols) */}
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
        ScanKTP.ai — Powered by Tesseract OCR Client-Side • Siap Deploy di Vercel
      </footer>

    </div>
  );
}
