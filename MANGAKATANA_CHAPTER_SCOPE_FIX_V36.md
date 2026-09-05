# MangaKatana chapter-scope fix v36

## Problem

The MangaKatana detail page can contain chapter links for the selected manga as well as links from recommended/latest/related manga. The previous parser scanned the entire HTML and accepted any link matching `/manga/*/c*`, so unrelated chapters could be merged into the selected series.

Example symptom: `2013 - Dawn of the World` showing chapter numbers such as 3846, 289, 259, etc.

## Fix

`providers/mangakatana-provider.ts` now parses the manga slug from every chapter URL and only accepts the link when that slug exactly matches the requested `mangaId`.

For manga id:

`2013-dawn-of-the-world.21210`

Accepted:

`/manga/2013-dawn-of-the-world.21210/c3.2`

Rejected:

`/manga/another-series.999/c3846`

The existing duplicate-ID check and descending chapter-number sort are preserved.

## Test

A synthetic HTML fixture containing four correct chapter links and four unrelated chapter links was parsed. The provider returned only the four links belonging to the selected manga.

## package-lock note

No dependencies changed in v36. The full v36 archive intentionally omits `package-lock.json` so it does not overwrite the working lockfile already fixed in your GitHub repository. Keep your current working `package-lock.json` when copying this update into the repo.
