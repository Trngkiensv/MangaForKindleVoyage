import React, { useEffect, useState } from 'react';
import { Chapter, Manga, ReaderSettings, ReadingHistoryItem } from '../types';
import {
  formatChapterName,
  getActiveProvider,
  getCoverUrl,
  getMangaDescription,
  getMangaFeed,
  getMangaTitle,
} from '../services/provider';
import { isBookmarked, toggleBookmark, getMangaProgress } from '../services/storage';
import { ArrowLeft, BookmarkCheck, BookmarkPlus, BookOpen, RefreshCw, Search } from 'lucide-react';

interface MangaDetailProps {
  manga: Manga;
  settings: ReaderSettings;
  onBack: () => void;
  onSelectChapter: (chapterId: string, chapterList: Chapter[]) => void;
}

const MANGADEX_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'EN' },
  { code: 'vi', label: 'VI' },
  { code: 'ja', label: 'JP' },
  { code: 'ko', label: 'KR' },
  { code: 'zh-hans', label: 'ZH-CN' },
  { code: 'zh-hant', label: 'ZH-TW' },
  { code: 'es', label: 'ES' },
  { code: 'es-la', label: 'ES-LA' },
  { code: 'fr', label: 'FR' },
  { code: 'pt-br', label: 'PT-BR' },
  { code: 'id', label: 'ID' },
  { code: 'th', label: 'TH' },
];

const MANGADEX_LANGUAGE_STORAGE_KEY = 'kindle_mangadex_chapter_language_v37';

export const MangaDetail: React.FC<MangaDetailProps> = ({
  manga,
  settings,
  onBack,
  onSelectChapter,
}) => {
  const isEink = settings.eInkMode;
  const coverUrl = getCoverUrl(manga, '512');
  const title = getMangaTitle(manga, settings.preferredLanguages[0] || 'en');
  const description = getMangaDescription(manga, settings.preferredLanguages[0] || 'en');
  const isMangaDex = getActiveProvider() === 'mangadex';

  const [bookmarked, setBookmarked] = useState<boolean>(false);
  const [historyItem, setHistoryItem] = useState<ReadingHistoryItem | null>(null);

  // Chapter Feed State
  const CHAPTER_PAGE_SIZE = 60;
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chapterTotal, setChapterTotal] = useState<number>(0);
  const [chapterOffset, setChapterOffset] = useState<number>(0);
  const [loadingFeed, setLoadingFeed] = useState<boolean>(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [chapterFilter, setChapterFilter] = useState<string>('');
  const [mangaDexLanguage, setMangaDexLanguage] = useState<string>('en');

  useEffect(() => {
    setBookmarked(isBookmarked(getActiveProvider(), manga.id));
    setHistoryItem(getMangaProgress(getActiveProvider(), manga.id));
  }, [manga.id]);

  useEffect(() => {
    let initialLanguage = 'en';
    if (isMangaDex) {
      try {
        const stored = window.localStorage.getItem(MANGADEX_LANGUAGE_STORAGE_KEY);
        if (stored) initialLanguage = stored;
      } catch (_error) {}
      const available = manga.attributes?.availableTranslatedLanguages || [];
      if (available.length > 0 && available.indexOf(initialLanguage) === -1) {
        const preferred = settings.preferredLanguages.find((lang) => available.indexOf(lang) !== -1);
        initialLanguage = preferred || available[0] || 'en';
      }
      setMangaDexLanguage(initialLanguage);
    }
    loadChapters(0, initialLanguage);
  }, [manga.id]);

  const loadChapters = async (offset: number = 0, language: string = mangaDexLanguage) => {
    setLoadingFeed(true);
    setFeedError(null);
    try {
      const result = await getMangaFeed(manga.id, isMangaDex ? [language] : [], CHAPTER_PAGE_SIZE, offset);
      setChapters(result.data);
      setChapterTotal(result.total);
      setChapterOffset(offset);
      setChapterFilter('');
    } catch (err: any) {
      setFeedError(err.message || 'Failed to load chapter list');
    } finally {
      setLoadingFeed(false);
    }
  };

  const selectMangaDexLanguage = (language: string) => {
    if (!isMangaDex || loadingFeed || language === mangaDexLanguage) return;
    setMangaDexLanguage(language);
    try { window.localStorage.setItem(MANGADEX_LANGUAGE_STORAGE_KEY, language); } catch (_error) {}
    loadChapters(0, language);
  };

  const handleBookmarkToggle = () => {
    const newState = toggleBookmark(getActiveProvider(), manga.id, title, coverUrl);
    setBookmarked(newState);
  };

  // Filtered chapters
  const filteredChapters = chapters.filter((ch) => {
    if (!chapterFilter) return true;
    const chName = formatChapterName(ch).toLowerCase();
    return chName.includes(chapterFilter.toLowerCase());
  });

  const availableMangaDexLanguages = manga.attributes?.availableTranslatedLanguages || [];
  const mangaDexLanguageOptions = MANGADEX_LANGUAGE_OPTIONS.filter((option) =>
    availableMangaDexLanguages.length === 0 || availableMangaDexLanguages.indexOf(option.code) !== -1,
  );

  const chapterPageCount = chapterTotal > 0 ? Math.ceil(chapterTotal / CHAPTER_PAGE_SIZE) : 0;
  const chapterPageNumber = chapterTotal > 0 ? Math.floor(chapterOffset / CHAPTER_PAGE_SIZE) + 1 : 0;
  const chapterRangeStart = chapters.length ? chapterOffset + 1 : 0;
  const chapterRangeEnd = chapterOffset + chapters.length;

  const goToChapterPage = (nextOffset: number) => {
    if (loadingFeed) return;
    const maxOffset = chapterTotal > 0
      ? Math.floor((chapterTotal - 1) / CHAPTER_PAGE_SIZE) * CHAPTER_PAGE_SIZE
      : 0;
    const normalized = Math.max(0, Math.min(nextOffset, maxOffset));
    if (normalized !== chapterOffset) loadChapters(normalized);
  };

  // Extract Authors/Artists
  const authors = manga.relationships
    ?.filter((r) => r.type === 'author' || r.type === 'artist')
    .map((r) => r.attributes?.name)
    .filter(Boolean);

  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-5">
      {/* Back Button & Top Navigation */}
      <div className="flex items-center justify-between mb-4 font-sans">
        <button
          id="btn-back-manga-detail"
          onClick={onBack}
          className={`flex items-center gap-1.5 px-4 py-2 font-black text-xs uppercase cursor-pointer ${
            isEink
              ? 'bg-white text-black border-4 border-black active:bg-black active:text-white hover:bg-black hover:text-white'
              : 'bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-none border-2 border-stone-700'
          }`}
        >
          <ArrowLeft size={16} />
          <span>Back to List</span>
        </button>

        <button
          id="btn-bookmark-toggle"
          onClick={handleBookmarkToggle}
          className={`flex items-center gap-1.5 px-4 py-2 font-black text-xs uppercase cursor-pointer ${
            bookmarked
              ? isEink
                ? 'bg-black text-white border-4 border-black'
                : 'bg-amber-600 text-white rounded-none border-2 border-amber-500'
              : isEink
              ? 'bg-white text-black border-4 border-black hover:bg-black hover:text-white'
              : 'bg-stone-800 hover:bg-stone-700 text-stone-200 rounded-none border-2 border-stone-700'
          }`}
        >
          {bookmarked ? <BookmarkCheck size={16} /> : <BookmarkPlus size={16} />}
          <span>{bookmarked ? 'Saved to Bookmarks' : 'Bookmark Manga'}</span>
        </button>
      </div>

      {/* Main Details Box */}
      <div
        className={`mb-6 p-5 ${
          isEink
            ? 'bg-white text-black border-4 border-black'
            : 'bg-stone-900 text-stone-100 border-2 border-stone-800'
        }`}
      >
        <div className="flex flex-col md:flex-row gap-5 items-start">
          {/* Cover */}
          <div
            className={`w-36 sm:w-48 h-52 sm:h-68 flex-shrink-0 mx-auto md:mx-0 overflow-hidden relative ${
              isEink ? 'border-4 border-black bg-stone-200' : 'bg-stone-800 border-2 border-stone-700'
            }`}
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={title}
                referrerPolicy="no-referrer"
                className={`w-full h-full object-cover ${settings.grayscaleImages || isEink ? 'grayscale contrast-125' : ''}`}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs font-bold text-stone-500">
                No Cover
              </div>
            )}
          </div>

          {/* Metadata */}
          <div className="flex-1 min-w-0 w-full">
            <h1 className={`text-xl sm:text-2xl font-serif font-black mb-2 leading-tight uppercase ${isEink ? 'text-black' : 'text-stone-100'}`}>
              {title}
            </h1>

            {authors && authors.length > 0 && (
              <p className={`text-xs font-sans font-bold uppercase mb-3 ${isEink ? 'text-black opacity-90' : 'text-stone-400'}`}>
                By: {authors.join(', ')}
              </p>
            )}

            <div className="flex flex-wrap gap-2 mb-3 text-xs font-sans font-black uppercase">
              <span className={`px-2 py-0.5 ${isEink ? 'border-2 border-black bg-black text-white' : 'bg-stone-800 text-stone-300'}`}>
                Status: {manga.attributes?.status || 'Unknown'}
              </span>
              {manga.attributes?.contentRating && (
                <span className={`px-2 py-0.5 ${isEink ? 'border-2 border-black bg-stone-100' : 'bg-stone-800 text-stone-300'}`}>
                  {manga.attributes.contentRating}
                </span>
              )}
              {manga.attributes?.year && (
                <span className={`px-2 py-0.5 ${isEink ? 'border-2 border-black bg-stone-100' : 'bg-stone-800 text-stone-300'}`}>
                  Year: {manga.attributes.year}
                </span>
              )}
            </div>

            {/* Resume button if history exists */}
            {historyItem && (
              <div className={`mb-4 p-3 font-sans ${isEink ? 'border-4 border-black bg-stone-100' : 'bg-stone-800/80 border-2 border-stone-700'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="block text-xs font-black uppercase tracking-wider text-amber-500">Resume Reading</span>
                    <span className="block text-sm font-extrabold">
                      {historyItem.chapterTitle === 'Volume' ? 'Vol.' : 'Ch.'} {historyItem.chapterNumber} - Page {historyItem.pageIndex + 1}/{historyItem.totalPages}
                    </span>
                  </div>
                  <button
                    id="btn-resume-reading"
                    onClick={() => onSelectChapter(historyItem.chapterId, chapters)}
                    className={`px-3 py-1.5 font-black text-xs uppercase cursor-pointer flex items-center gap-1 ${
                      isEink
                        ? 'bg-black text-white border-2 border-black hover:bg-white hover:text-black'
                        : 'bg-amber-600 hover:bg-amber-500 text-white'
                    }`}
                  >
                    <BookOpen size={14} />
                    <span>Continue Reading</span>
                  </button>
                </div>
              </div>
            )}

            {/* Description */}
            {description && (
              <div className="mt-2 font-sans">
                <h3 className={`text-xs font-black uppercase mb-1 ${isEink ? 'text-black' : 'text-stone-400'}`}>
                  Synopsis:
                </h3>
                <p className={`text-xs leading-relaxed max-h-36 overflow-y-auto pr-1 ${isEink ? 'text-black font-medium' : 'text-stone-300'}`}>
                  {description}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chapters Feed Section */}
      <div
        className={`p-5 ${
          isEink
            ? 'bg-white text-black border-4 border-black'
            : 'bg-stone-900 text-stone-100 border-2 border-stone-800'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b-4 border-black dark:border-stone-800">
          <h2 className="text-base sm:text-lg font-serif font-black uppercase flex items-center gap-2">
            <BookOpen size={18} />
            <span>Chapter List ({chapterTotal} total)</span>
          </h2>
        </div>

        {isMangaDex && (
          <div className={`mb-4 p-2 ${isEink ? 'border-2 border-black' : 'border border-stone-700'}`}>
            <div className="text-[10px] font-black uppercase mb-2">Chapter language</div>
            <div className="flex flex-wrap gap-2">
              {mangaDexLanguageOptions.map((option) => (
                <button
                  key={option.code}
                  type="button"
                  onClick={() => selectMangaDexLanguage(option.code)}
                  disabled={loadingFeed}
                  className={`px-2 py-1 text-xs font-black border-2 cursor-pointer ${
                    option.code === mangaDexLanguage
                      ? isEink ? 'bg-black text-white border-black' : 'bg-amber-600 text-white border-amber-500'
                      : isEink ? 'bg-white text-black border-black' : 'bg-stone-800 text-stone-200 border-stone-600'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search Chapter filter */}
        <div className="mb-4">
          <div className="relative">
            <input
              id="input-chapter-search"
              type="text"
              placeholder="Filter this chapter page..."
              value={chapterFilter}
              onChange={(e) => setChapterFilter(e.target.value)}
              className={`w-full py-1.5 pl-8 pr-3 text-xs font-sans font-bold ${
                isEink
                  ? 'bg-white text-black border-2 border-black focus:outline-none'
                  : 'bg-stone-800 text-stone-100 border border-stone-700 focus:outline-none'
              }`}
            />
            <Search className="absolute left-2.5 top-2 text-stone-500" size={14} />
          </div>
        </div>

        {chapterPageCount > 1 && (
          <div className={`mb-4 p-2 flex flex-wrap items-center justify-center gap-2 text-xs font-bold ${isEink ? 'border-2 border-black' : 'border border-stone-700'}`}>
            <button onClick={() => goToChapterPage(0)} disabled={loadingFeed || chapterOffset === 0} className="px-2 py-1 border border-current disabled:opacity-40">First</button>
            <button onClick={() => goToChapterPage(chapterOffset - CHAPTER_PAGE_SIZE)} disabled={loadingFeed || chapterOffset === 0} className="px-2 py-1 border border-current disabled:opacity-40">Prev</button>
            <span>Page {chapterPageNumber}/{chapterPageCount} · {chapterRangeStart}-{chapterRangeEnd} of {chapterTotal}</span>
            <button onClick={() => goToChapterPage(chapterOffset + CHAPTER_PAGE_SIZE)} disabled={loadingFeed || chapterRangeEnd >= chapterTotal} className="px-2 py-1 border border-current disabled:opacity-40">Next</button>
            <button onClick={() => goToChapterPage((chapterPageCount - 1) * CHAPTER_PAGE_SIZE)} disabled={loadingFeed || chapterRangeEnd >= chapterTotal} className="px-2 py-1 border border-current disabled:opacity-40">Last</button>
          </div>
        )}

        {/* Loading / Error States */}
        {loadingFeed && (
          <div className="py-8 text-center font-bold text-sm flex flex-col items-center gap-2">
            <RefreshCw size={20} className="animate-spin text-stone-500" />
            <span>Loading chapters from active provider...</span>
          </div>
        )}

        {feedError && (
          <div className={`p-3 text-xs font-bold my-2 ${isEink ? 'border-2 border-black bg-stone-100' : 'bg-rose-950/60 text-rose-300 border border-rose-800 rounded'}`}>
            <span>Error: {feedError}</span>
            <button
              onClick={() => loadChapters(chapterOffset)}
              className="ml-2 underline cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {!loadingFeed && !feedError && filteredChapters.length === 0 && (
          <div className="py-8 text-center text-xs font-bold text-stone-500">
            No chapters found.
          </div>
        )}

        {/* Chapter List */}
        {!loadingFeed && filteredChapters.length > 0 && (
          <div className="divide-y divide-stone-200 dark:divide-stone-800 max-h-[500px] overflow-y-auto">
            {filteredChapters.map((ch) => {
              const isCurrentReading = historyItem?.chapterId === ch.id;
              const titleFormatted = formatChapterName(ch);

              return (
                <div
                  key={ch.id}
                  id={`chapter-item-${ch.id}`}
                  onClick={() => onSelectChapter(ch.id, filteredChapters)}
                  className={`py-2.5 px-2 flex items-center justify-between cursor-pointer active:opacity-60 transition-none ${
                    isCurrentReading
                      ? isEink
                        ? 'bg-stone-200 font-extrabold border-l-4 border-black'
                        : 'bg-amber-950/40 text-amber-300 font-bold border-l-2 border-amber-500'
                      : isEink
                      ? 'hover:bg-stone-100 text-black'
                      : 'hover:bg-stone-800 text-stone-200'
                  }`}
                >
                  <div className="flex-1 min-w-0 pr-2">
                    <span className="text-xs sm:text-sm font-bold block truncate">
                      {titleFormatted}
                    </span>
                    <span className={`text-[10px] block ${isEink ? 'text-stone-700' : 'text-stone-400'}`}>
                      {ch.attributes.publishAt ? new Date(ch.attributes.publishAt).toLocaleDateString() : ''}
                      {isMangaDex && (ch.attributes as any).translatedLanguage ? ` · ${String((ch.attributes as any).translatedLanguage).toUpperCase()}` : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isCurrentReading && (
                      <span className={`text-[10px] font-extrabold px-1.5 py-0.5 ${isEink ? 'bg-black text-white' : 'bg-amber-600 text-white rounded'}`}>
                        Reading
                      </span>
                    )}
                    <button
                      className={`px-2.5 py-1 text-xs font-extrabold cursor-pointer ${
                        isEink
                          ? 'bg-black text-white border border-black'
                          : 'bg-stone-800 hover:bg-stone-700 text-amber-400 rounded'
                      }`}
                    >
                      Read
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
