import React, { useRef, useState } from 'react';
import { UploadCloud, FileImage, FileText, AlertCircle, Plus } from 'lucide-react';

export default function UploadZone({ onFilesSelected, currentCount, maxFiles = 10 }) {
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(Array.from(e.target.files));
    }
  };

  const processFiles = (newFiles) => {
    setErrorMsg('');

    // Filter accepted types
    const validFiles = newFiles.filter(file => {
      const type = file.type;
      const isImage = type.startsWith('image/');
      const isPdf = type === 'application/pdf';
      return isImage || isPdf;
    });

    if (validFiles.length === 0) {
      setErrorMsg('Format file tidak didukung! Gunakan gambar (JPG, PNG, WEBP) atau PDF.');
      return;
    }

    if (currentCount + validFiles.length > maxFiles) {
      setErrorMsg(`Batas maksimal adalah ${maxFiles} file foto/PDF. Hanya ${maxFiles - currentCount} file pertama yang dimasukkan.`);
    }

    const filesToAdd = validFiles.slice(0, maxFiles - currentCount);
    if (filesToAdd.length > 0) {
      onFilesSelected(filesToAdd);
    }
  };

  return (
    <div className="w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative group cursor-pointer rounded-2xl p-6 transition-all duration-300 flex flex-col items-center justify-center text-center border-2 border-dashed ${
          isDragging
            ? 'border-indigo-400 bg-indigo-500/10 shadow-glow-brand scale-[1.01]'
            : 'border-slate-700/80 hover:border-indigo-500/60 bg-slate-900/40 hover:bg-slate-900/70'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInputChange}
          multiple
          accept="image/*,application/pdf"
          className="hidden"
        />

        {/* Icon Header */}
        <div className="w-14 h-14 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-3 group-hover:scale-110 group-hover:bg-indigo-600/20 transition-transform">
          <UploadCloud className="w-7 h-7 text-indigo-400" />
        </div>

        <h3 className="text-sm font-semibold text-slate-200 mb-1">
          Upload Foto KTP atau Dokumen PDF
        </h3>
        <p className="text-xs text-slate-400 max-w-xs mb-3">
          Tarik & lepas file di sini, atau klik untuk memilih file dari komputer Anda (Maks. 10 file)
        </p>

        {/* Format Badges */}
        <div className="flex flex-wrap justify-center gap-2 text-[11px] font-medium text-slate-400">
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
            <FileImage className="w-3 h-3 mr-1 text-cyan-400" /> JPG, PNG, WEBP
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800 border border-slate-700">
            <FileText className="w-3 h-3 mr-1 text-rose-400" /> PDF Document
          </span>
        </div>
      </div>

      {errorMsg && (
        <div className="mt-2.5 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}
