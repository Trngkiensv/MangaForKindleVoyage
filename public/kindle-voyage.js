(function () {
    "use strict";

    // Set immediately so the Kindle HTML boot watchdog knows the external
    // script was successfully parsed and began executing.
    window.__kindleVoyageScriptStarted = true;

    var state = {
        currentManga: null,
        chapters: [],
        currentChapter: null,
        currentChapterId: "",
        currentChapterGlobalIndex: -1,
        chapterNavigationLoading: false,
        chapterOffset: 0,
        chapterLimit: 40,
        chapterTotal: 0,
        chapterLoading: false,
        pagesSaver: [],
        pagesOriginal: [],
        pageIndex: 0,
        fitMode: "page",
        zoomPercent: 100,
        readerPanelOpen: false,
        quality: "saver",
        translationAvailable: false,
        translationEnabled: false,
        translationData: null,
        translationLoading: false,
        translationError: "",
        translationRequestSerial: 0,
        translationPrefetchAhead: 3,
        preloadImages: [],
        preloadCount: 2,
        loading: false
    };

    var BOOKMARKS_KEY = "kindle_voyage_es5_bookmarks_v2";
    var HISTORY_KEY = "kindle_voyage_es5_history_v3";
    var PROGRESS_KEY = "kindle_voyage_es5_progress_v3";
    var SETTINGS_KEY = "kindle_voyage_es5_reader_settings_v3";

    function el(id) {
        return document.getElementById(id);
    }

    function text(value) {
        if (value === null || typeof value === "undefined") return "";
        return String(value);
    }

    function trim(value) {
        return text(value).replace(/^\s+|\s+$/g, "");
    }

    function escapeHtml(value) {
        return text(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function setStatus(message, isError) {
        var node = el("status");
        if (!node) return;
        node.className = isError ? "status status-error" : "status";
        node.innerHTML = escapeHtml(message);
    }

    function leaveReaderMode() {
        // Leaving the reader makes warmed translation pages unnecessary. Drop
        // any not-yet-started jobs so they cannot spend OCR/LLM quota later.
        if (state.currentChapterId) cancelTranslationPrefetch(state.currentChapterId);
        document.body.className = "";
    }

    function showHtml(html) {
        el("view").innerHTML = html;
        window.scrollTo(0, 0);
    }

    function xhrGet(url, done) {
        var req;
        try {
            req = new XMLHttpRequest();
            req.open("GET", url, true);
            req.onreadystatechange = function () {
                if (req.readyState !== 4) return;
                if (req.status >= 200 && req.status < 300) {
                    var data;
                    try {
                        data = JSON.parse(req.responseText);
                    } catch (parseErr) {
                        done("Server returned invalid JSON", null);
                        return;
                    }
                    done(null, data);
                } else {
                    var errorMessage = "HTTP " + req.status + " while loading data";
                    try {
                        var errorData = JSON.parse(req.responseText || "{}");
                        if (errorData && errorData.error)
                            errorMessage += ": " + errorData.error;
                    } catch (ignoreErrorJson) {}
                    done(errorMessage, null);
                }
            };
            req.onerror = function () {
                done("Network request failed", null);
            };
            req.send(null);
        } catch (err) {
            done("Browser request error: " + (err.message || err), null);
        }
    }

    function loadStore(key) {
        try {
            var raw = window.localStorage ? localStorage.getItem(key) : null;
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function loadObject(key) {
        try {
            var raw = window.localStorage ? localStorage.getItem(key) : null;
            var parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function saveStore(key, value) {
        try {
            if (window.localStorage)
                localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {}
    }

    function loadReaderSettings() {
        var s = loadObject(SETTINGS_KEY);
        if (
            s.fitMode === "page" ||
            s.fitMode === "width" ||
            s.fitMode === "zoom"
        )
            state.fitMode = s.fitMode;
        if (s.quality === "saver" || s.quality === "original")
            state.quality = s.quality;
        if (s.zoomPercent && !isNaN(parseInt(s.zoomPercent, 10)))
            state.zoomPercent = parseInt(s.zoomPercent, 10);
        // Translation is intentionally OFF on every fresh app start/session.
        // Do not restore an old VI ON value from localStorage: this prevents
        // OCR.Space / Cloudflare usage until the reader explicitly enables VI.
        state.translationEnabled = false;
    }

    function saveReaderSettings() {
        saveStore(SETTINGS_KEY, {
            fitMode: state.fitMode,
            quality: state.quality,
            zoomPercent: state.zoomPercent
        });
    }

    function getTitle(manga) {
        var a = manga && manga.attributes ? manga.attributes : {};
        var t = a.title || {};
        return (
            t.vi ||
            t.en ||
            t["ja-ro"] ||
            t.ja ||
            firstObjectValue(t) ||
            "Untitled Manga"
        );
    }

    function firstObjectValue(obj) {
        var k;
        for (k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k])
                return obj[k];
        }
        return "";
    }

    function getDescription(manga) {
        var a = manga && manga.attributes ? manga.attributes : {};
        var d = a.description || {};
        return d.vi || d.en || firstObjectValue(d) || "";
    }

    function getCover(manga) {
        var rels = manga && manga.relationships ? manga.relationships : [];
        var i, rel, fileName, direct;
        for (i = 0; i < rels.length; i += 1) {
            rel = rels[i];
            if (
                rel &&
                rel.type === "cover_art" &&
                rel.attributes
            ) {
                direct = rel.attributes.url || rel.attributes.coverUrl || "";
                if (direct) return "/api/image-proxy?url=" + encodeURIComponent(direct);
                fileName = rel.attributes.fileName;
                if (!fileName) return "";
                direct =
                    "https://uploads.mangadex.org/covers/" +
                    manga.id +
                    "/" +
                    fileName +
                    ".256.jpg";
                return "/api/image-proxy?url=" + encodeURIComponent(direct);
            }
        }
        return "";
    }

    function mangaQuery(title) {
        var q = [];
        q.push("limit=20");
        q.push("offset=0");
        q.push("contentRating%5B%5D=safe");
        q.push("contentRating%5B%5D=suggestive");
        q.push("includes%5B%5D=cover_art");
        q.push("order%5BfollowedCount%5D=desc");
        if (title) q.push("title=" + encodeURIComponent(title));
        return "/api/provider/search?" + q.join("&");
    }

    function renderMangaList(items, heading) {
        leaveReaderMode();
        var html = '<div class="heading">' + escapeHtml(heading) + "</div>";
        var i, m, cover, desc, title;
        if (!items || !items.length) {
            showHtml(html + '<div class="notice">No manga found.</div>');
            return;
        }
        for (i = 0; i < items.length; i += 1) {
            m = items[i];
            title = getTitle(m);
            cover = getCover(m);
            desc = getDescription(m);
            if (desc.length > 180) desc = desc.substring(0, 180) + "...";
            html += '<div class="manga-item">';
            html += '<div class="cover-wrap">';
            if (cover)
                html +=
                    '<img class="cover" src="' +
                    escapeHtml(cover) +
                    '" alt="cover">';
            html += "</div>";
            html += '<div class="manga-info">';
            html += '<div class="manga-title">' + escapeHtml(title) + "</div>";
            html += '<div class="description">' + escapeHtml(desc) + "</div>";
            html +=
                '<button type="button" class="btn btn-dark open-manga" data-index="' +
                i +
                '">Open</button>';
            html += '</div><div class="clear"></div></div>';
        }
        showHtml(html);
        bindMangaButtons(items);
    }

    function bindMangaButtons(items) {
        var buttons = document.getElementsByTagName("button");
        var i, b, idx;
        for (i = 0; i < buttons.length; i += 1) {
            b = buttons[i];
            if ((" " + b.className + " ").indexOf(" open-manga ") !== -1) {
                idx = parseInt(b.getAttribute("data-index"), 10);
                b.onclick = makeOpenHandler(items[idx]);
            }
        }
    }

    function makeOpenHandler(manga) {
        return function () {
            // Search responses are intentionally lightweight. Fetch the full
            // manga page before opening details so title/description/metadata
            // are not limited to the search-card payload.
            if (manga && manga.id) loadMangaById(manga.id);
        };
    }

    function loadHome() {
        leaveReaderMode();
        setStatus("Loading popular manga...", false);
        showHtml(
            '<div class="heading">Browse Manga</div><div class="notice">Loading...</div>'
        );
        xhrGet(mangaQuery(""), function (err, json) {
            if (err) {
                setStatus(err, true);
                showHtml(
                    '<div class="heading">Browse Manga</div><div class="notice">Could not load provider. Try again.</div>'
                );
                return;
            }
            setStatus(
                "Provider connected. " +
                    ((json.data && json.data.length) || 0) +
                    " titles loaded.",
                false
            );
            renderMangaList(json.data || [], "Browse Manga");
        });
    }

    function doSearch() {
        leaveReaderMode();
        var query = trim(el("search").value);
        var uuidMatch, urlMatch;
        if (!query) {
            loadHome();
            return;
        }
        uuidMatch = query.match(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
        urlMatch = query.match(
            /mangadex\.org\/(?:title|manga)\/([0-9a-f-]{36})/i
        );
        if (!urlMatch) {
            urlMatch = query.match(/weebcentral\.com\/series\/([^\/?#]+)/i);
        }
        if (uuidMatch) {
            loadMangaById(query);
            return;
        }
        if (urlMatch && urlMatch[1]) {
            loadMangaById(urlMatch[1]);
            return;
        }

        setStatus('Searching for "' + query + '"...', false);
        showHtml(
            '<div class="heading">Search</div><div class="notice">Loading...</div>'
        );
        xhrGet(mangaQuery(query), function (err, json) {
            if (err) {
                setStatus(err, true);
                showHtml(
                    '<div class="heading">Search</div><div class="notice">Search failed.</div>'
                );
                return;
            }
            setStatus("Search complete.", false);
            renderMangaList(json.data || [], "Search: " + query);
        });
    }

    function loadMangaById(id) {
        leaveReaderMode();
        setStatus("Loading manga...", false);
        xhrGet(
            "/api/provider/manga/" +
                encodeURIComponent(id) +
                "?includes%5B%5D=cover_art",
            function (err, json) {
                if (err || !json || !json.id) {
                    setStatus(err || "Manga not found", true);
                    return;
                }
                openManga(json);
            }
        );
    }

    function openManga(manga) {
        leaveReaderMode();
        state.currentManga = manga;
        state.chapters = [];
        state.chapterOffset = 0;
        state.chapterTotal = 0;
        state.chapterLoading = false;
        renderMangaDetail(manga, true);
        loadChapters(manga.id, 0);
    }

    function getVisibleChapters() {
        return state.chapters || [];
    }

    function getChapterStats(chapters) {
        var unique = {};
        var uniqueCount = 0;
        var highest = null;
        var i, a, chapterText, n;
        for (i = 0; i < chapters.length; i += 1) {
            a = chapters[i].attributes || {};
            chapterText = trim(a.chapter || a.volume || "");
            if (chapterText && !unique[chapterText]) {
                unique[chapterText] = true;
                uniqueCount += 1;
            }
            if (chapterText) {
                n = parseFloat(chapterText);
                if (!isNaN(n) && (highest === null || n > highest)) highest = n;
            }
        }
        return {
            releases: chapters.length,
            unique: uniqueCount,
            highest: highest
        };
    }

    function renderMangaDetail(manga, loadingChapters) {
        leaveReaderMode();
        var title = getTitle(manga);
        var desc = getDescription(manga);
        var cover = getCover(manga);
        var saved = isSaved(manga.id);
        var visibleChapters = getVisibleChapters();
        var total = state.chapterTotal || visibleChapters.length;
        var startNumber = visibleChapters.length ? state.chapterOffset + 1 : 0;
        var endNumber = state.chapterOffset + visibleChapters.length;
        var pageCount = total ? Math.ceil(total / state.chapterLimit) : 0;
        var pageNumber = total ? Math.floor(state.chapterOffset / state.chapterLimit) + 1 : 0;
        var html = '<div class="heading">' + escapeHtml(title) + "</div>";
        if (cover)
            html +=
                '<div class="center"><img class="cover" style="width:160px" src="' +
                escapeHtml(cover) +
                '" alt="cover"></div>';
        html += '<div class="description">' + escapeHtml(desc) + "</div>";
        html +=
            '<button id="bookmarkCurrent" type="button" class="btn btn-dark">' +
            (saved ? "Remove saved" : "Save manga") +
            "</button>";
        html +=
            '<button id="backHome" type="button" class="btn">Back home</button>';
        html += '<div class="heading" style="margin-top:14px">Chapters</div>';
        if (loadingChapters) {
            html += '<div class="notice">Loading chapter page...</div>';
        } else {
            html += '<div class="chapter-summary"><b>Total:</b> ' + total + " releases";
            if (visibleChapters.length) {
                html += " &nbsp; <b>Showing:</b> " + startNumber + "-" + endNumber;
                if (pageCount > 1) html += " &nbsp; <b>Page:</b> " + pageNumber + "/" + pageCount;
            }
            html += "</div>";
            if (pageCount > 1) html += renderChapterPager(pageNumber, pageCount);
            html += renderChapterHtml(visibleChapters);
            if (pageCount > 1) html += renderChapterPager(pageNumber, pageCount);
        }
        showHtml(html);
        el("backHome").onclick = loadHome;
        el("bookmarkCurrent").onclick = function () {
            toggleSaved(manga);
            renderMangaDetail(manga, false);
        };
        if (!loadingChapters) {
            bindChapterButtons();
            bindChapterPager();
        }
    }

    function renderChapterPager(pageNumber, pageCount) {
        var html = '<div class="chapter-pager">';
        html += '<button type="button" class="btn chapter-first">First</button>';
        html += '<button type="button" class="btn chapter-prev">Prev</button>';
        html += '<span class="chapter-page-word">Page</span>';
        html += '<input type="text" class="chapter-page-input" value="' + pageNumber + '" maxlength="5">';
        html += '<span class="chapter-page-total">/ ' + pageCount + '</span>';
        html += '<button type="button" class="btn chapter-go">Go</button>';
        html += '<button type="button" class="btn chapter-next">Next</button>';
        html += '<button type="button" class="btn chapter-last">Last</button>';
        html += "</div>";
        return html;
    }

    function chapterFeedUrl(mangaId, offset, limit) {
        return (
            "/api/provider/manga/" +
            encodeURIComponent(mangaId) +
            "/chapters?limit=" +
            limit +
            "&offset=" +
            offset +
            "&order%5Bchapter%5D=desc&contentRating%5B%5D=safe&contentRating%5B%5D=suggestive&contentRating%5B%5D=erotica"
        );
    }

    function loadChapters(mangaId, offset) {
        var requestedOffset = parseInt(offset, 10);
        if (isNaN(requestedOffset) || requestedOffset < 0) requestedOffset = 0;
        if (state.chapterLoading) return;
        state.chapterLoading = true;
        setStatus("Loading chapter page...", false);
        xhrGet(chapterFeedUrl(mangaId, requestedOffset, state.chapterLimit), function (err, json) {
            var data, total, startNumber, endNumber;
            state.chapterLoading = false;
            if (err) {
                setStatus(err, true);
                if (!state.chapters.length) {
                    state.chapterTotal = 0;
                    renderMangaDetail(state.currentManga, false);
                }
                return;
            }
            data = json && json.data ? json.data : [];
            total = json && typeof json.total !== "undefined" ? parseInt(json.total, 10) : data.length;
            if (isNaN(total) || total < data.length) total = data.length;
            state.chapters = data;
            state.chapterTotal = total;
            state.chapterOffset = requestedOffset;
            startNumber = data.length ? requestedOffset + 1 : 0;
            endNumber = requestedOffset + data.length;
            setStatus(
                data.length
                    ? "Showing chapter releases " + startNumber + "-" + endNumber + " of " + total + "."
                    : "No chapter releases on this page.",
                false
            );
            renderMangaDetail(state.currentManga, false);
        });
    }

    function chapterPageCount() {
        if (!state.chapterTotal || !state.chapterLimit) return 0;
        return Math.ceil(state.chapterTotal / state.chapterLimit);
    }

    function jumpToChapterPage(input) {
        var pageCount = chapterPageCount();
        var pageNumber;
        var offset;
        if (!input || !pageCount) return;
        pageNumber = parseInt(input.value, 10);
        if (isNaN(pageNumber)) pageNumber = 1;
        if (pageNumber < 1) pageNumber = 1;
        if (pageNumber > pageCount) pageNumber = pageCount;
        input.value = pageNumber;
        offset = (pageNumber - 1) * state.chapterLimit;
        if (offset !== state.chapterOffset) loadChapters(state.currentManga.id, offset);
    }

    function makeChapterGoHandler(input) {
        return function () {
            jumpToChapterPage(input);
        };
    }

    function makeChapterInputKeyHandler(input) {
        return function (event) {
            var e = event || window.event;
            var code = e ? e.keyCode || e.which : 0;
            if (code === 13) {
                jumpToChapterPage(input);
                return false;
            }
            return true;
        };
    }

    function bindChapterPager() {
        var buttons = document.getElementsByTagName("button");
        var inputs = document.getElementsByTagName("input");
        var i, b, input, nextOffset, lastOffset, parentInputs;
        for (i = 0; i < buttons.length; i += 1) {
            b = buttons[i];
            if ((" " + b.className + " ").indexOf(" chapter-first ") !== -1) {
                b.onclick = function () { loadChapters(state.currentManga.id, 0); };
            } else if ((" " + b.className + " ").indexOf(" chapter-prev ") !== -1) {
                b.onclick = function () {
                    nextOffset = state.chapterOffset - state.chapterLimit;
                    if (nextOffset < 0) nextOffset = 0;
                    if (nextOffset !== state.chapterOffset) loadChapters(state.currentManga.id, nextOffset);
                };
            } else if ((" " + b.className + " ").indexOf(" chapter-next ") !== -1) {
                b.onclick = function () {
                    nextOffset = state.chapterOffset + state.chapterLimit;
                    if (nextOffset < state.chapterTotal) loadChapters(state.currentManga.id, nextOffset);
                };
            } else if ((" " + b.className + " ").indexOf(" chapter-last ") !== -1) {
                b.onclick = function () {
                    if (!state.chapterTotal) return;
                    lastOffset = Math.floor((state.chapterTotal - 1) / state.chapterLimit) * state.chapterLimit;
                    if (lastOffset !== state.chapterOffset) loadChapters(state.currentManga.id, lastOffset);
                };
            } else if ((" " + b.className + " ").indexOf(" chapter-go ") !== -1) {
                parentInputs = b.parentNode ? b.parentNode.getElementsByTagName("input") : [];
                if (parentInputs && parentInputs.length) b.onclick = makeChapterGoHandler(parentInputs[0]);
            }
        }
        for (i = 0; i < inputs.length; i += 1) {
            input = inputs[i];
            if ((" " + input.className + " ").indexOf(" chapter-page-input ") !== -1) {
                input.onkeypress = makeChapterInputKeyHandler(input);
            }
        }
    }

    function renderChapterHtml(chapters) {
        var html = "";
        var i, ch, a, label, lang, external;
        if (!chapters || !chapters.length)
            return '<div class="notice">No chapters found.</div>';
        for (i = 0; i < chapters.length; i += 1) {
            ch = chapters[i];
            a = ch.attributes || {};
            if (a.chapter) label = "Ch. " + a.chapter;
            else if (a.volume) label = "Vol. " + a.volume;
            else label = "Oneshot";
            if (a.title && !a.volume) label += ": " + a.title;
            lang = a.translatedLanguage || a.language || "";
            external = a.externalUrl ? " [External]" : "";
            html +=
                '<button type="button" class="chapter chapter-open" data-index="' +
                i +
                '">';
            html +=
                '<span class="chapter-main">' +
                escapeHtml(label) +
                external +
                "</span>";
            if (lang) {
                html +=
                    '<span class="chapter-meta">' +
                    escapeHtml(lang.toUpperCase()) +
                    "</span>";
            }
            html += "</button>";
        }
        return html;
    }

    function bindChapterButtons() {
        var chapters = getVisibleChapters();
        var buttons = document.getElementsByTagName("button");
        var i, b, idx;
        for (i = 0; i < buttons.length; i += 1) {
            b = buttons[i];
            if ((" " + b.className + " ").indexOf(" chapter-open ") !== -1) {
                idx = parseInt(b.getAttribute("data-index"), 10);
                b.onclick = makeChapterHandler(chapters[idx], state.chapterOffset + idx);
            }
        }
    }

    function makeChapterHandler(chapter, globalIndex) {
        return function () {
            state.currentChapterGlobalIndex = typeof globalIndex === "number" ? globalIndex : -1;
            openChapter(chapter);
        };
    }

    function chapterNumberText(chapter) {
        var a = chapter && chapter.attributes ? chapter.attributes : {};
        return trim(a.chapter || a.volume || "");
    }

    function chapterMatchesNumber(chapter, wanted) {
        var actual = chapterNumberText(chapter);
        var aNum, wNum;
        wanted = trim(wanted);
        if (!actual || !wanted) return false;
        if (actual.toLowerCase() === wanted.toLowerCase()) return true;
        aNum = parseFloat(actual);
        wNum = parseFloat(wanted);
        return !isNaN(aNum) && !isNaN(wNum) && aNum === wNum;
    }

    function setReaderMessage(message) {
        var title = el("readerTitle");
        if (title) title.innerHTML = escapeHtml(message);
        else setStatus(message, false);
    }

    function fetchChapterSlice(offset, limit, done) {
        if (!state.currentManga || !state.currentManga.id) {
            done("No manga selected", [], 0);
            return;
        }
        xhrGet(chapterFeedUrl(state.currentManga.id, offset, limit), function (err, json) {
            var data = json && json.data ? json.data : [];
            var total = json && typeof json.total !== "undefined" ? parseInt(json.total, 10) : data.length;
            if (isNaN(total) || total < data.length) total = data.length;
            if (!err) state.chapterTotal = total;
            done(err, data, total);
        });
    }

    function openChapterAtGlobalIndex(index) {
        if (state.chapterNavigationLoading) return;
        if (index < 0) {
            setReaderMessage("Already at newest chapter.");
            return;
        }
        state.chapterNavigationLoading = true;
        setReaderMessage("Loading chapter...");
        fetchChapterSlice(index, 1, function (err, data, total) {
            state.chapterNavigationLoading = false;
            if (err) {
                setReaderMessage(err);
                return;
            }
            if (index >= total || !data.length) {
                setReaderMessage("No chapter at that position.");
                return;
            }
            state.currentChapterGlobalIndex = index;
            openChapter(data[0]);
        });
    }

    function resolveCurrentChapterIndex(done) {
        var chunkSize = 100;
        var targetId = state.currentChapterId;
        if (state.currentChapterGlobalIndex >= 0) {
            done(null, state.currentChapterGlobalIndex);
            return;
        }
        function scan(offset) {
            fetchChapterSlice(offset, chunkSize, function (err, data, total) {
                var i;
                if (err) {
                    done(err, -1);
                    return;
                }
                for (i = 0; i < data.length; i += 1) {
                    if (data[i] && data[i].id === targetId) {
                        state.currentChapterGlobalIndex = offset + i;
                        done(null, state.currentChapterGlobalIndex);
                        return;
                    }
                }
                if (offset + data.length >= total || !data.length) {
                    done("Current chapter was not found in the series list.", -1);
                    return;
                }
                scan(offset + chunkSize);
            });
        }
        scan(0);
    }

    function openRelativeChapter(indexDelta) {
        if (state.chapterNavigationLoading) return;
        state.chapterNavigationLoading = true;
        setReaderMessage("Finding adjacent chapter...");
        resolveCurrentChapterIndex(function (err, index) {
            var target;
            state.chapterNavigationLoading = false;
            if (err) {
                setReaderMessage(err);
                return;
            }
            target = index + indexDelta;
            if (target < 0) {
                setReaderMessage("Already at newest chapter.");
                return;
            }
            if (state.chapterTotal && target >= state.chapterTotal) {
                setReaderMessage("Already at oldest chapter.");
                return;
            }
            openChapterAtGlobalIndex(target);
        });
    }

    function jumpToReaderChapter(input) {
        var wanted = input ? trim(input.value) : "";
        var chunkSize = 100;
        if (!wanted || state.chapterNavigationLoading) return;
        state.chapterNavigationLoading = true;
        setReaderMessage("Finding chapter " + wanted + "...");
        function scan(offset) {
            fetchChapterSlice(offset, chunkSize, function (err, data, total) {
                var i;
                if (err) {
                    state.chapterNavigationLoading = false;
                    setReaderMessage(err);
                    return;
                }
                for (i = 0; i < data.length; i += 1) {
                    if (chapterMatchesNumber(data[i], wanted)) {
                        state.chapterNavigationLoading = false;
                        state.currentChapterGlobalIndex = offset + i;
                        openChapter(data[i]);
                        return;
                    }
                }
                if (offset + data.length >= total || !data.length) {
                    state.chapterNavigationLoading = false;
                    setReaderMessage("Chapter " + wanted + " not found.");
                    return;
                }
                scan(offset + chunkSize);
            });
        }
        scan(0);
    }

    function makeReaderChapterKeyHandler(input) {
        return function (event) {
            var e = event || window.event;
            var code = e ? e.keyCode || e.which : 0;
            if (code === 13) {
                jumpToReaderChapter(input);
                return false;
            }
            return true;
        };
    }

    function getSavedPage(chapterId, pageCount) {
        var progress = loadObject(PROGRESS_KEY);
        var item = progress[chapterId];
        var p =
            item && typeof item.pageIndex !== "undefined"
                ? parseInt(item.pageIndex, 10)
                : 0;
        if (isNaN(p) || p < 0) p = 0;
        if (pageCount && p >= pageCount) p = pageCount - 1;
        return p;
    }

    function savePageProgress() {
        var progress, keys, k, oldestKey, oldestTime, count, item;
        if (!state.currentChapterId) return;
        progress = loadObject(PROGRESS_KEY);
        progress[state.currentChapterId] = {
            pageIndex: state.pageIndex,
            pageCount: currentPageCount(),
            mangaId: state.currentManga ? state.currentManga.id : "",
            when: new Date().getTime()
        };
        count = 0;
        oldestKey = "";
        oldestTime = null;
        for (k in progress) {
            if (Object.prototype.hasOwnProperty.call(progress, k)) {
                count += 1;
                item = progress[k] || {};
                if (oldestTime === null || (item.when || 0) < oldestTime) {
                    oldestTime = item.when || 0;
                    oldestKey = k;
                }
            }
        }
        if (count > 100 && oldestKey && oldestKey !== state.currentChapterId)
            delete progress[oldestKey];
        saveStore(PROGRESS_KEY, progress);
    }

    function openChapter(chapter) {
        var a, previousChapterId;
        if (!chapter) return;
        a = chapter.attributes || {};
        if (a.externalUrl) {
            setStatus(
                "This is an external chapter and cannot be proxied by the local reader.",
                true
            );
            return;
        }
        previousChapterId = state.currentChapterId;
        if (previousChapterId && previousChapterId !== chapter.id)
            cancelTranslationPrefetch(previousChapterId);
        state.currentChapter = chapter;
        state.currentChapterId = chapter.id;
        state.pagesSaver = [];
        state.pagesOriginal = [];
        state.pageIndex = 0;
        state.readerPanelOpen = false;
        state.translationData = null;
        state.translationLoading = false;
        state.translationError = "";
        state.translationRequestSerial += 1;
        state.preloadImages = [];
        rememberHistory(chapter);
        setStatus("Loading chapter pages...", false);
        showHtml(
            '<div class="heading">Reader</div><div class="notice">Loading page list...</div>'
        );
        xhrGet(
            "/api/provider/chapter/" + encodeURIComponent(chapter.id) + "/pages",
            function (err, json) {
                var saverFiles, originalFiles, i;
                if (err || !json || !json.pages) {
                    setStatus(err || "Invalid chapter response", true);
                    showHtml(
                        '<div class="notice">Could not load this chapter.</div><button id="readerBack" class="btn">Back</button>'
                    );
                    el("readerBack").onclick = function () {
                        renderMangaDetail(state.currentManga, false);
                    };
                    return;
                }
                saverFiles = json.dataSaverPages || [];
                originalFiles = json.pages || [];
                for (i = 0; i < originalFiles.length; i += 1) {
                    state.pagesOriginal.push(
                        "/api/image-proxy?url=" + encodeURIComponent(originalFiles[i])
                    );
                }
                for (i = 0; i < saverFiles.length; i += 1) {
                    state.pagesSaver.push(
                        "/api/image-proxy?url=" + encodeURIComponent(saverFiles[i])
                    );
                }
                if (!currentPageCount()) {
                    setStatus("No pages in chapter.", true);
                    return;
                }
                state.pageIndex = getSavedPage(chapter.id, currentPageCount());
                setStatus("Reader ready.", false);
                renderReader();
            }
        );
    }

    function currentPageCount() {
        if (state.quality === "original" && state.pagesOriginal.length)
            return state.pagesOriginal.length;
        if (state.pagesSaver.length) return state.pagesSaver.length;
        return state.pagesOriginal.length;
    }

    function currentPageUrl(index) {
        if (state.quality === "original" && state.pagesOriginal.length)
            return state.pagesOriginal[index] || "";
        if (state.pagesSaver.length) return state.pagesSaver[index] || "";
        return state.pagesOriginal[index] || "";
    }

    function currentChapterLabel() {
        var a =
            state.currentChapter && state.currentChapter.attributes
                ? state.currentChapter.attributes
                : {};
        if (a.chapter) return "Ch. " + a.chapter;
        if (a.volume) return "Vol. " + a.volume;
        return "Oneshot";
    }

    function renderReader() {
        var html;
        var currentNumber = chapterNumberText(state.currentChapter);
        document.body.className = "reader-active";
        html = '<div class="reader">';
        html += '<div id="readerControlShell" class="reader-control-shell">';
        html += '<button id="readerPanelToggle" class="reader-panel-toggle" type="button">Controls v</button>';
        html += '<div id="readerPanelBody" class="reader-panel-body">';
        html += '<div class="reader-nav-row reader-panel-row">';
        html += '<button id="readerClose" class="btn reader-big reader-chapters-btn" type="button">Chapters</button>';
        html += '</div>';
        html += '<div class="reader-chapter-nav reader-panel-row">';
        html += '<button id="prevChapter" class="btn reader-chapter-btn" type="button">Prev Chapter</button>';
        html += '<input id="readerChapterInput" class="reader-chapter-input" type="text" value="' + escapeHtml(currentNumber) + '" maxlength="10">';
        html += '<button id="readerChapterGo" class="btn reader-chapter-go" type="button">Go</button>';
        html += '<button id="nextChapter" class="btn btn-dark reader-chapter-btn" type="button">Next Chapter</button>';
        html += '</div>';
        html += '<div class="reader-nav-row reader-panel-row">';
        html += '<button id="fitPage" class="btn reader-control-big" type="button">Fit page</button>';
        html += '<button id="fitWidth" class="btn reader-control-big" type="button">Fit width</button>';
        html += '<button id="qualityBtn" class="btn reader-control-big" type="button">Saver</button>';
        html += '</div>';
        html += '<div class="reader-nav-row reader-panel-row">';
        html += '<button id="zoomOut" class="btn reader-control-big" type="button">Zoom -</button>';
        html += '<span id="zoomLabel" class="zoom-label zoom-label-big">100%</span>';
        html += '<button id="zoomIn" class="btn reader-control-big" type="button">Zoom +</button>';
        html += '</div>';
        html += '<div id="translationStatus" class="translation-status"></div>';
        html += '<div id="readerTitle" class="reader-title"></div>';
        html += '<div id="pageCounter" class="page-counter"></div>';
        html += '</div></div>';
        html += '<div id="readerControlSpacer" class="reader-control-spacer"></div>';
        html += '<div id="readerSideRail" class="reader-side-rail">';
        html += '<button id="translationBtn" class="reader-side-translate" type="button">VI</button>';
        html += '<button id="prevPageSide" class="reader-side-prev" type="button"><span>PREV<br>PAGE</span></button>';
        html += '</div>';
        html += '<div id="pageFrame" class="page-frame"><div id="pageStage" class="page-stage"><img id="pageImage" class="page-image" alt="manga page"><div id="translationLayer" class="translation-layer"></div></div></div>';
        html += '</div>';
        showHtml(html);
        el("readerPanelToggle").onclick = toggleReaderPanel;
        el("readerClose").onclick = function () {
            renderMangaDetail(state.currentManga, false);
        };
        el("prevPageSide").onclick = prevPage;
        el("prevChapter").onclick = function () { openRelativeChapter(1); };
        el("nextChapter").onclick = function () { openRelativeChapter(-1); };
        el("readerChapterGo").onclick = function () { jumpToReaderChapter(el("readerChapterInput")); };
        el("readerChapterInput").onkeypress = makeReaderChapterKeyHandler(el("readerChapterInput"));
        el("fitPage").onclick = function () {
            state.fitMode = "page";
            saveReaderSettings();
            applyReaderFit();
            updateReaderControls();
        };
        el("fitWidth").onclick = function () {
            state.fitMode = "width";
            state.zoomPercent = 100;
            saveReaderSettings();
            applyReaderFit();
            updateReaderControls();
        };
        el("zoomOut").onclick = function () { changeZoom(-10); };
        el("zoomIn").onclick = function () { changeZoom(10); };
        el("qualityBtn").onclick = toggleQuality;
        el("translationBtn").onclick = toggleTranslation;
        // Next page stays intentionally simple: tap the manga page itself.
        el("pageImage").onclick = function () { nextPage(); };
        el("pageImage").onerror = function () {
            setStatus("Image failed. Try switching Saver/HQ or tap the page again.", true);
        };
        el("pageImage").onload = function () {
            applyReaderFit();
            this.style.visibility = "visible";
            renderTranslationOverlay();
        };
        window.onresize = function () {
            if (document.body.className === "reader-active") {
                syncReaderSticky();
                applyReaderFit();
            }
        };
        updateReaderPanel();
        syncReaderSticky();
        showPage();
    }

    function syncReaderSticky() {
        var shell = el("readerControlShell");
        var spacer = el("readerControlSpacer");
        var rail = el("readerSideRail");
        var frame = el("pageFrame");
        var translateButton = el("translationBtn");
        var prevButton = el("prevPageSide");
        var shellHeight, railWidth, remainingHeight, translateHeight;
        if (!shell || !spacer) return;

        shell.style.position = "fixed";
        shell.style.top = "0px";
        shell.style.left = "0px";
        shell.style.right = "0px";
        shell.style.width = "100%";
        shell.style.zIndex = "999";
        shellHeight = Math.max(58, shell.offsetHeight || 0);
        spacer.style.height = shellHeight + "px";

        if (rail && frame) {
            railWidth = 58;
            remainingHeight = Math.max(180, viewportHeight() - shellHeight);
            translateHeight = 62;
            rail.style.position = "fixed";
            rail.style.left = "0px";
            rail.style.top = shellHeight + "px";
            rail.style.width = railWidth + "px";
            rail.style.height = remainingHeight + "px";
            rail.style.zIndex = "998";
            frame.style.marginLeft = railWidth + "px";
            frame.style.width = Math.max(100, viewportWidth() - railWidth) + "px";
            if (translateButton) translateButton.style.height = translateHeight + "px";
            if (prevButton) prevButton.style.height = Math.max(110, remainingHeight - translateHeight) + "px";
        }
    }

    function toggleReaderPanel() {
        state.readerPanelOpen = !state.readerPanelOpen;
        updateReaderPanel();
        applyReaderFit();
    }

    function updateReaderPanel() {
        var body = el("readerPanelBody");
        var toggle = el("readerPanelToggle");
        var count = currentPageCount();
        var pageText = count ? " | Page " + (state.pageIndex + 1) + "/" + count : "";
        if (body) body.style.display = state.readerPanelOpen ? "block" : "none";
        if (toggle) {
            toggle.innerHTML = (state.readerPanelOpen ? "Controls ^" : "Controls v") + pageText;
            toggle.className = state.readerPanelOpen
                ? "reader-panel-toggle reader-panel-toggle-open"
                : "reader-panel-toggle";
        }
        syncReaderSticky();
    }

    function updateReaderControls() {
        var fitPage = el("fitPage");
        var fitWidth = el("fitWidth");
        var zoomLabel = el("zoomLabel");
        var qualityBtn = el("qualityBtn");
        var translationBtn = el("translationBtn");
        var translationStatus = el("translationStatus");
        var prevPageSide = el("prevPageSide");
        var prevChapter = el("prevChapter");
        var nextChapter = el("nextChapter");
        if (fitPage)
            fitPage.className = state.fitMode === "page"
                ? "btn btn-dark reader-control-big"
                : "btn reader-control-big";
        if (fitWidth)
            fitWidth.className = state.fitMode === "width"
                ? "btn btn-dark reader-control-big"
                : "btn reader-control-big";
        if (zoomLabel)
            zoomLabel.innerHTML = state.fitMode === "zoom"
                ? state.zoomPercent + "%"
                : state.fitMode === "page" ? "PAGE" : "WIDTH";
        if (qualityBtn) qualityBtn.innerHTML = state.quality === "original" ? "HQ" : "Saver";
        if (translationBtn) {
            if (!state.translationAvailable) {
                translationBtn.innerHTML = "VI<br>N/A";
                translationBtn.className = "reader-side-translate reader-side-translate-off";
            } else if (state.translationEnabled) {
                translationBtn.innerHTML = "VI<br>ON";
                translationBtn.className = "reader-side-translate reader-side-translate-on";
            } else {
                translationBtn.innerHTML = "VI<br>OFF";
                translationBtn.className = "reader-side-translate reader-side-translate-off";
            }
        }
        if (prevPageSide) prevPageSide.disabled = state.pageIndex <= 0;
        if (prevChapter && state.currentChapterGlobalIndex >= 0 && state.chapterTotal)
            prevChapter.disabled = state.currentChapterGlobalIndex >= state.chapterTotal - 1;
        if (nextChapter && state.currentChapterGlobalIndex >= 0)
            nextChapter.disabled = state.currentChapterGlobalIndex <= 0;
        if (translationStatus) {
            if (!state.translationAvailable) translationStatus.innerHTML = "Server translation is not configured.";
            else if (!state.translationEnabled) translationStatus.innerHTML = "VI off. Tap VI on the left to enable.";
            else if (state.translationLoading) translationStatus.innerHTML = "VI: translating page...";
            else if (state.translationError) translationStatus.innerHTML = "VI: " + escapeHtml(state.translationError);
            else if (state.translationData) translationStatus.innerHTML = "VI ready: " + state.translationData.regions.length + " text regions";
            else translationStatus.innerHTML = "VI: waiting for page OCR";
        }
        updateReaderPanel();
    }

    function viewportWidth() {
        return (
            window.innerWidth ||
            document.documentElement.clientWidth ||
            document.body.clientWidth ||
            760
        );
    }

    function viewportHeight() {
        return (
            window.innerHeight ||
            document.documentElement.clientHeight ||
            document.body.clientHeight ||
            (window.screen ? screen.height : 1000) ||
            1000
        );
    }

    function applyReaderFit() {
        var img = el("pageImage");
        var frame = el("pageFrame");
        var controlShell = el("readerControlShell");
        var vw,
            vh,
            contentW,
            used,
            availableH,
            naturalW,
            naturalH,
            scale,
            targetW,
            targetH;
        if (!img || !frame) return;
        vw = viewportWidth();
        vh = viewportHeight();
        contentW = frame.clientWidth || frame.offsetWidth || Math.max(100, vw - 58);
        used = 8;
        if (controlShell) used += controlShell.offsetHeight || 0;
        availableH = vh - used;
        if (availableH < 200) availableH = Math.floor(vh * 0.68);

        img.style.maxWidth = "none";
        img.style.maxHeight = "none";
        img.style.height = "auto";

        if (state.fitMode === "width") {
            frame.style.height = "auto";
            frame.style.overflow = "visible";
            img.style.width = Math.max(100, contentW - 2) + "px";
        } else if (state.fitMode === "zoom") {
            frame.style.height = "auto";
            frame.style.overflow = "visible";
            img.style.width =
                Math.max(
                    100,
                    Math.floor(((contentW - 2) * state.zoomPercent) / 100)
                ) + "px";
        } else {
            frame.style.height = availableH + "px";
            frame.style.overflow = "hidden";
            naturalW = img.naturalWidth || img.width || 0;
            naturalH = img.naturalHeight || img.height || 0;
            if (naturalW > 0 && naturalH > 0) {
                scale = Math.min((contentW - 2) / naturalW, availableH / naturalH);
                targetW = Math.max(1, Math.floor(naturalW * scale));
                targetH = Math.max(1, Math.floor(naturalH * scale));
                img.style.width = targetW + "px";
                img.style.height = targetH + "px";
            } else {
                img.style.width = Math.max(100, contentW - 2) + "px";
            }
        }
        updateReaderControls();
        renderTranslationOverlay();
    }

    function changeZoom(delta) {
        state.fitMode = "zoom";
        state.zoomPercent += delta;
        if (state.zoomPercent < 50) state.zoomPercent = 50;
        if (state.zoomPercent > 300) state.zoomPercent = 300;
        saveReaderSettings();
        applyReaderFit();
        updateReaderControls();
    }

    function clearTranslationOverlay() {
        var layer = el("translationLayer");
        if (layer) layer.innerHTML = "";
    }

    function translationFontSize(boxWidth, boxHeight, charCount) {
        var area, size;
        if (charCount < 1) charCount = 1;
        area = Math.max(1, boxWidth * boxHeight);
        size = Math.floor(Math.sqrt(area / (charCount * 0.62)));
        if (size < 10) size = 10;
        if (size > 20) size = 20;
        return size;
    }

    function renderTranslationOverlay() {
        var layer = el("translationLayer");
        var img = el("pageImage");
        var data = state.translationData;
        var html = "";
        var i, region, box, left, top, width, height, pxW, pxH, fontSize;
        if (!layer || !img) return;
        if (!state.translationEnabled || !state.translationAvailable || !data || !data.regions) {
            layer.innerHTML = "";
            return;
        }
        if (!data.imageWidth || !data.imageHeight || !img.offsetWidth || !img.offsetHeight) return;
        for (i = 0; i < data.regions.length; i += 1) {
            region = data.regions[i] || {};
            box = region.box || {};
            left = Math.max(0, (Number(box.x || 0) * 100) / data.imageWidth);
            top = Math.max(0, (Number(box.y || 0) * 100) / data.imageHeight);
            width = Math.max(1, (Number(box.width || 1) * 100) / data.imageWidth);
            height = Math.max(1, (Number(box.height || 1) * 100) / data.imageHeight);
            if (left + width > 100) width = 100 - left;
            if (top + height > 100) height = 100 - top;
            pxW = Math.max(1, img.offsetWidth * width / 100);
            pxH = Math.max(1, img.offsetHeight * height / 100);
            fontSize = translationFontSize(pxW, pxH, text(region.translated).length);
            html += '<div class="translation-box" style="left:' + left + '%;top:' + top + '%;width:' + width + '%;min-height:' + height + '%;font-size:' + fontSize + 'px;line-height:' + Math.max(11, Math.floor(fontSize * 1.12)) + 'px;">' + escapeHtml(region.translated || region.text || "") + '</div>';
        }
        layer.innerHTML = html;
    }

    function cancelTranslationPrefetch(chapterId) {
        if (!chapterId) return;
        xhrGet(
            "/api/translation/chapter/" + encodeURIComponent(chapterId) + "/cancel-prefetch",
            function () {}
        );
    }

    function toggleTranslation() {
        if (!state.translationAvailable) {
            state.translationError = "Configure OCR.Space + Cloudflare translation on the PC server first.";
            updateReaderControls();
            return;
        }
        state.translationEnabled = !state.translationEnabled;
        // VI ON/OFF is session-only on purpose. We never persist VI ON so a
        // future browser/app start cannot accidentally spend OCR/API quota.
        if (!state.translationEnabled) {
            state.translationRequestSerial += 1;
            state.translationLoading = false;
            state.translationError = "";
            state.translationData = null;
            clearTranslationOverlay();
            cancelTranslationPrefetch(state.currentChapterId);
            updateReaderControls();
            return;
        }
        requestCurrentTranslation();
        prefetchCurrentTranslations();
        updateReaderControls();
    }

    function requestCurrentTranslation() {
        var serial, pageNumber, chapterId, url;
        if (!state.translationAvailable || !state.translationEnabled || !state.currentChapterId) return;
        serial = state.translationRequestSerial + 1;
        state.translationRequestSerial = serial;
        pageNumber = state.pageIndex + 1;
        chapterId = state.currentChapterId;
        state.translationData = null;
        state.translationError = "";
        state.translationLoading = true;
        clearTranslationOverlay();
        updateReaderControls();
        url = "/api/translation/chapter/" + encodeURIComponent(chapterId) + "/page/" + pageNumber;
        xhrGet(url, function (err, json) {
            if (serial !== state.translationRequestSerial) return;
            if (chapterId !== state.currentChapterId || pageNumber !== state.pageIndex + 1) return;
            state.translationLoading = false;
            if (err || !json || json.status !== "ready") {
                state.translationError = err || "Translation response invalid";
                state.translationData = null;
            } else {
                state.translationError = "";
                state.translationData = json;
            }
            updateReaderControls();
            renderTranslationOverlay();
        });
    }

    function prefetchCurrentTranslations() {
        var pageNumber, url;
        if (!state.translationAvailable || !state.translationEnabled || !state.currentChapterId) return;
        pageNumber = state.pageIndex + 1;
        url = "/api/translation/chapter/" + encodeURIComponent(state.currentChapterId) + "/prefetch?from=" + pageNumber + "&ahead=" + state.translationPrefetchAhead;
        xhrGet(url, function () {});
    }

    function preloadNextImages() {
        var list = [], count = currentPageCount(), i, index, image, url;
        state.preloadImages = [];
        for (i = 1; i <= state.preloadCount; i += 1) {
            index = state.pageIndex + i;
            if (index >= count) break;
            url = currentPageUrl(index);
            if (!url) continue;
            image = new Image();
            image.src = url;
            list.push(image);
        }
        state.preloadImages = list;
    }

    function toggleQuality() {
        state.quality = state.quality === "original" ? "saver" : "original";
        if (state.quality === "original" && !state.pagesOriginal.length)
            state.quality = "saver";
        saveReaderSettings();
        showPage();
    }

    function showPage() {
        var img = el("pageImage");
        var counter = el("pageCounter");
        var titleNode = el("readerTitle");
        var count = currentPageCount();
        var url;
        if (!img || !counter || !count) return;
        if (state.pageIndex < 0) state.pageIndex = 0;
        if (state.pageIndex >= count) state.pageIndex = count - 1;
        counter.innerHTML = "Page " + (state.pageIndex + 1) + " / " + count;
        if (titleNode) titleNode.innerHTML = escapeHtml(currentChapterLabel());
        url = currentPageUrl(state.pageIndex);
        state.translationData = null;
        state.translationError = "";
        clearTranslationOverlay();
        requestCurrentTranslation();
        prefetchCurrentTranslations();
        preloadNextImages();

        // Do not reset width/height to auto here. On the Voyage that causes a
        // visible 100% -> saved zoom jump while the next page is loading.
        // Hide the image, preserve/apply the requested fit first, then reveal
        // it only from onload after the final dimensions are known.
        img.style.visibility = "hidden";
        applyReaderFit();
        img.removeAttribute("src");
        img.src = url;
        savePageProgress();
        updateReaderControls();
        updateReaderPanel();
        window.scrollTo(0, 0);
    }

    function nextPage() {
        var count = currentPageCount();
        if (state.pageIndex < count - 1) {
            state.pageIndex += 1;
            showPage();
        } else {
            setStatus("End of chapter.", false);
            var bottom = el("readerBottomMessage");
            if (bottom) bottom.innerHTML = "End of chapter";
        }
    }

    function prevPage() {
        if (state.pageIndex > 0) {
            state.pageIndex -= 1;
            showPage();
        }
    }

    function isSaved(id) {
        var list = loadStore(BOOKMARKS_KEY);
        var i;
        for (i = 0; i < list.length; i += 1) if (list[i].id === id) return true;
        return false;
    }

    function toggleSaved(manga) {
        var list = loadStore(BOOKMARKS_KEY);
        var i,
            found = -1;
        for (i = 0; i < list.length; i += 1)
            if (list[i].id === manga.id) found = i;
        if (found >= 0) list.splice(found, 1);
        else list.unshift({ id: manga.id, title: getTitle(manga) });
        saveStore(BOOKMARKS_KEY, list);
    }

    function showSaved() {
        leaveReaderMode();
        var list = loadStore(BOOKMARKS_KEY);
        var html = '<div class="heading">Saved Manga</div>';
        var i;
        if (!list.length)
            html += '<div class="notice">No saved manga yet.</div>';
        for (i = 0; i < list.length; i += 1) {
            html +=
                '<button type="button" class="chapter saved-open" data-id="' +
                escapeHtml(list[i].id) +
                '">' +
                escapeHtml(list[i].title) +
                "</button>";
        }
        showHtml(html);
        bindIdButtons("saved-open");
        setStatus(list.length + " saved manga.", false);
    }

    function rememberHistory(chapter) {
        var list = loadStore(HISTORY_KEY);
        var manga = state.currentManga;
        var a = chapter.attributes || {};
        var item = {
            mangaId: manga ? manga.id : "",
            mangaTitle: manga ? getTitle(manga) : "Manga",
            chapterId: chapter.id,
            chapter: a.chapter || a.volume || "",
            isVolume: !!a.volume && !a.chapter,
            when: new Date().getTime()
        };
        var i;
        for (i = list.length - 1; i >= 0; i -= 1)
            if (list[i].chapterId === item.chapterId) list.splice(i, 1);
        list.unshift(item);
        if (list.length > 20) list = list.slice(0, 20);
        saveStore(HISTORY_KEY, list);
    }

    function showHistory() {
        leaveReaderMode();
        var list = loadStore(HISTORY_KEY);
        var progress = loadObject(PROGRESS_KEY);
        var html = '<div class="heading">Reading History</div>';
        var i, label, saved, pageText;
        if (!list.length)
            html += '<div class="notice">No reading history yet.</div>';
        for (i = 0; i < list.length; i += 1) {
            label =
                list[i].mangaTitle +
                (list[i].chapter
                    ? " - " + (list[i].isVolume ? "Vol. " : "Ch. ") + list[i].chapter
                    : "");
            saved = progress[list[i].chapterId] || {};
            pageText = typeof saved.pageIndex !== "undefined"
                ? " - Page " + (parseInt(saved.pageIndex, 10) + 1)
                : "";
            html +=
                '<button type="button" class="chapter history-open" data-manga-id="' +
                escapeHtml(list[i].mangaId) +
                '" data-chapter-id="' +
                escapeHtml(list[i].chapterId) +
                '"><span class="chapter-main">' +
                escapeHtml(label) +
                '</span><span class="chapter-meta">Resume directly' +
                escapeHtml(pageText) +
                "</span></button>";
        }
        showHtml(html);
        bindHistoryButtons();
        setStatus(list.length + " history items.", false);
    }

    function bindHistoryButtons() {
        var buttons = document.getElementsByTagName("button");
        var i, b, mangaId, chapterId;
        for (i = 0; i < buttons.length; i += 1) {
            b = buttons[i];
            if ((" " + b.className + " ").indexOf(" history-open ") !== -1) {
                mangaId = b.getAttribute("data-manga-id");
                chapterId = b.getAttribute("data-chapter-id");
                b.onclick = makeHistoryHandler(mangaId, chapterId);
            }
        }
    }

    function makeHistoryHandler(mangaId, chapterId) {
        return function () {
            setStatus("Opening saved chapter...", false);
            xhrGet("/api/provider/manga/" + encodeURIComponent(mangaId), function (mangaErr, manga) {
                if (mangaErr || !manga) {
                    setStatus(mangaErr || "Could not load manga", true);
                    return;
                }
                state.currentManga = manga;
                state.currentChapterGlobalIndex = -1;
                state.chapterTotal = 0;
                xhrGet("/api/provider/chapter/" + encodeURIComponent(chapterId), function (chapterErr, chapter) {
                    if (chapterErr || !chapter) {
                        setStatus(chapterErr || "Could not load chapter", true);
                        return;
                    }
                    openChapter(chapter);
                });
            });
        };
    }

    function bindIdButtons(className) {
        var buttons = document.getElementsByTagName("button");
        var i, b, id;
        for (i = 0; i < buttons.length; i += 1) {
            b = buttons[i];
            if (
                (" " + b.className + " ").indexOf(" " + className + " ") !== -1
            ) {
                id = b.getAttribute("data-id");
                b.onclick = makeIdHandler(id);
            }
        }
    }

    function makeIdHandler(id) {
        return function () {
            loadMangaById(id);
        };
    }

    function init() {
        window.onerror = function (message, source, lineno) {
            setStatus(
                "JavaScript error: " + message + " at line " + lineno,
                true
            );
            return false;
        };

        loadReaderSettings();
        el("searchBtn").onclick = doSearch;
        el("homeBtn").onclick = loadHome;
        el("savedBtn").onclick = showSaved;
        el("historyBtn").onclick = showHistory;
        el("search").onkeypress = function (evt) {
            evt = evt || window.event;
            if ((evt.keyCode || evt.which) === 13) doSearch();
        };

        setStatus("ES5 v16 started. VI defaults OFF; translation queue is cancelable. Testing local API...", false);
        xhrGet("/api/health", function (err) {
            if (err) {
                setStatus("Local API failed: " + err, true);
                showHtml(
                    '<div class="notice">The browser can run this app, but the local server API is not responding.</div>'
                );
                return;
            }
            xhrGet("/api/translation/status", function (translationErr, translationInfo) {
                if (!translationErr && translationInfo) {
                    state.translationAvailable = !!translationInfo.enabled;
                    state.translationPrefetchAhead = parseInt(translationInfo.prefetchAhead, 10) || 3;
                } else {
                    state.translationAvailable = false;
                }
                loadHome();
            });
        });
    }

    if (document.readyState === "loading") {
        if (document.addEventListener)
            document.addEventListener("DOMContentLoaded", init, false);
        else window.attachEvent("onload", init);
    } else {
        init();
    }
})();
