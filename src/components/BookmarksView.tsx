import React from 'react';
import { Bookmark, ReaderSettings } from '../types';
import { BookMarked, Trash2, ArrowRight } from 'lucide-react';
import { MangaProviderKey, proxyImageUrl } from '../services/provider';
import { toggleBookmark } from '../services/storage';

interface BookmarksViewProps {
  bookmarks: Bookmark[];
  settings: ReaderSettings;
  onSelectManga: (mangaId: string, provider?: MangaProviderKey) => void;
  onRefreshBookmarks: () => void;
}

export const BookmarksView: React.FC<BookmarksViewProps> = ({
  bookmarks,
  settings,
  onSelectManga,
  onRefreshBookmarks,
}) => {
  const isEink = settings.eInkMode;

  const handleRemove = (e: React.MouseEvent, provider: MangaProviderKey, mangaId: string, title: string) => {
    e.stopPropagation();
    toggleBookmark(provider, mangaId, title, null);
    onRefreshBookmarks();
  };

  return (
    <div className="max-w-4xl mx-auto p-4 font-sans">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b-4 border-black dark:border-stone-800">
        <BookMarked size={22} className={isEink ? 'text-black' : 'text-amber-500'} />
        <h1 className="text-xl font-serif font-black uppercase tracking-tight">Saved Bookmarks ({bookmarks.length})</h1>
      </div>

      {bookmarks.length === 0 ? (
        <div
          className={`p-8 text-center text-xs font-bold uppercase ${
            isEink ? 'border-4 border-black bg-white text-black' : 'bg-stone-900 border-2 border-stone-800 text-stone-400'
          }`}
        >
          No saved manga yet. Search or browse manga and click "Bookmark" to save them here for quick Kindle access.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {bookmarks.map((bm) => (
            <div
              key={`${bm.provider}-${bm.mangaId}`}
              id={`bookmark-item-${bm.mangaId}`}
              onClick={() => onSelectManga(bm.mangaId, bm.provider as MangaProviderKey)}
              className={`p-3 flex items-center justify-between cursor-pointer active:opacity-70 transition-none ${
                isEink
                  ? 'bg-white text-black border-4 border-black hover:bg-stone-100'
                  : 'bg-stone-900 text-stone-100 border-2 border-stone-800 hover:border-amber-500'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 pr-2">
                {bm.coverUrl ? (
                  <img
                    src={proxyImageUrl(bm.coverUrl, bm.provider as MangaProviderKey)}
                    alt={bm.title}
                    referrerPolicy="no-referrer"
                    className={`w-12 h-16 object-cover flex-shrink-0 ${isEink ? 'border-2 border-black grayscale' : 'border border-stone-700'}`}
                  />
                ) : (
                  <div className={`w-12 h-16 flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${isEink ? 'border-2 border-black bg-stone-200' : 'bg-stone-800'}`}>
                    No Cover
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="font-serif font-extrabold text-sm uppercase line-clamp-2 leading-tight">{bm.title}</h3>
                  <span className={`text-[10px] font-sans font-bold uppercase block mt-1 ${isEink ? 'text-black opacity-80' : 'text-stone-400'}`}>
                    Saved {new Date(bm.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={(e) => handleRemove(e, bm.provider as MangaProviderKey, bm.mangaId, bm.title)}
                  title="Remove bookmark"
                  className={`p-1.5 cursor-pointer ${
                    isEink ? 'border-2 border-black bg-white hover:bg-black hover:text-white' : 'text-stone-400 hover:text-rose-400'
                  }`}
                >
                  <Trash2 size={16} />
                </button>
                <ArrowRight size={18} className={isEink ? 'text-black' : 'text-amber-500'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
