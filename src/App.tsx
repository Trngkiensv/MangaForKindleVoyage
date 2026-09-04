import React, { useEffect, useState } from 'react';
import { Chapter, Manga, ReaderSettings } from './types';
import {
  getActiveProvider,
  getChapterById,
  getMangaById,
  MangaProviderKey,
  parseProviderInput,
  searchManga,
  setActiveProvider,
} from './services/provider';
import {
  getStoredBookmarks,
  getStoredHistory,
  getStoredSettings,
  saveStoredSettings,
} from './services/storage';
import { Header } from './components/Header';
import { MangaCard } from './components/MangaCard';
import { MangaDetail } from './components/MangaDetail';
import { MangaReader } from './components/MangaReader';
import { KindleSettingsModal } from './components/KindleSettingsModal';
import { BookmarksView } from './components/BookmarksView';
import { HistoryView } from './components/HistoryView';
import { Sparkles, TrendingUp, Clock, BookOpen, AlertCircle, RefreshCw, Feather } from 'lucide-react';

export default function App() {
  const [settings, setSettings] = useState<ReaderSettings>(getStoredSettings());
  const [provider, setProvider] = useState<MangaProviderKey>(getActiveProvider());

  // Views & Routing State
  const [currentView, setCurrentView] = useState<'home' | 'detail' | 'reader' | 'bookmarks' | 'history'>('home');
  const [selectedManga, setSelectedManga] = useState<Manga | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [activeChapterList, setActiveChapterList] = useState<Chapter[]>([]);

  // Search & List State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [mangaList, setMangaList] = useState<Manga[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(true);
  const [listError, setListError] = useState<string | null>(null);
  const [totalManga, setTotalManga] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [sortOrder, setSortOrder] = useState<'followedCount' | 'latestUploadedChapter' | 'rating'>('followedCount');

  // Modals & Side state
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [bookmarks, setBookmarks] = useState(getStoredBookmarks());
  const [history, setHistory] = useState(getStoredHistory());

  // Load initial popular manga on mount
  useEffect(() => {
    loadMangaList();
  }, [page, sortOrder, provider]);

  const loadMangaList = async (queryOverride?: string) => {
    setLoadingList(true);
    setListError(null);
    try {
      const q = queryOverride !== undefined ? queryOverride : searchQuery;
      const limit = 20;
      const offset = (page - 1) * limit;

      const orderObj: Record<string, 'asc' | 'desc'> = {};
      orderObj[sortOrder] = 'desc';

      const res = await searchManga({
        title: q || undefined,
        limit,
        offset,
        order: orderObj,
      });

      setMangaList(res.data);
      setTotalManga(res.total);
    } catch (err: any) {
      setListError(err.message || 'Failed to fetch manga list from provider');
    } finally {
      setLoadingList(false);
    }
  };

  // Handle search input. MangaDex URLs/UUIDs remain supported for backwards compatibility.
  const handleSearch = async (input: string) => {
    setSearchQuery(input);
    setPage(1);

    const parsed = parseProviderInput(input, provider);

    if (parsed.type === 'manga' && parsed.id) {
      // Direct Manga ID / URL
      try {
        setLoadingList(true);
        const m = await getMangaById(parsed.id);
        setSelectedManga(m);
        setCurrentView('detail');
      } catch (err: any) {
        setListError(`Could not find manga with ID ${parsed.id}`);
      } finally {
        setLoadingList(false);
      }
      return;
    }

    if (parsed.type === 'chapter' && parsed.id) {
      // Direct Chapter ID / URL
      try {
        setLoadingList(true);
        const ch = await getChapterById(parsed.id);
        setSelectedChapterId(ch.id);
        setActiveChapterList([ch]);
        setCurrentView('reader');
      } catch (err: any) {
        setListError(`Could not load chapter with ID ${parsed.id}`);
      } finally {
        setLoadingList(false);
      }
      return;
    }

    // Standard search
    setCurrentView('home');
    loadMangaList(input);
  };

  // Select a Manga to open detail view
  const handleSelectManga = async (mangaId: string, sourceProvider?: MangaProviderKey) => {
    try {
      setLoadingList(true);
      if (sourceProvider && sourceProvider !== getActiveProvider()) {
        setActiveProvider(sourceProvider);
        setProvider(sourceProvider);
      }
      const m = await getMangaById(mangaId);
      setSelectedManga(m);
      setCurrentView('detail');
    } catch (err: any) {
      setListError('Failed to load manga details');
    } finally {
      setLoadingList(false);
    }
  };

  // Select a Chapter to open reader view
  const handleSelectChapter = (chapterId: string, chapterList: Chapter[]) => {
    setSelectedChapterId(chapterId);
    setActiveChapterList(chapterList);
    setCurrentView('reader');
  };

  // Select Chapter directly from History
  const handleSelectHistoryChapter = async (chapterId: string, _mangaId: string, sourceProvider?: MangaProviderKey) => {
    try {
      setLoadingList(true);
      if (sourceProvider && sourceProvider !== getActiveProvider()) {
        setActiveProvider(sourceProvider);
        setProvider(sourceProvider);
      }
      // Load only the requested chapter. Pulling hundreds of chapter records
      // just to resume one history item is expensive on e-ink clients.
      const chapter = await getChapterById(chapterId);
      setSelectedChapterId(chapterId);
      setActiveChapterList([chapter]);
      setCurrentView('reader');
    } catch (e) {
      setSelectedChapterId(chapterId);
      setActiveChapterList([]);
      setCurrentView('reader');
    } finally {
      setLoadingList(false);
    }
  };

  const handleProviderChange = (nextProvider: MangaProviderKey) => {
    if (nextProvider === provider) return;
    setActiveProvider(nextProvider);
    setProvider(nextProvider);
    setSearchQuery('');
    setPage(1);
    setSelectedManga(null);
    setSelectedChapterId(null);
    setActiveChapterList([]);
    setListError(null);
    setCurrentView('home');
  };

  const updateSettings = (newSettings: ReaderSettings) => {
    setSettings(newSettings);
    saveStoredSettings(newSettings);
  };

  const isEink = settings.eInkMode;

  return (
    <div
      className={`min-h-screen flex flex-col font-sans transition-none ${
        isEink ? 'bg-white text-black' : 'bg-stone-950 text-stone-100'
      }`}
    >
      {/* Header Bar */}
      {currentView !== 'reader' && (
        <Header
          settings={settings}
          onUpdateSettings={updateSettings}
          onSearch={handleSearch}
          onOpenSettings={() => setShowSettingsModal(true)}
          onOpenBookmarks={() => {
            setBookmarks(getStoredBookmarks());
            setCurrentView('bookmarks');
          }}
          onOpenHistory={() => {
            setHistory(getStoredHistory());
            setCurrentView('history');
          }}
          onGoHome={() => {
            setSearchQuery('');
            setPage(1);
            setCurrentView('home');
            loadMangaList('');
          }}
          currentView={currentView}
          provider={provider}
          onProviderChange={handleProviderChange}
        />
      )}

      {/* Main App Body */}
      <main className="flex-1">
        {/* VIEW: HOME (MANGA EXPLORER) */}
        {currentView === 'home' && (
          <div className="max-w-6xl mx-auto p-3 sm:p-5">
            {/* Banner / Filter Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b-4 border-black dark:border-stone-800">
              <div className="flex items-center gap-2">
                <Feather size={20} className={isEink ? 'text-black' : 'text-amber-500'} />
                <h1 className="text-base sm:text-lg font-serif font-black uppercase tracking-tight">
                  {searchQuery ? `Search Results for "${searchQuery}"` : 'Browse Manga'}
                </h1>
              </div>

              {/* Sort selector */}
              {!searchQuery && (
                <div className="flex items-center gap-1 text-xs font-sans font-bold">
                  <span className="hidden sm:inline mr-1 uppercase">Sort:</span>
                  {[
                    { id: 'followedCount', label: 'Popular', icon: TrendingUp },
                    { id: 'latestUploadedChapter', label: 'Latest', icon: Clock },
                    { id: 'rating', label: 'Top Rated', icon: Sparkles },
                  ].map((s) => {
                    const Icon = s.icon;
                    return (
                      <button
                        key={s.id}
                        id={`sort-btn-${s.id}`}
                        onClick={() => {
                          setSortOrder(s.id as any);
                          setPage(1);
                        }}
                        className={`px-3 py-1.5 text-[11px] font-black uppercase flex items-center gap-1 cursor-pointer ${
                          sortOrder === s.id
                            ? isEink
                              ? 'bg-black text-white border-2 border-black'
                              : 'bg-amber-600 text-white'
                            : isEink
                            ? 'bg-stone-100 text-black border-2 border-black hover:bg-black hover:text-white'
                            : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
                        }`}
                      >
                        <Icon size={12} />
                        <span>{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Error Message */}
            {listError && (
              <div className={`p-4 mb-4 text-xs font-sans font-bold ${isEink ? 'border-4 border-black bg-stone-100' : 'bg-rose-950 text-rose-200 border-2 border-rose-800'}`}>
                <div className="flex items-center gap-2">
                  <AlertCircle size={16} />
                  <span>{listError}</span>
                </div>
                <button
                  onClick={() => loadMangaList()}
                  className="mt-2 text-xs underline font-black uppercase cursor-pointer"
                >
                  Retry Loading
                </button>
              </div>
            )}

            {/* Loading Indicator */}
            {loadingList && (
              <div className="py-20 text-center font-bold text-sm flex flex-col items-center justify-center gap-3">
                <RefreshCw size={28} className="animate-spin text-stone-500" />
                <span>Fetching manga from active provider...</span>
              </div>
            )}

            {/* Manga Grid */}
            {!loadingList && !listError && (
              <>
                {mangaList.length === 0 ? (
                  <div className="py-16 text-center text-xs font-bold text-stone-500">
                    No manga found. Try adjusting your search query.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {mangaList.map((manga) => (
                      <MangaCard
                        key={manga.id}
                        manga={manga}
                        settings={settings}
                        onSelectManga={handleSelectManga}
                      />
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {totalManga > 20 && (
                  <div className="mt-6 pt-4 flex items-center justify-between border-t border-dashed border-stone-300 dark:border-stone-800 text-xs font-bold">
                    <button
                      id="btn-prev-page"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className={`px-4 py-2 cursor-pointer disabled:opacity-30 ${
                        isEink
                          ? 'border-2 border-black bg-white text-black font-extrabold'
                          : 'bg-stone-800 hover:bg-stone-700 text-stone-100 rounded'
                      }`}
                    >
                      ◀ Previous
                    </button>

                    <span>
                      Page {page} of {Math.ceil(totalManga / 20)}
                    </span>

                    <button
                      id="btn-next-page"
                      disabled={page >= Math.ceil(totalManga / 20)}
                      onClick={() => setPage((p) => p + 1)}
                      className={`px-4 py-2 cursor-pointer disabled:opacity-30 ${
                        isEink
                          ? 'border-2 border-black bg-black text-white font-extrabold'
                          : 'bg-amber-600 hover:bg-amber-500 text-white rounded'
                      }`}
                    >
                      Next ▶
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* VIEW: MANGA DETAIL */}
        {currentView === 'detail' && selectedManga && (
          <MangaDetail
            manga={selectedManga}
            settings={settings}
            onBack={() => setCurrentView('home')}
            onSelectChapter={handleSelectChapter}
          />
        )}

        {/* VIEW: MANGA READER */}
        {currentView === 'reader' && selectedChapterId && (
          <MangaReader
            chapterId={selectedChapterId}
            chapterList={activeChapterList}
            settings={settings}
            onUpdateSettings={updateSettings}
            onBackToManga={(mangaId) => {
              if (mangaId) {
                handleSelectManga(mangaId);
              } else if (selectedManga) {
                setCurrentView('detail');
              } else {
                setCurrentView('home');
              }
            }}
            onSelectChapter={handleSelectChapter}
          />
        )}

        {/* VIEW: BOOKMARKS */}
        {currentView === 'bookmarks' && (
          <BookmarksView
            bookmarks={bookmarks}
            settings={settings}
            onSelectManga={handleSelectManga}
            onRefreshBookmarks={() => setBookmarks(getStoredBookmarks())}
          />
        )}

        {/* VIEW: HISTORY */}
        {currentView === 'history' && (
          <HistoryView
            history={history}
            settings={settings}
            onSelectChapter={handleSelectHistoryChapter}
            onSelectManga={handleSelectManga}
          />
        )}
      </main>

      {/* Settings Modal */}
      {showSettingsModal && (
        <KindleSettingsModal
          settings={settings}
          onSave={updateSettings}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}
