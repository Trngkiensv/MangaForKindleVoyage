import { Bookmark, ReaderSettings, ReadingHistoryItem } from '../types';

const SETTINGS_KEY = 'kindle_manga_reader_settings_v1';
const BOOKMARKS_KEY = 'kindle_manga_reader_bookmarks_v1';
const HISTORY_KEY = 'kindle_manga_reader_history_v1';

export const DEFAULT_SETTINGS: ReaderSettings = {
  eInkMode: true, // Enabled by default for Kindle Voyage target
  dataSaver: true, // Use lighter images for Kindle browser/Wi-Fi
  imageFit: 'width',
  readingDirection: 'rtl', // Manga standard right-to-left
  contrastFilter: 'high', // High contrast for E-ink screens
  grayscaleImages: false,
  preferredLanguages: ['vi', 'en'],
  fullScreenReader: false,
  tapZoneMode: 'standard', // Right 70% = Next page (standard manga)
  preloadPages: 2,
};

export function getStoredSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
}

export function saveStoredSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings to localStorage', e);
  }
}

export function getStoredBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items.filter((item) => item && typeof item.provider === 'string' && item.provider) : [];
  } catch (e) {
    return [];
  }
}

export function toggleBookmark(provider: string, mangaId: string, title: string, coverUrl: string | null): boolean {
  try {
    if (!provider) return false;
    const bookmarks = getStoredBookmarks();
    const existingIndex = bookmarks.findIndex((b) => b.provider === provider && b.mangaId === mangaId);

    if (existingIndex >= 0) {
      bookmarks.splice(existingIndex, 1);
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
      return false;
    } else {
      bookmarks.unshift({
        provider,
        mangaId,
        title,
        coverUrl,
        updatedAt: Date.now(),
      });
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
      return true;
    }
  } catch (e) {
    return false;
  }
}

export function isBookmarked(provider: string, mangaId: string): boolean {
  const bookmarks = getStoredBookmarks();
  return bookmarks.some((b) => b.provider === provider && b.mangaId === mangaId);
}

export function getStoredHistory(): ReadingHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const items = raw ? JSON.parse(raw) : [];
    return Array.isArray(items) ? items.filter((item) => item && typeof item.provider === 'string' && item.provider) : [];
  } catch (e) {
    return [];
  }
}

export function saveHistoryItem(item: Omit<ReadingHistoryItem, 'lastReadAt'>): void {
  try {
    const history = getStoredHistory();
    const existingIndex = history.findIndex((h) => h.provider === item.provider && h.mangaId === item.mangaId);

    const newItem: ReadingHistoryItem = {
      ...item,
      lastReadAt: Date.now(),
    };

    if (existingIndex >= 0) {
      history.splice(existingIndex, 1);
    }
    history.unshift(newItem);

    // Keep top 30 items
    const trimmed = history.slice(0, 30);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.error('Failed to save history', e);
  }
}

export function getMangaProgress(provider: string, mangaId: string): ReadingHistoryItem | null {
  const history = getStoredHistory();
  return history.find((h) => h.provider === provider && h.mangaId === mangaId) || null;
}
