import React from 'react';
import { Play, Trash2, CheckCircle2, Loader2, AlertCircle, FileText, Image as ImageIcon } from 'lucide-react';

export default function FileList({
  items,
  onRemoveItem,
  onClearAll,
  onScanItem,
  onScanAll,
  isProcessingAny,
  selectedIndex,
  onSelectIndex
}) {
  if (!items || items.length === 0) return null;

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Top Header Actions */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Daftar Antrean File ({items.length})
          </span>
        </div>
        
        <button
          onClick={onClearAll}
          disabled={isProcessingAny}
          className="text-xs text-slate-400 hover:text-rose-400 flex items-center space-x-1 transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Reset All</span>
        </button>
      </div>

      {/* Main Scan All Action Button */}
      <button
        onClick={onScanAll}
        disabled={isProcessingAny}
        className="w-full py-3 px-4 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 shadow-glow-brand hover:shadow-glow-cyan active:scale-[0.99] transition-all flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isProcessingAny ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-white" />
            <span>Sedang Memindai KTP...</span>
          </>
        ) : (
          <>
            <Play className="w-4 h-4 fill-current text-white" />
            <span>Mulai Scan Semua Foto ({items.length})</span>
          </>
        )}
      </button>

      {/* Queue List Cards */}
      <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
        {items.map((item, index) => {
          const isSelected = selectedIndex === index;
          const isDone = item.status === 'done';
          const isProcessing = item.status === 'processing';
          const isError = item.status === 'error';

          return (
            <div
              key={item.id}
              onClick={() => onSelectIndex(index)}
              className={`group p-3 rounded-xl border transition-all cursor-pointer flex items-center space-x-3 ${
                isSelected
                  ? 'bg-indigo-600/15 border-indigo-500/60 shadow-lg shadow-indigo-500/10'
                  : 'bg-slate-900/50 border-slate-800/80 hover:bg-slate-900/80 hover:border-slate-700'
              }`}
            >
              {/* Thumbnail / Icon */}
              <div className="w-12 h-12 rounded-lg bg-slate-950 border border-slate-800 flex-shrink-0 overflow-hidden flex items-center justify-center relative">
                {item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <FileText className="w-6 h-6 text-rose-400" />
                )}
                {isDone && (
                  <div className="absolute inset-0 bg-emerald-950/60 flex items-center justify-center backdrop-blur-[1px]">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  </div>
                )}
              </div>

              {/* File Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-xs font-semibold text-slate-200 truncate pr-2">
                    #{index + 1}. {item.name}
                  </h4>
                  <span className="text-[10px] text-slate-500 font-mono flex-shrink-0">
                    {(item.size / 1024).toFixed(0)} KB
                  </span>
                </div>

                {/* Status Indicator / Progress */}
                <div className="flex items-center justify-between text-[11px]">
                  {isProcessing && (
                    <div className="flex items-center space-x-1.5 text-cyan-400 font-medium w-full pr-2">
                      <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-cyan-400 h-full transition-all duration-300"
                          style={{ width: `${item.progress || 10}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono">{item.progress || 0}%</span>
                    </div>
                  )}

                  {isDone && (
                    <span className="text-emerald-400 text-[11px] font-medium flex items-center">
                      <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-400" />
                      Scan Selesai (NIK Verified)
                    </span>
                  )}

                  {isError && (
                    <span className="text-rose-400 text-[11px] font-medium flex items-center">
                      <AlertCircle className="w-3 h-3 mr-1" />
                      {item.error || 'Gagal Scan'}
                    </span>
                  )}

                  {item.status === 'pending' && (
                    <span className="text-slate-400 text-[11px]">
                      Siap dipindai
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center space-x-1 opacity-80 group-hover:opacity-100">
                {item.status === 'pending' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onScanItem(index);
                    }}
                    disabled={isProcessingAny}
                    title="Scan KTP ini"
                    className="p-1.5 rounded-lg bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600 hover:text-white transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                )}

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveItem(index);
                  }}
                  disabled={isProcessingAny}
                  title="Hapus dari antrean"
                  className="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
