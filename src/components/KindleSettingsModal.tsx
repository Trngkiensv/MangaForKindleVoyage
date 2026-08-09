import React from 'react';
import { ReaderSettings } from '../types';
import { Feather, RefreshCw, X } from 'lucide-react';

interface KindleSettingsModalProps {
  settings: ReaderSettings;
  onSave: (settings: ReaderSettings) => void;
  onClose: () => void;
}

export const KindleSettingsModal: React.FC<KindleSettingsModalProps> = ({
  settings,
  onSave,
  onClose,
}) => {
  const isEink = settings.eInkMode;

  const handleChange = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
    onSave({ ...settings, [key]: value });
  };


  const handleFlash = () => {
    const flashEl = document.createElement('div');
    flashEl.style.position = 'fixed';
    flashEl.style.top = '0';
    flashEl.style.left = '0';
    flashEl.style.width = '100vw';
    flashEl.style.height = '100vh';
    flashEl.style.backgroundColor = '#000000';
    flashEl.style.zIndex = '99999';
    document.body.appendChild(flashEl);

    setTimeout(() => {
      flashEl.style.backgroundColor = '#ffffff';
      setTimeout(() => {
        if (document.body.contains(flashEl)) {
          document.body.removeChild(flashEl);
        }
      }, 150);
    }, 150);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-xs">
      <div
        className={`w-full max-w-lg p-5 sm:p-6 max-h-[90vh] overflow-y-auto ${
          isEink
            ? 'bg-white text-black border-4 border-black font-sans'
            : 'bg-stone-900 text-stone-100 border-2 border-stone-800 rounded-none shadow-2xl'
        }`}
      >
        <div className="flex items-center justify-between pb-3 mb-4 border-b-4 border-black dark:border-stone-800">
          <div className="flex items-center gap-2">
            <Feather size={20} className={isEink ? 'text-black' : 'text-amber-500'} />
            <h2 className="text-base sm:text-lg font-serif font-black uppercase tracking-tight">
              Kindle & E-Ink Settings
            </h2>
          </div>
          <button
            onClick={onClose}
            className={`p-1 cursor-pointer font-black ${
              isEink ? 'border-2 border-black bg-white text-black hover:bg-black hover:text-white' : 'text-stone-400 hover:text-stone-100'
            }`}
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 text-xs font-sans font-bold">
          {/* E-Ink High Contrast Mode */}
          <div className={`p-3 ${isEink ? 'border-2 border-black bg-stone-100' : 'bg-stone-800'}`}>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="block text-sm font-black uppercase">E-Ink High Contrast Mode</span>
                <span className={`block text-[11px] font-bold ${isEink ? 'text-black opacity-80' : 'text-stone-400'}`}>
                  Pure black & white theme, 0ms transitions, thick solid borders for Kindle Voyage E-ink screen.
                </span>
              </div>
              <input
                type="checkbox"
                checked={settings.eInkMode}
                onChange={(e) => handleChange('eInkMode', e.target.checked)}
                className="w-5 h-5 accent-black cursor-pointer"
              />
            </label>
          </div>

          {/* Data Saver Mode */}
          <div className={`p-3 ${isEink ? 'border-2 border-black bg-stone-100' : 'bg-stone-800'}`}>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <span className="block text-sm font-black uppercase">Data Saver (Compressed Images)</span>
                <span className={`block text-[11px] font-bold ${isEink ? 'text-black opacity-80' : 'text-stone-400'}`}>
                  Uses MangaDex dataSaver images (significantly smaller size, ideal for Kindle Wi-Fi).
                </span>
              </div>
              <input
                type="checkbox"
                checked={settings.dataSaver}
                onChange={(e) => handleChange('dataSaver', e.target.checked)}
                className="w-5 h-5 accent-black cursor-pointer"
              />
            </label>
          </div>

          {/* Contrast Filter */}
          <div>
            <label className="block mb-1 font-black uppercase text-[11px]">
              Image Contrast Filter (For E-Ink Displays)
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'normal', label: 'NORMAL' },
                { id: 'high', label: 'HIGH CONTRAST (+25%)' },
                { id: 'ultra', label: 'ULTRA CONTRAST (+50%)' },
                { id: 'invert', label: 'INVERT COLORS (NIGHT)' },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleChange('contrastFilter', opt.id as any)}
                  className={`p-2 text-left font-black text-xs uppercase cursor-pointer ${
                    settings.contrastFilter === opt.id
                      ? isEink
                        ? 'border-2 border-black bg-black text-white'
                        : 'bg-amber-600 text-white border-2 border-amber-600'
                      : isEink
                      ? 'border-2 border-black bg-white text-black'
                      : 'bg-stone-800 text-stone-300 border border-stone-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reading Direction */}
          <div>
            <label className="block mb-1 font-black uppercase text-[11px]">Reading Direction</label>
            <div className="flex gap-2">
              <button
                onClick={() => handleChange('readingDirection', 'rtl')}
                className={`flex-1 py-2 font-black text-xs uppercase cursor-pointer ${
                  settings.readingDirection === 'rtl'
                    ? isEink
                      ? 'border-2 border-black bg-black text-white'
                      : 'bg-amber-600 text-white'
                    : isEink
                    ? 'border-2 border-black bg-white text-black'
                    : 'bg-stone-800 text-stone-300'
                }`}
              >
                Right-to-Left (Manga)
              </button>
              <button
                onClick={() => handleChange('readingDirection', 'ltr')}
                className={`flex-1 py-2 font-black text-xs uppercase cursor-pointer ${
                  settings.readingDirection === 'ltr'
                    ? isEink
                      ? 'border-2 border-black bg-black text-white'
                      : 'bg-amber-600 text-white'
                    : isEink
                    ? 'border-2 border-black bg-white text-black'
                    : 'bg-stone-800 text-stone-300'
                }`}
              >
                Left-to-Right (Webtoon)
              </button>
            </div>
          </div>

          {/* Screen Refresh Flash Button */}
          <div className="pt-2">
            <button
              onClick={handleFlash}
              className={`w-full py-2.5 font-black text-xs uppercase cursor-pointer flex items-center justify-center gap-2 ${
                isEink
                  ? 'border-2 border-black bg-white text-black hover:bg-black hover:text-white'
                  : 'bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700'
              }`}
            >
              <RefreshCw size={16} />
              <span>Test Screen Flash (Clear E-Ink Ghosting)</span>
            </button>
          </div>
        </div>

        <div className="mt-6 pt-3 border-t-2 border-black dark:border-stone-800 flex justify-end">
          <button
            onClick={onClose}
            className={`px-6 py-2.5 font-black text-xs uppercase cursor-pointer ${
              isEink
                ? 'bg-black text-white border-2 border-black hover:bg-white hover:text-black'
                : 'bg-amber-600 hover:bg-amber-500 text-white'
            }`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
