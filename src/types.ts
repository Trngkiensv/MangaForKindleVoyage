export interface MangaAttributes {
  title: Record<string, string>;
  altTitles: Record<string, string>[];
  description: Record<string, string>;
  isLocked: boolean;
  links: Record<string, string>;
  originalLanguage: string;
  lastVolume: string;
  lastChapter: string;
  publicationDemographic: string | null;
  status: string;
  year: number | null;
  contentRating: string;
  tags: Tag[];
  state: string;
  chapterNumbersResetOnNewVolume: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
  availableTranslatedLanguages: string[];
  latestUploadedChapter: string;
}

export interface Tag {
  id: string;
  type: string;
  attributes: {
    name: Record<string, string>;
    description: Record<string, string>;
    group: string;
    version: number;
  };
}

export interface Relationship {
  id: string;
  type: string;
  related?: string;
  attributes?: Record<string, any>;
}

export interface Manga {
  id: string;
  type: 'manga';
  attributes: MangaAttributes;
  relationships: Relationship[];
}

export interface ChapterAttributes {
  volume: string | null;
  chapter: string | null;
  title: string | null;
  language: string;
  externalUrl: string | null;
  publishAt: string;
  readableAt: string;
  createdAt: string;
  updatedAt: string;
  pages: number;
  version: number;
}

export interface Chapter {
  id: string;
  type: 'chapter';
  attributes: ChapterAttributes;
  relationships: Relationship[];
}

export interface ChapterPagesResponse {
  result: 'ok' | 'error';
  pages: string[];
  dataSaverPages: string[];
}

export interface SearchMangaParams {
  title?: string;
  limit?: number;
  offset?: number;
  includedTags?: string[];
  excludedTags?: string[];
  status?: string[];
  originalLanguage?: string[];
  availableTranslatedLanguage?: string[];
  publicationDemographic?: string[];
  contentRating?: string[];
  order?: Record<string, 'asc' | 'desc'>;
}

export interface ReaderSettings {
  eInkMode: boolean; // Pure high contrast black & white, no smooth transitions
  dataSaver: boolean; // Use MangaDex dataSaver (lower size, faster on Kindle)
  imageFit: 'width' | 'height' | 'screen' | 'original'; // Scaling preference
  readingDirection: 'ltr' | 'rtl'; // Left to right or right to left
  contrastFilter: 'normal' | 'high' | 'ultra' | 'invert'; // Image contrast adjustment
  grayscaleImages: boolean; // Force grayscale
  preferredLanguages: string[]; // e.g. ['vi', 'en']
  fullScreenReader: boolean; // Hide extra UI in reader for maximum space
  tapZoneMode: 'standard' | 'reversed'; // Tap side mapping
  preloadPages: number; // 1, 2, or 3 pages ahead
}

export interface Bookmark {
  mangaId: string;
  title: string;
  coverUrl: string | null;
  updatedAt: number;
}

export interface ReadingHistoryItem {
  mangaId: string;
  mangaTitle: string;
  coverUrl: string | null;
  chapterId: string;
  chapterNumber: string;
  chapterTitle?: string;
  pageIndex: number;
  totalPages: number;
  lastReadAt: number;
}
