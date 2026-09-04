import React, { useEffect, useRef, useState } from 'react';
import { Chapter, ChapterPagesResponse, Manga, ReaderSettings } from '../types';
import { formatChapterName, getActiveProvider, getChapterById, getChapterPages, getMangaById, proxyImageUrl } from '../services/provider';
import { saveHistoryItem } from '../services/storage';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  ZoomIn,
  ZoomOut,
  Sliders,
  Menu,
} from 'lucide-react';

interface MangaReaderProps {
  chapterId: string;
  chapterList: Chapter[];
  settings: ReaderSettings;
  onUpdateSettings: (settings: ReaderSettings) => void;
  onBackToManga: (mangaId?: string) => void;
  onSelectChapter: (newChapterId: string, chapterList: Chapter[]) => void;
}

export const MangaReader: React.FC<MangaReaderProps> = ({
  chapterId,
  chapterList,
  settings,
  onUpdateSettings,
  onBackToManga,
  onSelectChapter,
}) => {
  const isEink = settings.eInkMode;

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [pagesData, setPagesData] = useState<ChapterPagesResponse | null>(null);
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null);
  const [manga, setManga] = useState<Manga | null>(null);

  // Reader UI State
  const [hideToolbar, setHideToolbar] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [showChapterMenu, setShowChapterMenu] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Find index of current chapter in list
  const currentChapterIndex = chapterList.findIndex((ch) => ch.id === chapterId);
  const prevChapter = currentChapterIndex > 0 ? chapterList[currentChapterIndex - 1] : null;
  const nextChapter = currentChapterIndex < chapterList.length - 1 ? chapterList[currentChapterIndex + 1] : null;

  // Load Chapter & Pages
  useEffect(() => {
    loadChapterAndPages();
  }, [chapterId]);

  const loadChapterAndPages = async () => {
    setLoading(true);
    setError(null);
    try {
      // Find chapter metadata from list or fetch directly
      let ch = chapterList.find((c) => c.id === chapterId);
      if (!ch) {
        ch = await getChapterById(chapterId);
      }
      setCurrentChapter(ch);

      // Fetch chapter pages from the active provider
      const pagesRes = await getChapterPages(chapterId);
      setPagesData(pagesRes);

      // Fetch manga info if missing
      const mangaRel = ch?.relationships?.find((r) => r.type === 'manga');
      if (mangaRel?.id) {
        getMangaById(mangaRel.id)
          .then((m) => setManga(m))
          .catch(() => {});
      }

      setPageIndex(0);
    } catch (err: any) {
      setError(err.message || 'Failed to load chapter pages');
    } finally {
      setLoading(false);
    }
  };

  // Get current page image URLs from the provider-neutral response.
  const getImageUrls = (): string[] => {
    if (!pagesData) return [];
    const source = settings.dataSaver && pagesData.dataSaverPages.length
      ? pagesData.dataSaverPages
      : pagesData.pages;
    return source.map((url) => proxyImageUrl(url));
  };

  const imageUrls = getImageUrls();
  const totalPages = imageUrls.length;
  const currentImageUrl = imageUrls[pageIndex] || null;

  // Preload next images
  useEffect(() => {
    if (imageUrls.length === 0) return;
    const requestedPreload = settings.preloadPages || 2;
    const pagesToPreload = isEink ? Math.min(requestedPreload, 1) : requestedPreload;
    for (let i = 1; i <= pagesToPreload; i++) {
      const nextIdx = pageIndex + i;
      if (nextIdx < imageUrls.length) {
        const img = new Image();
        img.src = imageUrls[nextIdx];
      }
    }
  }, [pageIndex, imageUrls]);

  // Save history on page change
  useEffect(() => {
    if (totalPages > 0 && currentChapter) {
      const mangaRel = currentChapter.relationships?.find((r) => r.type === 'manga');
      const mangaId = mangaRel?.id || manga?.id || 'unknown';
      const chNum = currentChapter.attributes?.chapter || currentChapter.attributes?.volume || '1';

      saveHistoryItem({
        provider: getActiveProvider(),
        mangaId,
        mangaTitle: manga?.attributes?.title?.en || manga?.attributes?.title?.vi || 'Manga',
        coverUrl: null,
        chapterId: currentChapter.id,
        chapterNumber: chNum,
        chapterTitle: currentChapter.attributes?.chapter
          ? currentChapter.attributes?.title || undefined
          : currentChapter.attributes?.volume
            ? 'Volume'
            : currentChapter.attributes?.title || undefined,
        pageIndex,
        totalPages,
      });
    }
  }, [pageIndex, totalPages, currentChapter, manga]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === ' ') {
        e.preventDefault();
        if (settings.readingDirection === 'rtl') {
          handlePrevPage();
        } else {
          handleNextPage();
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        e.preventDefault();
        if (settings.readingDirection === 'rtl') {
          handleNextPage();
        } else {
          handlePrevPage();
        }
      } else if (e.key === 'f') {
        setHideToolbar((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pageIndex, totalPages, settings.readingDirection]);

  // Page Navigation Handlers
  const handleNextPage = () => {
    if (pageIndex < totalPages - 1) {
      setPageIndex((prev) => prev + 1);
      window.scrollTo(0, 0);
    } else if (nextChapter) {
      // Go to next chapter
      onSelectChapter(nextChapter.id, chapterList);
    }
  };

  const handlePrevPage = () => {
    if (pageIndex > 0) {
      setPageIndex((prev) => prev - 1);
      window.scrollTo(0, 0);
    } else if (prevChapter) {
      // Go to prev chapter
      onSelectChapter(prevChapter.id, chapterList);
    }
  };

  // Screen Tap Zone Handler for Kindle Touchscreen
  const handleScreenTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const ratio = x / width;

    // Middle 30% tap toggles toolbar
    if (ratio >= 0.35 && ratio <= 0.65) {
      setHideToolbar((prev) => !prev);
      return;
    }

    // Tap sides based on reading direction
    if (ratio < 0.35) {
      if (settings.readingDirection === 'rtl') {
        handleNextPage();
      } else {
        handlePrevPage();
      }
    } else {
      if (settings.readingDirection === 'rtl') {
        handlePrevPage();
      } else {
        handleNextPage();
      }
    }
  };

  // E-Ink flash refresh
  const triggerFlash = () => {
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

  // Image Filter Class according to settings
  const getFilterStyle = (): string => {
    let classes = '';
    if (settings.grayscaleImages || isEink) {
      classes += 'grayscale ';
    }
    switch (settings.contrastFilter) {
      case 'high':
        classes += 'contrast-125 ';
        break;
      case 'ultra':
        classes += 'contrast-150 brightness-90 ';
        break;
      case 'invert':
        classes += 'invert hue-rotate-180 ';
        break;
      default:
        break;
    }
    return classes.trim();
  };

  // Image Sizing Class
  const getImageSizingClass = (): string => {
    switch (settings.imageFit) {
      case 'width':
        return 'w-full h-auto max-w-4xl mx-auto';
      case 'height':
        return 'h-[calc(100vh-80px)] w-auto max-w-full mx-auto object-contain';
      case 'screen':
        return 'max-h-[calc(100vh-70px)] max-w-full object-contain mx-auto';
      case 'original':
        return 'w-auto h-auto max-w-none mx-auto';
      default:
        return 'w-full h-auto max-w-4xl mx-auto';
    }
  };

  return (
    <div
      ref={containerRef}
      className={`min-h-screen flex flex-col justify-between select-none ${
        isEink ? 'bg-white text-black font-sans' : 'bg-stone-950 text-stone-100'
      }`}
    >
      {/* Top Floating Control Bar */}
      {!hideToolbar && (
        <div
          id="reader-top-bar"
          className={`sticky top-0 z-50 px-3 py-3 flex items-center justify-between gap-2 ${
            isEink
              ? 'bg-white text-black border-b-4 border-black font-sans'
              : 'bg-stone-900/90 text-stone-100 border-b-4 border-amber-600 backdrop-blur font-sans'
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              id="btn-reader-back"
              onClick={() => {
                const mangaRel = currentChapter?.relationships?.find((r) => r.type === 'manga');
                onBackToManga(mangaRel?.id || manga?.id);
              }}
              className={`p-1.5 px-3 font-black text-xs uppercase flex items-center gap-1 cursor-pointer ${
                isEink ? 'border-2 border-black bg-white text-black hover:bg-black hover:text-white' : 'bg-stone-800 text-stone-200 rounded-none'
              }`}
            >
              <ArrowLeft size={16} />
              <span className="hidden sm:inline">Exit</span>
            </button>

            {/* Chapter Info */}
            <div className="leading-tight">
              <span className="block text-xs sm:text-sm font-serif font-black uppercase truncate max-w-[200px] sm:max-w-xs">
                {currentChapter ? formatChapterName(currentChapter) : 'Loading...'}
              </span>
              <span className={`block text-[10px] font-sans font-bold uppercase ${isEink ? 'text-black' : 'text-stone-400'}`}>
                Page {pageIndex + 1} of {totalPages || 1}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-sans">
            {/* E-ink Flash */}
            <button
              onClick={triggerFlash}
              title="Flash Screen (Clear Ghosting)"
              className={`p-1.5 font-black uppercase cursor-pointer ${
                isEink ? 'border-2 border-black bg-white text-black hover:bg-black hover:text-white' : 'bg-stone-800 text-stone-200 rounded-none'
              }`}
            >
              <RefreshCw size={14} />
            </button>

            {/* Quality Mode Toggle */}
            <button
              onClick={() => onUpdateSettings({ ...settings, dataSaver: !settings.dataSaver })}
              className={`px-2 py-1 text-[10px] font-black cursor-pointer uppercase ${
                settings.dataSaver
                  ? isEink
                    ? 'border-2 border-black bg-black text-white'
                    : 'bg-emerald-700 text-white rounded-none'
                  : isEink
                  ? 'border-2 border-black bg-white text-black'
                  : 'bg-stone-800 text-stone-300 rounded-none'
              }`}
            >
              {settings.dataSaver ? 'Data Saver' : 'HQ'}
            </button>

            {/* Fit mode selector */}
            <select
              value={settings.imageFit}
              onChange={(e) => onUpdateSettings({ ...settings, imageFit: e.target.value as any })}
              className={`px-1.5 py-1 text-[11px] font-black uppercase cursor-pointer ${
                isEink ? 'border-2 border-black bg-white text-black' : 'bg-stone-800 text-stone-200 rounded-none'
              }`}
            >
              <option value="width">Fit Width</option>
              <option value="height">Fit Height</option>
              <option value="screen">Fit Screen</option>
            </select>

            {/* Hide Bar Button */}
            <button
              onClick={() => setHideToolbar(true)}
              className={`p-1.5 font-black uppercase cursor-pointer ${
                isEink ? 'border-2 border-black bg-white text-black hover:bg-black hover:text-white' : 'bg-stone-800 text-stone-200 rounded-none'
              }`}
              title="Hide UI (Tap screen center to reveal)"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Main Image View Container */}
      <div
        id="manga-image-container"
        onClick={handleScreenTap}
        className="flex-1 flex flex-col items-center justify-center relative cursor-pointer py-1 px-1 min-h-[70vh]"
      >
        {loading && (
          <div className="py-20 text-center font-bold text-sm flex flex-col items-center gap-3">
            <RefreshCw size={28} className="animate-spin text-stone-500" />
            <span>Loading pages for Kindle...</span>
          </div>
        )}

        {error && (
          <div className={`p-4 max-w-md my-10 text-center text-xs font-bold ${isEink ? 'border-2 border-black bg-stone-100' : 'bg-rose-950 text-rose-200 rounded'}`}>
            <p className="mb-2">Error: {error}</p>
            <button
              onClick={loadChapterAndPages}
              className={`px-3 py-1.5 font-extrabold cursor-pointer ${
                isEink ? 'bg-black text-white border border-black' : 'bg-rose-800 text-white rounded'
              }`}
            >
              Retry Chapter
            </button>
          </div>
        )}

        {!loading && !error && currentImageUrl && (
          <div className="relative w-full flex justify-center">
            <img
              key={`${chapterId}-${pageIndex}`}
              src={currentImageUrl}
              alt={`Page ${pageIndex + 1}`}
              style={{ zoom: `${zoomLevel}%` }}
              referrerPolicy="no-referrer"
              className={`${getImageSizingClass()} ${getFilterStyle()} transition-none block select-none`}
            />
          </div>
        )}

        {/* Minimal Float Helper overlay when toolbar is hidden */}
        {hideToolbar && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setHideToolbar(false);
            }}
            className={`fixed top-2 right-2 z-50 p-2 font-bold text-xs opacity-75 hover:opacity-100 cursor-pointer ${
              isEink ? 'bg-black text-white border-2 border-black' : 'bg-stone-800 text-stone-100 rounded'
            }`}
          >
            <Minimize2 size={14} />
          </button>
        )}
      </div>

      {/* Bottom Page Navigation Controls */}
      {!hideToolbar && (
        <div
          id="reader-bottom-bar"
          className={`sticky bottom-0 z-50 px-3 py-2 flex flex-col sm:flex-row items-center justify-between gap-2 ${
            isEink
              ? 'bg-white text-black border-t-2 border-black'
              : 'bg-stone-900/90 text-stone-100 border-t border-stone-800 backdrop-blur'
          }`}
        >
          {/* Chapter Prev / Next */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
            <button
              id="btn-prev-chapter"
              disabled={!prevChapter}
              onClick={() => prevChapter && onSelectChapter(prevChapter.id, chapterList)}
              className={`px-2.5 py-1.5 text-xs font-extrabold flex items-center gap-1 cursor-pointer disabled:opacity-30 ${
                isEink ? 'border-2 border-black bg-white text-black' : 'bg-stone-800 text-stone-200 rounded'
              }`}
            >
              <ChevronLeft size={16} />
              <span>Prev Ch</span>
            </button>

            {/* Page slider & Direct Jumper */}
            <div className="flex items-center gap-2">
              <button
                id="btn-page-prev"
                onClick={handlePrevPage}
                disabled={pageIndex <= 0 && !prevChapter}
                className={`px-3 py-1.5 text-xs font-black cursor-pointer disabled:opacity-30 ${
                  isEink ? 'border-2 border-black bg-black text-white' : 'bg-amber-600 hover:bg-amber-500 text-white rounded'
                }`}
              >
                {settings.readingDirection === 'rtl' ? '▶ Next' : '◀ Prev'}
              </button>

              <div className="flex items-center gap-1 text-xs font-extrabold">
                <input
                  type="number"
                  min={1}
                  max={totalPages || 1}
                  value={pageIndex + 1}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (val >= 1 && val <= totalPages) {
                      setPageIndex(val - 1);
                    }
                  }}
                  className={`w-12 text-center py-1 text-xs font-bold ${
                    isEink ? 'border-2 border-black bg-white text-black' : 'bg-stone-800 text-stone-100 rounded'
                  }`}
                />
                <span>/ {totalPages || 1}</span>
              </div>

              <button
                id="btn-page-next"
                onClick={handleNextPage}
                disabled={pageIndex >= totalPages - 1 && !nextChapter}
                className={`px-3 py-1.5 text-xs font-black cursor-pointer disabled:opacity-30 ${
                  isEink ? 'border-2 border-black bg-black text-white' : 'bg-amber-600 hover:bg-amber-500 text-white rounded'
                }`}
              >
                {settings.readingDirection === 'rtl' ? '◀ Prev' : 'Next ▶'}
              </button>
            </div>

            <button
              id="btn-next-chapter"
              disabled={!nextChapter}
              onClick={() => nextChapter && onSelectChapter(nextChapter.id, chapterList)}
              className={`px-2.5 py-1.5 text-xs font-extrabold flex items-center gap-1 cursor-pointer disabled:opacity-30 ${
                isEink ? 'border-2 border-black bg-white text-black' : 'bg-stone-800 text-stone-200 rounded'
              }`}
            >
              <span>Next Ch</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
