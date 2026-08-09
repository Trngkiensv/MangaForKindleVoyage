import React from 'react';
import { Manga, ReaderSettings } from '../types';
import { getCoverUrl, getMangaTitle } from '../services/provider';
import { BookOpen, Star, User } from 'lucide-react';

interface MangaCardProps {
  manga: Manga;
  settings: ReaderSettings;
  onSelectManga: (mangaId: string) => void;
}

export const MangaCard: React.FC<MangaCardProps> = ({ manga, settings, onSelectManga }) => {
  const isEink = settings.eInkMode;
  const coverUrl = getCoverUrl(manga, '256');
  const title = getMangaTitle(manga, settings.preferredLanguages[0] || 'en');

  // Extract author/artist
  const authorRel = manga.relationships?.find((r) => r.type === 'author');
  const authorName = authorRel?.attributes?.name || '';

  // Extract status
  const status = manga.attributes?.status || 'unknown';

  // Tags
  const tags = (manga.attributes?.tags || []).slice(0, 3).map((t) => t.attributes?.name?.en || t.attributes?.name?.vi).filter(Boolean);

  return (
    <div
      id={`manga-card-${manga.id}`}
      onClick={() => onSelectManga(manga.id)}
      className={`group flex flex-col justify-between cursor-pointer transition-none ${
        isEink
          ? 'bg-white text-black border-4 border-black p-3 hover:bg-stone-100'
          : 'bg-stone-900 text-stone-100 rounded-none overflow-hidden border-2 border-stone-800 hover:border-amber-500 hover:bg-stone-850 p-3'
      }`}
    >
      <div className="flex gap-3 items-start">
        {/* Cover Image */}
        <div
          className={`w-20 h-28 sm:w-24 sm:h-36 flex-shrink-0 relative overflow-hidden ${
            isEink ? 'border-2 border-black bg-stone-200' : 'bg-stone-800 border border-stone-700'
          }`}
        >
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className={`w-full h-full object-cover ${settings.grayscaleImages || isEink ? 'grayscale contrast-125' : ''}`}
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-stone-500 p-1 text-center font-bold">
              No Cover
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col justify-between h-full">
          <div>
            <h3 className={`font-serif font-extrabold text-sm sm:text-base line-clamp-2 leading-tight uppercase ${isEink ? 'text-black' : 'text-stone-100'}`}>
              {title}
            </h3>

            {authorName && (
              <p className={`text-xs mt-1 flex items-center gap-1 font-sans font-bold ${isEink ? 'text-stone-800' : 'text-stone-400'}`}>
                <User size={12} />
                <span className="truncate">{authorName}</span>
              </p>
            )}

            <div className="flex flex-wrap items-center gap-1 mt-2 font-sans">
              <span
                className={`text-[10px] uppercase font-black px-2 py-0.5 ${
                  isEink
                    ? 'border-2 border-black bg-black text-white'
                    : 'bg-amber-950/60 text-amber-400 border border-amber-800/40 rounded-none'
                }`}
              >
                {status}
              </span>

              {manga.attributes?.contentRating && (
                <span
                  className={`text-[10px] uppercase font-black px-2 py-0.5 ${
                    isEink ? 'border-2 border-black bg-stone-100 text-black' : 'bg-stone-800 text-stone-300 rounded-none'
                  }`}
                >
                  {manga.attributes.contentRating}
                </span>
              )}
            </div>

            {/* Tags */}
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2 font-sans">
                {tags.map((tag, idx) => (
                  <span
                    key={idx}
                    className={`text-[10px] uppercase ${
                      isEink ? 'text-black font-extrabold' : 'text-stone-400'
                    }`}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between pt-2 border-t-2 border-black dark:border-stone-800">
            <span
              className={`text-xs font-sans font-black uppercase flex items-center gap-1 ${
                isEink ? 'text-black underline' : 'text-amber-500'
              }`}
            >
              <BookOpen size={12} />
              Read Chapter
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
