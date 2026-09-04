import React, { useState } from 'react';
import { BookMarked, History, Search, Settings, RefreshCw, Feather, BookOpen, Globe } from 'lucide-react';
import { ReaderSettings } from '../types';
import { MANGA_PROVIDERS, MangaProviderKey } from '../services/provider';

interface HeaderProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: ReaderSettings) => void;
  onSearch: (query: string) => void;
  onOpenSettings: () => void;
  onOpenBookmarks: () => void;
  onOpenHistory: () => void;
  onGoHome: () => void;
  currentView: string;
  provider: MangaProviderKey;
  onProviderChange: (provider: MangaProviderKey) => void;
}

export const Header: React.FC<HeaderProps> = ({
  settings,
  onUpdateSettings,
  onSearch,
  onOpenSettings,
  onOpenBookmarks,
  onOpenHistory,
  onGoHome,
  currentView,
  provider,
  onProviderChange,
}) => {
  const [searchInput, setSearchInput] = useState('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      onSearch(searchInput.trim());
    }
  };

  // E-ink flash refresh trigger to clear screen ghosting
  const handleFlashRefresh = () => {
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

  const isEink = settings.eInkMode;

  return (
    <header
      id="app-header"
      className={`w-full ${
        isEink
          ? 'bg-white text-black border-b-4 border-black font-sans'
          : 'bg-stone-900 text-stone-100 border-b-4 border-amber-600 font-sans'
      } px-3 py-3 sticky top-0 z-40`}
    >
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Logo & Title */}
        <button
          id="btn-home-logo"
          onClick={onGoHome}
          className="flex items-center gap-2.5 font-bold text-lg text-left tracking-tight cursor-pointer hover:opacity-80 active:opacity-60"
        >
          <div className={`p-1.5 ${isEink ? 'border-2 border-black bg-black text-white' : 'bg-amber-600 text-white rounded'}`}>
            <Feather size={22} />
          </div>
          <div className="leading-tight">
            <span className="block text-lg font-serif font-black uppercase tracking-tighter">Kindle Manga</span>
            <span className={`block text-[10px] font-sans font-bold uppercase tracking-widest ${isEink ? 'text-black opacity-80' : 'text-stone-400'}`}>
              E-Ink Optimized • Voyage
            </span>
          </div>
        </button>

        {/* Search Bar & Direct URL Paste */}
        <form onSubmit={handleSearchSubmit} className="flex-1 max-w-md min-w-[200px] flex items-center gap-1.5">
          <div className="relative w-full">
            <input
              id="search-manga-input"
              type="text"
              placeholder="Search manga title or paste a supported URL / ID..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className={`w-full py-1.5 pl-8 pr-3 text-xs font-sans font-bold ${
                isEink
                  ? 'bg-white text-black border-2 border-black placeholder-stone-600 focus:outline-none focus:bg-stone-50'
                  : 'bg-stone-800 text-stone-100 border border-stone-700 rounded placeholder-stone-400 focus:outline-none focus:border-amber-500'
              }`}
            />
            <Search className="absolute left-2.5 top-2.5 text-stone-600" size={14} />
          </div>
          <button
            type="submit"
            id="btn-search-submit"
            className={`px-3.5 py-1.5 text-xs font-sans font-black uppercase cursor-pointer whitespace-nowrap ${
              isEink
                ? 'bg-black text-white border-2 border-black active:bg-white active:text-black'
                : 'bg-amber-600 hover:bg-amber-500 text-white rounded'
            }`}
          >
            Search
          </button>
        </form>

        <label className={`flex items-center gap-1.5 px-2 py-1 text-[11px] font-black uppercase ${isEink ? 'border-2 border-black bg-white text-black' : 'border border-stone-700 bg-stone-800 text-stone-200'}`}>
          <Globe size={14} />
          <span className="hidden sm:inline">Source</span>
          <select
            id="manga-provider-select"
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as MangaProviderKey)}
            className={`font-black uppercase cursor-pointer ${isEink ? 'bg-white text-black' : 'bg-stone-800 text-stone-100'}`}
          >
            {MANGA_PROVIDERS.map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
        </label>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 text-xs font-sans">
          {/* Refresh Screen for E-ink */}
          <button
            id="btn-flash-refresh"
            onClick={handleFlashRefresh}
            title="Flash Screen (Clear E-Ink Ghosting)"
            className={`p-1.5 px-2.5 flex items-center gap-1.5 font-black uppercase cursor-pointer ${
              isEink
                ? 'bg-white text-black border-2 border-black hover:bg-black hover:text-white'
                : 'bg-stone-800 hover:bg-stone-700 text-stone-200 rounded border border-stone-700'
            }`}
          >
            <RefreshCw size={14} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {/* Bookmarks */}
          <button
            id="btn-bookmarks-view"
            onClick={onOpenBookmarks}
            className={`p-1.5 px-2.5 flex items-center gap-1.5 font-black uppercase cursor-pointer ${
              currentView === 'bookmarks'
                ? isEink
                  ? 'bg-black text-white border-2 border-black'
                  : 'bg-amber-600 text-white rounded'
                : isEink
                ? 'bg-white text-black border-2 border-black hover:bg-black hover:text-white'
                : 'bg-stone-800 hover:bg-stone-700 text-stone-200 rounded border border-stone-700'
            }`}
          >
            <BookMarked size={14} />
            <span className="hidden sm:inline">Saved</span>
          </button>

          {/* History */}
          <button
            id="btn-history-view"
            onClick={onOpenHistory}
            className={`p-1.5 px-2.5 flex items-center gap-1.5 font-black uppercase cursor-pointer ${
              currentView === 'history'
                ? isEink
                  ? 'bg-black text-white border-2 border-black'
                  : 'bg-amber-600 text-white rounded'
                : isEink
                ? 'bg-white text-black border-2 border-black hover:bg-black hover:text-white'
                : 'bg-stone-800 hover:bg-stone-700 text-stone-200 rounded border border-stone-700'
            }`}
          >
            <History size={14} />
            <span className="hidden sm:inline">History</span>
          </button>

          {/* Kindle / Settings */}
          <button
            id="btn-open-settings"
            onClick={onOpenSettings}
            className={`p-1.5 px-2.5 flex items-center gap-1.5 font-black uppercase cursor-pointer ${
              isEink
                ? 'bg-black text-white border-2 border-black'
                : 'bg-stone-800 hover:bg-stone-700 text-stone-200 rounded border border-stone-700'
            }`}
          >
            <Settings size={14} />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </header>
  );
};
