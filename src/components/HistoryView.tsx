import React from 'react';
import { ReadingHistoryItem, ReaderSettings } from '../types';
import { History, BookOpen, Clock } from 'lucide-react';

interface HistoryViewProps {
  history: ReadingHistoryItem[];
  settings: ReaderSettings;
  onSelectChapter: (chapterId: string, mangaId: string) => void;
  onSelectManga: (mangaId: string) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  settings,
  onSelectChapter,
  onSelectManga,
}) => {
  const isEink = settings.eInkMode;

  return (
    <div className="max-w-4xl mx-auto p-4 font-sans">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b-4 border-black dark:border-stone-800">
        <History size={22} className={isEink ? 'text-black' : 'text-amber-500'} />
        <h1 className="text-xl font-serif font-black uppercase tracking-tight">Reading History ({history.length})</h1>
      </div>

      {history.length === 0 ? (
        <div
          className={`p-8 text-center text-xs font-bold uppercase ${
            isEink ? 'border-4 border-black bg-white text-black' : 'bg-stone-900 border-2 border-stone-800 text-stone-400'
          }`}
        >
          No reading history yet. Read chapters to automatically keep track of your last read page and progress on Kindle.
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((item) => (
            <div
              key={`${item.mangaId}-${item.chapterId}`}
              id={`history-item-${item.chapterId}`}
              onClick={() => onSelectChapter(item.chapterId, item.mangaId)}
              className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer active:opacity-70 transition-none ${
                isEink
                  ? 'bg-white text-black border-4 border-black hover:bg-stone-100'
                  : 'bg-stone-900 text-stone-100 border-2 border-stone-800 hover:border-amber-500'
              }`}
            >
              <div className="min-w-0">
                <h3 className="font-serif font-black text-base uppercase leading-tight truncate">{item.mangaTitle}</h3>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 font-sans font-bold">
                  <span
                    className={`text-xs font-black px-2 py-0.5 uppercase ${
                      isEink ? 'bg-black text-white border-2 border-black' : 'bg-amber-600 text-white'
                    }`}
                  >
                    {item.chapterTitle === 'Volume' ? 'Vol.' : 'Ch.'} {item.chapterNumber}
                  </span>
                  <span className={`text-xs uppercase ${isEink ? 'text-black' : 'text-stone-300'}`}>
                    Page {item.pageIndex + 1} / {item.totalPages}
                  </span>
                  {item.chapterTitle && item.chapterTitle !== 'Volume' && (
                    <span className={`text-xs uppercase truncate ${isEink ? 'text-black opacity-80' : 'text-stone-400'}`}>
                      : {item.chapterTitle}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t-2 sm:border-t-0 border-black dark:border-stone-800">
                <span className={`text-[10px] font-bold uppercase flex items-center gap-1 ${isEink ? 'text-black opacity-80' : 'text-stone-400'}`}>
                  <Clock size={12} />
                  {new Date(item.lastReadAt).toLocaleDateString()} {new Date(item.lastReadAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>

                <button
                  className={`px-3 py-1.5 text-xs font-black uppercase cursor-pointer flex items-center gap-1 ${
                    isEink ? 'bg-black text-white border-2 border-black hover:bg-white hover:text-black' : 'bg-stone-800 text-amber-400 hover:bg-stone-700'
                  }`}
                >
                  <BookOpen size={14} />
                  <span>Resume</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
