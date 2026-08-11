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
        translationPrefetchAhead: 2,
        translationPrefetchSerial: 0,
        translationPageCache: {},
        translationCacheOrder: [],
        translationCacheLimit: 5,
        preloadImages: {},
        preloadBeforeCount: 2,
        preloadAfterCount: 2,
        progressSaveTimer: null,
        progressDirty: false,
        progressDebounceMs: 2000,
        readChapterIds: {},
        authUser: null,
        authChecked: false,
        authDatabaseConfigured: false,
        resetEmailConfigured: false,
        currentMangaSaved: false,
        currentMangaSavedKnown: false,
        historyPage: 1,
        historyPages: 1,
        savedPage: 1,
        savedPages: 1,
        savedMangaIds: {},
        savedMangaKnown: {},
        booksConfigured: false,
        booksPage: 1,
        booksPages: 1,
        currentBook: null,
        currentBookSection: null,
        bookSectionIndex: 0,
        bookPageIndex: 0,
        bookPageCount: 1,
        bookLayoutTimer: null,
        bookSettingsOpen: false,
        bookFontSize: 22,
        bookLineHeight: 155,
        bookMargin: 20,
        bookLinesPerPage: 20,
        bookFont: "serif",
        bookProgressSaveTimer: null,
        bookProgressDirty: false,
        bookProgressDebounceMs: 2500,
        loading: false
    };

    // Only fixed-size reader preferences stay in Kindle localStorage.
    // Growing data (history, progress, saved manga) lives in Neon via the server.
    var LEGACY_BOOKMARKS_KEY = "kindle_voyage_es5_bookmarks_v2";
    var LEGACY_HISTORY_KEY = "kindle_voyage_es5_history_v3";
    var LEGACY_PROGRESS_KEY = "kindle_voyage_es5_progress_v3";
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
        if (document.body.className === "book-reader-active") {
            forceSaveBookProgress();
            window.onscroll = null;
            window.onresize = null;
            if (state.bookLayoutTimer) { window.clearTimeout(state.bookLayoutTimer); state.bookLayoutTimer = null; }
            if (state.bookProgressSaveTimer) {
                window.clearTimeout(state.bookProgressSaveTimer);
                state.bookProgressSaveTimer = null;
            }
        }
        // A page turn is debounced to keep the Voyage responsive, but leaving
        // the reader is a durability boundary: flush the newest page first.
        if (document.body.className === "reader-active") forceSavePageProgress();
        // Leaving the reader makes warmed translation pages unnecessary. Stop
        // the client warmup chain and drop any legacy server-side queued jobs.
        state.translationPrefetchSerial += 1;
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

    function xhrJson(method, url, payload, done) {
        var req;
        try {
            req = new XMLHttpRequest();
            req.open(method, url, true);
            req.setRequestHeader("Content-Type", "application/json");
            req.onreadystatechange = function () {
                if (req.readyState !== 4) return;
                var data = null;
                if (req.responseText) {
                    try {
                        data = JSON.parse(req.responseText);
                    } catch (ignoreParse) {}
                }
                if (req.status >= 200 && req.status < 300) {
                    done(null, data || {});
                } else {
                    var message = "HTTP " + req.status;
                    if (data && data.error) message = data.error;
                    done(message, data);
                }
            };
            req.onerror = function () { done("Network request failed", null); };
            req.send(payload === null || typeof payload === "undefined" ? null : JSON.stringify(payload));
        } catch (err) {
            done("Browser request error: " + (err.message || err), null);
        }
    }

    function xhrPost(url, payload, done) {
        xhrJson("POST", url, payload, done);
    }

    function xhrDelete(url, done) {
        xhrJson("DELETE", url, null, done);
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
        if (s.bookFontSize && !isNaN(parseInt(s.bookFontSize, 10)))
            state.bookFontSize = Math.max(14, Math.min(38, parseInt(s.bookFontSize, 10)));
        if (s.bookLineHeight && !isNaN(parseInt(s.bookLineHeight, 10)))
            state.bookLineHeight = Math.max(110, Math.min(220, parseInt(s.bookLineHeight, 10)));
        if (typeof s.bookMargin !== "undefined" && !isNaN(parseInt(s.bookMargin, 10)))
            state.bookMargin = Math.max(0, Math.min(80, Math.round(parseInt(s.bookMargin, 10) / 10) * 10));
        if (s.bookLinesPerPage && !isNaN(parseInt(s.bookLinesPerPage, 10)))
            state.bookLinesPerPage = Math.max(5, Math.min(40, parseInt(s.bookLinesPerPage, 10)));
        if (s.bookFont === "serif" || s.bookFont === "sans" || s.bookFont === "mono")
            state.bookFont = s.bookFont;
        // Translation is intentionally OFF on every fresh app start/session.
        // Do not restore an old VI ON value from localStorage: this prevents
        // OCR.Space / Cloudflare usage until the reader explicitly enables VI.
        state.translationEnabled = false;
    }

    function saveReaderSettings() {
        saveStore(SETTINGS_KEY, {
            fitMode: state.fitMode,
            quality: state.quality,
            zoomPercent: state.zoomPercent,
            bookFontSize: state.bookFontSize,
            bookLineHeight: state.bookLineHeight,
            bookMargin: state.bookMargin,
            bookLinesPerPage: state.bookLinesPerPage,
            bookFont: state.bookFont
        });
    }

    function clearLegacyGrowingStorage() {
        try {
            if (!window.localStorage) return;
            localStorage.removeItem(LEGACY_BOOKMARKS_KEY);
            localStorage.removeItem(LEGACY_HISTORY_KEY);
            localStorage.removeItem(LEGACY_PROGRESS_KEY);
        } catch (e) {}
    }

    function refreshAccountButton() {
        var button = el("accountBtn");
        if (!button) return;
        button.innerHTML = state.authUser ? escapeHtml(state.authUser.username) : "Login";
    }

    function setAuthUser(user) {
        state.authUser = user || null;
        state.authChecked = true;
        state.currentMangaSaved = false;
        state.currentMangaSavedKnown = false;
        state.readChapterIds = {};
        state.savedMangaIds = {};
        state.savedMangaKnown = {};
        refreshAccountButton();
    }

    function checkAuth(done) {
        xhrGet("/api/auth/me", function (err, json) {
            if (err || !json) {
                state.authUser = null;
                state.authChecked = true;
                state.authDatabaseConfigured = false;
                state.resetEmailConfigured = false;
            } else {
                state.authDatabaseConfigured = !!json.databaseConfigured;
                state.resetEmailConfigured = !!json.mailConfigured;
                setAuthUser(json.authenticated ? json.user : null);
            }
            refreshAccountButton();
            if (done) done();
        });
    }

    function requireLoginView(message) {
        var html = '<div class="heading">Account required</div>';
        html += '<div class="notice">' + escapeHtml(message || "Please log in to use this feature.") + '</div>';
        html += '<button id="openLoginFromNotice" type="button" class="btn btn-dark btn-wide">Login / Register</button>';
        showHtml(html);
        el("openLoginFromNotice").onclick = showAccount;
    }

    function showAccount() {
        leaveReaderMode();
        if (!state.authDatabaseConfigured) {
            showHtml('<div class="heading">Account</div><div class="notice">Account storage is not configured on the server. Add DATABASE_URL on Render.</div>');
            setStatus("Account database is not configured.", true);
            return;
        }
        if (state.authUser) {
            var html = '<div class="heading">Account</div>';
            html += '<div class="account-card"><b>Username:</b> ' + escapeHtml(state.authUser.username) + '<br><b>Email:</b> ' + escapeHtml(state.authUser.email) + '</div>';
            html += '<div class="notice">Reading history, page progress and Saved Manga are synced to the server. Kindle keeps only small reader settings and the current in-memory page cache.</div>';
            html += '<button id="accountHistory" type="button" class="btn btn-wide">Reading History</button>';
            html += '<button id="accountSaved" type="button" class="btn btn-wide">Saved Manga</button>';
            html += '<button id="logoutBtn" type="button" class="btn btn-dark btn-wide">Log out</button>';
            showHtml(html);
            el("accountHistory").onclick = function () { showHistory(1); };
            el("accountSaved").onclick = function () { showSaved(1); };
            el("logoutBtn").onclick = logoutAccount;
            setStatus("Logged in as " + state.authUser.username + ".", false);
            return;
        }
        showLoginForm();
    }

    function showLoginForm() {
        var html = '<div class="heading">Login</div>';
        html += '<div class="auth-form">';
        html += '<label class="auth-label">Username or email</label><input id="loginIdentifier" class="auth-input" type="text" maxlength="254">';
        html += '<label class="auth-label">Password</label><input id="loginPassword" class="auth-input" type="password" maxlength="128">';
        html += '<button id="loginSubmit" type="button" class="btn btn-dark btn-wide">Login</button>';
        html += '<button id="registerOpen" type="button" class="btn btn-wide">Create account</button>';
        html += '<button id="forgotOpen" type="button" class="btn btn-wide">Forgot password</button>';
        html += '</div>';
        showHtml(html);
        el("loginSubmit").onclick = submitLogin;
        el("registerOpen").onclick = showRegisterForm;
        el("forgotOpen").onclick = showForgotPasswordForm;
        el("loginPassword").onkeypress = function (event) {
            var e = event || window.event;
            if ((e.keyCode || e.which) === 13) submitLogin();
        };
        setStatus("Login to sync reading progress.", false);
    }

    function submitLogin() {
        var identifier = trim(el("loginIdentifier").value);
        var password = el("loginPassword").value || "";
        if (!identifier || !password) {
            setStatus("Enter username/email and password.", true);
            return;
        }
        setStatus("Logging in...", false);
        xhrPost("/api/auth/login", { identifier: identifier, password: password }, function (err, json) {
            if (err || !json || !json.user) {
                setStatus(err || "Login failed.", true);
                return;
            }
            setAuthUser(json.user);
            showAccount();
        });
    }

    function showRegisterForm() {
        var html = '<div class="heading">Create Account</div>';
        html += '<div class="auth-form">';
        html += '<label class="auth-label">Username</label><input id="registerUsername" class="auth-input" type="text" maxlength="32">';
        html += '<label class="auth-label">Email</label><input id="registerEmail" class="auth-input" type="text" maxlength="254">';
        html += '<label class="auth-label">Password (8+ characters)</label><input id="registerPassword" class="auth-input" type="password" maxlength="128">';
        html += '<label class="auth-label">Confirm password</label><input id="registerConfirm" class="auth-input" type="password" maxlength="128">';
        html += '<button id="registerSubmit" type="button" class="btn btn-dark btn-wide">Register</button>';
        html += '<button id="registerBack" type="button" class="btn btn-wide">Back to login</button>';
        html += '</div>';
        showHtml(html);
        el("registerSubmit").onclick = submitRegister;
        el("registerBack").onclick = showLoginForm;
        setStatus("Create a small server account for reading sync.", false);
    }

    function submitRegister() {
        var username = trim(el("registerUsername").value);
        var email = trim(el("registerEmail").value);
        var password = el("registerPassword").value || "";
        var confirm = el("registerConfirm").value || "";
        if (password !== confirm) {
            setStatus("Passwords do not match.", true);
            return;
        }
        setStatus("Creating account...", false);
        xhrPost("/api/auth/register", { username: username, email: email, password: password }, function (err, json) {
            if (err || !json || !json.user) {
                setStatus(err || "Registration failed.", true);
                return;
            }
            setAuthUser(json.user);
            showAccount();
        });
    }

    function showForgotPasswordForm() {
        var html = '<div class="heading">Reset Password</div>';
        if (!state.resetEmailConfigured) {
            html += '<div class="notice">Password reset email is not configured on the server. Add Brevo or Resend email settings plus AUTH_SECRET.</div>';
        }
        html += '<div class="auth-form">';
        html += '<label class="auth-label">Username or email</label><input id="resetIdentifier" class="auth-input" type="text" maxlength="254">';
        html += '<button id="sendResetCode" type="button" class="btn btn-wide">Send 6-digit code</button>';
        html += '<hr class="auth-rule">';
        html += '<label class="auth-label">6-digit code</label><input id="resetCode" class="auth-input auth-code" type="text" maxlength="6">';
        html += '<label class="auth-label">New password (8+ characters)</label><input id="resetPassword" class="auth-input" type="password" maxlength="128">';
        html += '<button id="resetSubmit" type="button" class="btn btn-dark btn-wide">Set new password</button>';
        html += '<button id="resetBack" type="button" class="btn btn-wide">Back to login</button>';
        html += '</div>';
        showHtml(html);
        el("sendResetCode").onclick = sendResetCode;
        el("resetSubmit").onclick = submitResetPassword;
        el("resetBack").onclick = showLoginForm;
        setStatus("Password reset codes expire after a short time.", false);
    }

    function sendResetCode() {
        var identifier = trim(el("resetIdentifier").value);
        if (!identifier) {
            setStatus("Enter your username or email first.", true);
            return;
        }
        setStatus("Sending reset code...", false);
        xhrPost("/api/auth/forgot-password", { identifier: identifier }, function (err, json) {
            if (err) {
                setStatus(err, true);
                return;
            }
            setStatus((json && json.message) || "If the account exists, a reset code was sent.", false);
        });
    }

    function submitResetPassword() {
        var identifier = trim(el("resetIdentifier").value);
        var code = trim(el("resetCode").value);
        var newPassword = el("resetPassword").value || "";
        setStatus("Resetting password...", false);
        xhrPost("/api/auth/reset-password", { identifier: identifier, code: code, newPassword: newPassword }, function (err, json) {
            if (err || !json || !json.user) {
                setStatus(err || "Password reset failed.", true);
                return;
            }
            setAuthUser(json.user);
            showAccount();
            setStatus("Password changed. You are logged in.", false);
        });
    }

    function logoutAccount() {
        setStatus("Logging out...", false);
        xhrPost("/api/auth/logout", {}, function () {
            setAuthUser(null);
            showAccount();
            setStatus("Logged out. Reading progress will not be stored until you log in again.", false);
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
                if (direct) return "/api/image-proxy?kindle=cover&url=" + encodeURIComponent(direct);
                fileName = rel.attributes.fileName;
                if (!fileName) return "";
                direct =
                    "https://uploads.mangadex.org/covers/" +
                    manga.id +
                    "/" +
                    fileName +
                    ".256.jpg";
                return "/api/image-proxy?kindle=cover&url=" + encodeURIComponent(direct);
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
        var i, m, cover, desc, title, known, saved;
        if (!items || !items.length) {
            showHtml(html + '<div class="notice">No manga found.</div>');
            return;
        }
        for (i = 0; i < items.length; i += 1) {
            m = items[i];
            title = getTitle(m);
            cover = getCover(m);
            desc = getDescription(m);
            known = !!state.savedMangaKnown[m.id];
            saved = !!state.savedMangaIds[m.id];
            if (desc.length > 180) desc = desc.substring(0, 180) + "...";
            html += '<div class="manga-item">';
            html += '<div class="cover-wrap">';
            if (cover)
                html +=
                    '<img class="cover" src="' +
                    escapeHtml(cover) +
                    '" alt="Cover">';
            html += "</div>";
            html += '<div class="manga-info">';
            html += '<div class="manga-title">' + escapeHtml(title) + "</div>";
            html += '<div class="description">' + escapeHtml(desc) + "</div>";
            html +=
                '<button type="button" class="btn btn-dark open-manga" data-index="' +
                i +
                '">Open</button>';
            if (state.authUser) {
                html += '<button type="button" class="btn save-manga-card" data-index="' + i + '"' +
                    (known ? '' : ' disabled="disabled"') + '>' +
                    (known ? (saved ? 'Remove Saved' : 'Save') : 'Checking...') + '</button>';
            }
            html += '</div><div class="clear"></div></div>';
        }
        showHtml(html);
        bindMangaButtons(items);
        if (state.authUser) loadSavedStatesForMangaList(items);
    }

    function updateMangaListSaveButtons(items) {
        var buttons = document.getElementsByTagName("button");
        var i, b, idx, manga, known, saved;
        for (i = 0; i < buttons.length; i += 1) {
            b = buttons[i];
            if ((" " + b.className + " ").indexOf(" save-manga-card ") === -1) continue;
            idx = parseInt(b.getAttribute("data-index"), 10);
            manga = items[idx];
            if (!manga || !manga.id) continue;
            known = !!state.savedMangaKnown[manga.id];
            saved = !!state.savedMangaIds[manga.id];
            b.disabled = !known;
            b.innerHTML = known ? (saved ? "Remove Saved" : "Save") : "Checking...";
        }
    }

    function loadSavedStatesForMangaList(items) {
        var ids = [];
        var i, manga;
        if (!state.authUser || !items || !items.length) return;
        for (i = 0; i < items.length && ids.length < 40; i += 1) {
            manga = items[i];
            if (manga && manga.id && !state.savedMangaKnown[manga.id]) ids.push(manga.id);
        }
        if (!ids.length) {
            updateMangaListSaveButtons(items);
            return;
        }
        xhrPost("/api/reading/saved/check-many", { mangaIds: ids }, function (err, json) {
            var savedIds, j;
            if (err || !json) {
                setStatus(err || "Could not sync Saved state.", true);
                updateMangaListSaveButtons(items);
                return;
            }
            for (j = 0; j < ids.length; j += 1) {
                state.savedMangaKnown[ids[j]] = true;
                state.savedMangaIds[ids[j]] = false;
            }
            savedIds = json.savedIds || [];
            for (j = 0; j < savedIds.length; j += 1) {
                state.savedMangaKnown[savedIds[j]] = true;
                state.savedMangaIds[savedIds[j]] = true;
            }
            updateMangaListSaveButtons(items);
        });
    }

    function toggleSavedFromMangaList(manga, items) {
        var isSaved;
        if (!state.authUser || !manga || !manga.id || !state.savedMangaKnown[manga.id]) return;
        isSaved = !!state.savedMangaIds[manga.id];
        setStatus(isSaved ? "Removing saved manga..." : "Saving manga...", false);
        if (isSaved) {
            xhrDelete("/api/reading/saved/" + encodeURIComponent(manga.id), function (err) {
                if (err) {
                    setStatus(err, true);
                    return;
                }
                state.savedMangaIds[manga.id] = false;
                state.savedMangaKnown[manga.id] = true;
                if (state.currentManga && state.currentManga.id === manga.id) {
                    state.currentMangaSaved = false;
                    state.currentMangaSavedKnown = true;
                }
                updateMangaListSaveButtons(items);
                setStatus("Removed from Saved Manga.", false);
            });
        } else {
            xhrPost("/api/reading/saved", { mangaId: manga.id, mangaTitle: getTitle(manga) }, function (err) {
                if (err) {
                    setStatus(err, true);
                    return;
                }
                state.savedMangaIds[manga.id] = true;
                state.savedMangaKnown[manga.id] = true;
                if (state.currentManga && state.currentManga.id === manga.id) {
                    state.currentMangaSaved = true;
                    state.currentMangaSavedKnown = true;
                }
                updateMangaListSaveButtons(items);
                setStatus("Saved on server.", false);
            });
        }
    }

    function bindMangaButtons(items) {
        var buttons = document.getElementsByTagName("button");
        var i, b, idx;
        for (i = 0; i < buttons.length; i += 1) {
            b = buttons[i];
            if ((" " + b.className + " ").indexOf(" open-manga ") !== -1) {
                idx = parseInt(b.getAttribute("data-index"), 10);
                b.onclick = makeOpenHandler(items[idx]);
            } else if ((" " + b.className + " ").indexOf(" save-manga-card ") !== -1) {
                idx = parseInt(b.getAttribute("data-index"), 10);
                b.onclick = (function (manga) {
                    return function () { toggleSavedFromMangaList(manga, items); };
                }(items[idx]));
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

    function loadRandomManga() {
        leaveReaderMode();
        setStatus("Picking 10 random manga...", false);
        showHtml('<div class="heading">Random Manga</div><div class="notice">Loading...</div>');
        xhrGet("/api/provider/random?limit=10&r=" + new Date().getTime(), function (err, json) {
            if (err || !json) {
                setStatus(err || "Could not load random manga.", true);
                showHtml('<div class="heading">Random Manga</div><div class="notice">Random load failed. Try again.</div>');
                return;
            }
            setStatus("10 random manga loaded. Tap Random again for another set.", false);
            renderMangaList(json.data || [], "Random Manga");
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
        state.currentMangaSaved = !!state.savedMangaIds[manga.id];
        state.currentMangaSavedKnown = !!state.savedMangaKnown[manga.id];
        state.readChapterIds = {};
        renderMangaDetail(manga, true);
        loadChapters(manga.id, 0);
        if (state.authUser) checkCurrentMangaSaved(manga);
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
        var saved = !!(state.currentMangaSavedKnown && state.currentMangaSaved);
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
            (!state.authUser ? "Login to save" : (saved ? "Remove Saved" : "Save Manga")) +
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
            state.readChapterIds = {};
            renderMangaDetail(state.currentManga, false);
            if (state.authUser && state.currentMangaSaved) loadReadMarkersForVisibleChapters();
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
            if (state.currentMangaSaved && state.readChapterIds[ch.id]) label += " (READ)";
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

    function openChapterAtGlobalIndex(index, startAtBeginning) {
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
            openChapter(data[0], !!startAtBeginning);
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

    function openRelativeChapter(indexDelta, startAtBeginning) {
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
            openChapterAtGlobalIndex(target, !!startAtBeginning);
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

    function loadSavedPage(chapterId, pageCount, done) {
        if (!state.authUser) {
            done(0);
            return;
        }
        xhrGet("/api/reading/progress/" + encodeURIComponent(chapterId), function (err, json) {
            var item, p;
            if (err || !json || !json.item) {
                done(0);
                return;
            }
            item = json.item;
            p = parseInt(item.page_index, 10);
            if (isNaN(p) || p < 0) p = 0;
            if (pageCount && p >= pageCount) p = pageCount - 1;
            done(p);
        });
    }

    function progressPayload() {
        var manga, chapter, a;
        if (!state.authUser || !state.currentChapterId) return null;
        manga = state.currentManga;
        chapter = state.currentChapter;
        a = chapter && chapter.attributes ? chapter.attributes : {};
        return {
            mangaId: manga ? manga.id : "",
            mangaTitle: manga ? getTitle(manga) : "Manga",
            chapterId: state.currentChapterId,
            chapterNumber: a.chapter || a.volume || "",
            isVolume: !!a.volume && !a.chapter,
            pageIndex: state.pageIndex,
            pageCount: currentPageCount(),
            clientMillis: new Date().getTime()
        };
    }

    function savePageProgressNow() {
        var payload = progressPayload();
        if (!payload) return;
        state.progressDirty = false;
        if (state.currentMangaSaved && state.currentChapterId) state.readChapterIds[state.currentChapterId] = true;
        xhrPost("/api/reading/progress", payload, function (err) {
            if (err && err === "Please log in") setAuthUser(null);
        });
    }

    function schedulePageProgressSave() {
        if (!state.authUser || !state.currentChapterId) return;
        state.progressDirty = true;
        if (state.progressSaveTimer) window.clearTimeout(state.progressSaveTimer);
        state.progressSaveTimer = window.setTimeout(function () {
            state.progressSaveTimer = null;
            if (state.progressDirty && document.body.className === "reader-active") savePageProgressNow();
        }, state.progressDebounceMs);
    }

    function forceSavePageProgress() {
        if (state.progressSaveTimer) {
            window.clearTimeout(state.progressSaveTimer);
            state.progressSaveTimer = null;
        }
        if (state.progressDirty) savePageProgressNow();
    }

    function openChapter(chapter, startAtBeginning) {
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
        if (previousChapterId && previousChapterId !== chapter.id) {
            forceSavePageProgress();
            cancelTranslationPrefetch(previousChapterId);
        }
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
        state.preloadImages = {};
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
                if (startAtBeginning) {
                    state.pageIndex = 0;
                    setStatus(state.authUser ? "Reader ready. Progress sync is on." : "Reader ready. Login to save progress.", false);
                    renderReader();
                } else {
                    loadSavedPage(chapter.id, currentPageCount(), function (savedPage) {
                        if (chapter.id !== state.currentChapterId) return;
                        state.pageIndex = savedPage;
                        setStatus(state.authUser ? "Reader ready. Progress sync is on." : "Reader ready. Login to save progress.", false);
                        renderReader();
                    });
                }
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
        html += '<button id="readerClose" class="btn reader-big reader-chapters-btn" type="button">To title</button>';
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
            var manga = state.currentManga;
            forceSavePageProgress();
            if (manga) openManga(manga);
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
            translateHeight = Math.max(110, Math.min(165, Math.floor(remainingHeight * 0.30)));
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

    function translationCacheKey(chapterId, pageNumber) {
        return text(chapterId) + "::" + text(pageNumber);
    }

    function getHotTranslation(chapterId, pageNumber) {
        var key = translationCacheKey(chapterId, pageNumber);
        var data = state.translationPageCache[key];
        var order = state.translationCacheOrder;
        var i;
        if (!data) return null;
        for (i = order.length - 1; i >= 0; i -= 1) {
            if (order[i] === key) order.splice(i, 1);
        }
        order.push(key);
        return data;
    }

    function putHotTranslation(chapterId, pageNumber, data) {
        var key, order, i, removed;
        if (!data || data.status !== "ready") return;
        key = translationCacheKey(chapterId, pageNumber);
        order = state.translationCacheOrder;
        state.translationPageCache[key] = data;
        for (i = order.length - 1; i >= 0; i -= 1) {
            if (order[i] === key) order.splice(i, 1);
        }
        order.push(key);
        while (order.length > state.translationCacheLimit) {
            removed = order.shift();
            if (removed) delete state.translationPageCache[removed];
        }
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
            state.translationPrefetchSerial += 1;
            state.translationLoading = false;
            state.translationError = "";
            state.translationData = null;
            clearTranslationOverlay();
            cancelTranslationPrefetch(state.currentChapterId);
            updateReaderControls();
            return;
        }
        requestCurrentTranslation();
        prefetchNextTranslation();
        updateReaderControls();
    }

    function requestCurrentTranslation() {
        var serial, pageNumber, chapterId, url, hot;
        if (!state.translationAvailable || !state.translationEnabled || !state.currentChapterId) return;
        serial = state.translationRequestSerial + 1;
        state.translationRequestSerial = serial;
        pageNumber = state.pageIndex + 1;
        chapterId = state.currentChapterId;
        hot = getHotTranslation(chapterId, pageNumber);
        state.translationError = "";
        clearTranslationOverlay();
        if (hot) {
            state.translationLoading = false;
            state.translationData = hot;
            updateReaderControls();
            renderTranslationOverlay();
            return;
        }
        state.translationData = null;
        state.translationLoading = true;
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
                putHotTranslation(chapterId, pageNumber, json);
            }
            updateReaderControls();
            renderTranslationOverlay();
        });
    }

    function prefetchNextTranslation() {
        var serial, chapterId, firstPageNumber, lastPageNumber, count;
        if (!state.translationAvailable || !state.translationEnabled || !state.currentChapterId) return;
        if (state.translationPrefetchAhead < 1) return;
        count = currentPageCount();
        firstPageNumber = state.pageIndex + 2;
        if (firstPageNumber > count) return;
        lastPageNumber = Math.min(count, firstPageNumber + state.translationPrefetchAhead - 1);
        chapterId = state.currentChapterId;
        serial = state.translationPrefetchSerial + 1;
        state.translationPrefetchSerial = serial;

        // Warm the next two translated pages sequentially and keep successful
        // results in the five-page Kindle hot cache. This makes the next page
        // appear immediately without firing two Cloudflare jobs at once.
        function warm(pageNumber) {
            var hot, url;
            if (serial !== state.translationPrefetchSerial) return;
            if (!state.translationEnabled || chapterId !== state.currentChapterId) return;
            if (pageNumber > lastPageNumber) return;
            hot = getHotTranslation(chapterId, pageNumber);
            if (hot) {
                warm(pageNumber + 1);
                return;
            }
            url = "/api/translation/chapter/" + encodeURIComponent(chapterId) + "/page/" + pageNumber;
            xhrGet(url, function (err, json) {
                // If the request already spent quota, keep the successful result
                // when still reading the same chapter, even if the prefetch
                // window moved while the request was in flight.
                if (!err && json && json.status === "ready" && chapterId === state.currentChapterId) {
                    putHotTranslation(chapterId, pageNumber, json);
                }
                if (serial !== state.translationPrefetchSerial) return;
                if (!state.translationEnabled || chapterId !== state.currentChapterId) return;
                warm(pageNumber + 1);
            });
        }

        warm(firstPageNumber);
    }

    function preloadNearbyImages() {
        var cache = state.preloadImages || {};
        var wanted = {};
        var count = currentPageCount();
        var startIndex = Math.max(0, state.pageIndex - state.preloadBeforeCount);
        var endIndex = Math.min(count - 1, state.pageIndex + state.preloadAfterCount);
        var key, index, image, url;

        // Keep a real sliding five-page window. Existing Image objects stay
        // alive, so moving 10 -> 11 keeps 9/10/11/12 and only creates 13.
        for (index = startIndex; index <= endIndex; index += 1) wanted[String(index)] = true;
        for (key in cache) {
            if (cache.hasOwnProperty(key) && !wanted[key]) delete cache[key];
        }
        for (index = startIndex; index <= endIndex; index += 1) {
            key = String(index);
            if (cache[key]) continue;
            url = currentPageUrl(index);
            if (!url) continue;
            image = new Image();
            image.src = url;
            cache[key] = image;
        }
        state.preloadImages = cache;
    }

    function toggleQuality() {
        state.quality = state.quality === "original" ? "saver" : "original";
        if (state.quality === "original" && !state.pagesOriginal.length)
            state.quality = "saver";
        saveReaderSettings();
        state.preloadImages = {};
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
        prefetchNextTranslation();

        // Do not reset width/height to auto here. On the Voyage that causes a
        // visible 100% -> saved zoom jump while the next page is loading.
        // Hide the image, preserve/apply the requested fit first, then reveal
        // it only from onload after the final dimensions are known.
        img.style.visibility = "hidden";
        applyReaderFit();
        img.removeAttribute("src");
        img.src = url;
        // Start the visible page first. The retained five-page window then
        // slides in the background and normally adds only one new image.
        preloadNearbyImages();
        schedulePageProgressSave();
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
            forceSavePageProgress();
            setReaderMessage("End of chapter. Opening next chapter...");
            openRelativeChapter(-1, true);
        }
    }

    function prevPage() {
        if (state.pageIndex > 0) {
            state.pageIndex -= 1;
            showPage();
        }
    }

    function loadReadMarkersForVisibleChapters() {
        var ids = [], i, ch, mangaId;
        if (!state.authUser || !state.currentMangaSaved || !state.currentManga) {
            state.readChapterIds = {};
            return;
        }
        mangaId = state.currentManga.id;
        for (i = 0; i < state.chapters.length; i += 1) {
            ch = state.chapters[i];
            if (ch && ch.id) ids.push(ch.id);
        }
        if (!ids.length) {
            state.readChapterIds = {};
            return;
        }
        xhrPost("/api/reading/read-chapters", { mangaId: mangaId, chapterIds: ids }, function (err, json) {
            var map = {}, list, j;
            if (err || !json || state.currentManga.id !== mangaId) return;
            list = json.chapterIds || [];
            for (j = 0; j < list.length; j += 1) map[list[j]] = true;
            state.readChapterIds = map;
            renderMangaDetail(state.currentManga, false);
        });
    }

    function checkCurrentMangaSaved(manga) {
        if (!manga || state.currentManga !== manga) return;
        if (!state.authUser) {
            state.currentMangaSaved = false;
            state.currentMangaSavedKnown = false;
            renderMangaDetail(manga, state.chapterLoading);
            return;
        }
        xhrGet("/api/reading/saved/check/" + encodeURIComponent(manga.id), function (err, json) {
            if (state.currentManga !== manga) return;
            if (!err && json) {
                state.currentMangaSaved = !!json.saved;
                state.currentMangaSavedKnown = true;
                state.savedMangaIds[manga.id] = !!json.saved;
                state.savedMangaKnown[manga.id] = true;
                state.readChapterIds = {};
                renderMangaDetail(manga, state.chapterLoading);
                if (state.currentMangaSaved && !state.chapterLoading) loadReadMarkersForVisibleChapters();
            }
        });
    }

    function toggleSaved(manga) {
        if (!state.authUser) {
            requireLoginView("Login first to save manga on the server.");
            return;
        }
        setStatus(state.currentMangaSaved ? "Removing saved manga..." : "Saving manga...", false);
        if (state.currentMangaSaved) {
            xhrDelete("/api/reading/saved/" + encodeURIComponent(manga.id), function (err) {
                if (err) {
                    setStatus(err, true);
                    return;
                }
                state.currentMangaSaved = false;
                state.currentMangaSavedKnown = true;
                state.savedMangaIds[manga.id] = false;
                state.savedMangaKnown[manga.id] = true;
                state.readChapterIds = {};
                renderMangaDetail(manga, false);
                setStatus("Removed from Saved Manga.", false);
            });
        } else {
            xhrPost("/api/reading/saved", { mangaId: manga.id, mangaTitle: getTitle(manga) }, function (err) {
                if (err) {
                    setStatus(err, true);
                    return;
                }
                state.currentMangaSaved = true;
                state.currentMangaSavedKnown = true;
                state.savedMangaIds[manga.id] = true;
                state.savedMangaKnown[manga.id] = true;
                state.readChapterIds = {};
                renderMangaDetail(manga, false);
                loadReadMarkersForVisibleChapters();
                setStatus("Saved on server. Read chapters will be marked (READ).", false);
            });
        }
    }

    function renderDataPager(prefix, page, pages) {
        if (pages <= 1) return "";
        var html = '<div class="data-pager">';
        html += '<button id="' + prefix + 'Prev" type="button" class="btn">Prev</button>';
        html += '<span class="data-page-label">Page ' + page + ' / ' + pages + '</span>';
        html += '<button id="' + prefix + 'Next" type="button" class="btn">Next</button>';
        html += '</div>';
        return html;
    }

    function showSaved(pageNumber) {
        leaveReaderMode();
        if (!state.authUser) {
            requireLoginView("Saved Manga is stored on the server and requires login.");
            return;
        }
        pageNumber = parseInt(pageNumber, 10);
        if (isNaN(pageNumber) || pageNumber < 1) pageNumber = 1;
        setStatus("Loading Saved Manga...", false);
        showHtml('<div class="heading">Saved Manga</div><div class="notice">Loading...</div>');
        xhrGet("/api/reading/saved?page=" + pageNumber + "&limit=40", function (err, json) {
            var list, html, i;
            if (err || !json) {
                setStatus(err || "Could not load Saved Manga.", true);
                return;
            }
            list = json.items || [];
            state.savedPage = parseInt(json.page, 10) || 1;
            state.savedPages = parseInt(json.pages, 10) || 1;
            html = '<div class="heading">Saved Manga</div>';
            html += renderDataPager("savedPager", state.savedPage, state.savedPages);
            if (!list.length) html += '<div class="notice">No saved manga yet.</div>';
            for (i = 0; i < list.length; i += 1) {
                state.savedMangaIds[list[i].manga_id] = true;
                state.savedMangaKnown[list[i].manga_id] = true;
                html += '<button type="button" class="chapter saved-open" data-id="' +
                    escapeHtml(list[i].manga_id) + '"><span class="chapter-main">' +
                    escapeHtml(list[i].manga_title || list[i].manga_id) + '</span></button>';
            }
            html += renderDataPager("savedPagerBottom", state.savedPage, state.savedPages);
            showHtml(html);
            bindIdButtons("saved-open");
            bindDataPager("savedPager", state.savedPage, state.savedPages, showSaved);
            bindDataPager("savedPagerBottom", state.savedPage, state.savedPages, showSaved);
            setStatus(json.total + " saved manga. Server page " + state.savedPage + "/" + state.savedPages + ".", false);
        });
    }

    function showHistory(pageNumber) {
        leaveReaderMode();
        if (!state.authUser) {
            requireLoginView("Reading History is stored on the server and requires login.");
            return;
        }
        pageNumber = parseInt(pageNumber, 10);
        if (isNaN(pageNumber) || pageNumber < 1) pageNumber = 1;
        setStatus("Loading reading history...", false);
        showHtml('<div class="heading">Reading History</div><div class="notice">Loading...</div>');
        xhrGet("/api/reading/history?page=" + pageNumber + "&limit=40", function (err, json) {
            var list, html, i, label, pageText;
            if (err || !json) {
                setStatus(err || "Could not load reading history.", true);
                return;
            }
            list = json.items || [];
            state.historyPage = parseInt(json.page, 10) || 1;
            state.historyPages = parseInt(json.pages, 10) || 1;
            html = '<div class="heading">Reading History</div>';
            html += renderDataPager("historyPager", state.historyPage, state.historyPages);
            if (!list.length) html += '<div class="notice">No reading history yet.</div>';
            for (i = 0; i < list.length; i += 1) {
                label = (list[i].manga_title || "Manga") +
                    (list[i].chapter_number ? " - " + (list[i].is_volume ? "Vol. " : "Ch. ") + list[i].chapter_number : "");
                pageText = typeof list[i].page_index !== "undefined" ? " - Page " + (parseInt(list[i].page_index, 10) + 1) : "";
                html += '<button type="button" class="chapter history-open" data-manga-id="' +
                    escapeHtml(list[i].manga_id) + '" data-chapter-id="' + escapeHtml(list[i].chapter_id) + '">' +
                    '<span class="chapter-main">' + escapeHtml(label) + '</span>' +
                    '<span class="chapter-meta">Resume directly' + escapeHtml(pageText) + '</span></button>';
            }
            html += renderDataPager("historyPagerBottom", state.historyPage, state.historyPages);
            showHtml(html);
            bindHistoryButtons();
            bindDataPager("historyPager", state.historyPage, state.historyPages, showHistory);
            bindDataPager("historyPagerBottom", state.historyPage, state.historyPages, showHistory);
            setStatus(json.total + " history items. Showing up to 40 per page.", false);
        });
    }

    function bindDataPager(prefix, page, pages, handler) {
        var prev = el(prefix + "Prev");
        var next = el(prefix + "Next");
        if (prev) prev.onclick = function () { if (page > 1) handler(page - 1); };
        if (next) next.onclick = function () { if (page < pages) handler(page + 1); };
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


    function bookFontFamily() {
        if (state.bookFont === "sans") return "Arial, Helvetica, sans-serif";
        if (state.bookFont === "mono") return "Courier New, Courier, monospace";
        return "Georgia, Times New Roman, serif";
    }

    function bookScrollRatio() {
        if (state.bookPageCount <= 1) return 0;
        return Math.max(0, Math.min(10000, Math.round((state.bookPageIndex / (state.bookPageCount - 1)) * 10000)));
    }

    function bookScrollToRatio(ratio) {
        var page;
        ratio = parseInt(ratio, 10);
        if (isNaN(ratio) || ratio < 0) ratio = 0;
        if (ratio > 10000) ratio = 10000;
        page = state.bookPageCount > 1 ? Math.round((ratio / 10000) * (state.bookPageCount - 1)) : 0;
        showBookPage(page, false);
    }

    function bookProgressPayload() {
        if (!state.currentBook) return null;
        return {
            driveFileId: state.currentBook.id,
            bookTitle: state.currentBook.title || state.currentBook.name || "Book",
            sectionIndex: state.bookSectionIndex,
            sectionCount: parseInt(state.currentBook.sectionCount, 10) || 0,
            scrollRatio: bookScrollRatio(),
            clientMillis: new Date().getTime()
        };
    }

    function sendBookProgress(done) {
        var payload;
        if (!state.authUser || !state.currentBook) {
            state.bookProgressDirty = false;
            if (done) done();
            return;
        }
        payload = bookProgressPayload();
        if (!payload) { if (done) done(); return; }
        state.bookProgressDirty = false;
        xhrPost("/api/books/progress", payload, function () {
            if (done) done();
        });
    }

    function scheduleBookProgressSave() {
        if (!state.authUser || !state.currentBook) return;
        state.bookProgressDirty = true;
        if (state.bookProgressSaveTimer) window.clearTimeout(state.bookProgressSaveTimer);
        state.bookProgressSaveTimer = window.setTimeout(function () {
            state.bookProgressSaveTimer = null;
            if (state.bookProgressDirty) sendBookProgress();
        }, state.bookProgressDebounceMs);
    }

    function forceSaveBookProgress(done) {
        if (state.bookProgressSaveTimer) {
            window.clearTimeout(state.bookProgressSaveTimer);
            state.bookProgressSaveTimer = null;
        }
        if (!state.authUser || !state.currentBook) { if (done) done(); return; }
        sendBookProgress(done);
    }

    function renderBooksPager(id, page, pages) {
        var html = '<div id="' + id + '" class="data-pager">';
        html += '<button type="button" class="btn book-page-prev"' + (page <= 1 ? ' disabled="disabled"' : '') + '>Prev</button>';
        html += '<span class="data-page-label">Page ' + page + ' / ' + pages + '</span>';
        html += '<button type="button" class="btn book-page-next"' + (page >= pages ? ' disabled="disabled"' : '') + '>Next</button>';
        html += '</div>';
        return html;
    }

    function bindBooksPager(id, page, pages, query) {
        var root = el(id), prev, next;
        if (!root) return;
        prev = root.getElementsByClassName ? root.getElementsByClassName("book-page-prev")[0] : null;
        next = root.getElementsByClassName ? root.getElementsByClassName("book-page-next")[0] : null;
        if (prev && page > 1) prev.onclick = function () { showBooks(page - 1, query); };
        if (next && page < pages) next.onclick = function () { showBooks(page + 1, query); };
    }

    function formatBookSize(bytes) {
        bytes = parseInt(bytes, 10) || 0;
        if (bytes >= 1048576) return (Math.round(bytes / 104857.6) / 10) + " MB";
        if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
        return bytes ? bytes + " B" : "";
    }

    function showBooks(pageNumber, query) {
        var q = typeof query === "string" ? query : "";
        leaveReaderMode();
        pageNumber = parseInt(pageNumber, 10);
        if (isNaN(pageNumber) || pageNumber < 1) pageNumber = 1;
        setStatus("Loading text books from Google Drive...", false);
        showHtml('<div class="heading">Books</div><div class="notice">Loading Google Drive folder...</div>');
        xhrGet("/api/books?page=" + pageNumber + "&limit=40&q=" + encodeURIComponent(q), function (err, json) {
            var html, items, i, item, progress, resumeText;
            if (err || !json) {
                setStatus(err || "Could not load books.", true);
                showHtml('<div class="heading">Books</div><div class="notice">' + escapeHtml(err || "Could not load the configured Google Drive folder.") + '</div>');
                return;
            }
            items = json.items || [];
            state.booksPage = parseInt(json.page, 10) || 1;
            state.booksPages = parseInt(json.pages, 10) || 1;
            html = '<div class="heading">Text Books</div>';
            html += '<div class="book-search-row"><input id="bookSearch" class="searchbox book-search" type="text" value="' + escapeHtml(q) + '" placeholder="Search this Drive folder"><button id="bookSearchBtn" class="btn btn-dark" type="button">Search</button></div>';
            if (!state.authUser) html += '<div class="notice">Login to sync reading position. The ebook itself is never stored in Kindle localStorage.</div>';
            html += renderBooksPager("booksPager", state.booksPage, state.booksPages);
            if (!items.length) html += '<div class="notice">No EPUB/AZW3 files found in the configured folder.</div>';
            for (i = 0; i < items.length; i += 1) {
                item = items[i];
                progress = item.progress || null;
                resumeText = "";
                if (progress) resumeText = 'Resume section ' + (parseInt(progress.section_index, 10) + 1) + (parseInt(progress.section_count, 10) ? ' / ' + parseInt(progress.section_count, 10) : '');
                html += '<div class="book-item"><div class="book-title">' + escapeHtml(item.title || item.name) + '</div>' +
                    '<div class="book-meta">' + escapeHtml(String(item.format || "").toUpperCase()) + (item.size ? ' - ' + escapeHtml(formatBookSize(item.size)) : '') + '</div>' +
                    (resumeText ? '<div class="book-resume">' + escapeHtml(resumeText) + '</div>' : '') +
                    '<button type="button" class="btn btn-wide book-open" data-id="' + escapeHtml(item.id) + '">' + (progress ? 'Continue Reading' : 'Open Book') + '</button></div>';
            }
            html += renderBooksPager("booksPagerBottom", state.booksPage, state.booksPages);
            showHtml(html);
            bindBooksPager("booksPager", state.booksPage, state.booksPages, q);
            bindBooksPager("booksPagerBottom", state.booksPage, state.booksPages, q);
            el("bookSearchBtn").onclick = function () { showBooks(1, trim(el("bookSearch").value)); };
            el("bookSearch").onkeypress = function (evt) { evt = evt || window.event; if ((evt.keyCode || evt.which) === 13) showBooks(1, trim(el("bookSearch").value)); };
            bindBookOpenButtons();
            setStatus(json.total + " book files in Google Drive. Page " + state.booksPage + "/" + state.booksPages + ".", false);
        });
    }

    function bindBookOpenButtons() {
        var buttons = document.getElementsByTagName("button"), i, b, id;
        for (i = 0; i < buttons.length; i += 1) {
            b = buttons[i];
            if ((" " + b.className + " ").indexOf(" book-open ") !== -1) {
                id = b.getAttribute("data-id");
                b.onclick = makeBookOpenHandler(id);
            }
        }
    }

    function makeBookOpenHandler(id) {
        return function () { openBook(id); };
    }

    function openBook(fileId) {
        leaveReaderMode();
        setStatus("Opening ebook on server...", false);
        showHtml('<div class="heading">Book</div><div class="notice">Downloading/parsing EPUB or AZW3 on the server. The first open may take a little longer.</div>');
        xhrGet("/api/books/" + encodeURIComponent(fileId) + "/meta", function (err, meta) {
            if (err || !meta) {
                setStatus(err || "Could not parse book.", true);
                return;
            }
            state.currentBook = meta;
            state.bookSectionIndex = 0;
            if (!state.authUser) {
                loadBookSection(0, 0);
                return;
            }
            xhrGet("/api/books/" + encodeURIComponent(fileId) + "/progress", function (progressErr, progressJson) {
                var progress = !progressErr && progressJson ? progressJson.progress : null;
                var index = progress ? parseInt(progress.section_index, 10) : 0;
                var ratio = progress ? parseInt(progress.scroll_ratio, 10) : 0;
                if (isNaN(index) || index < 0 || index >= meta.sectionCount) index = 0;
                if (isNaN(ratio) || ratio < 0 || ratio > 10000) ratio = 0;
                loadBookSection(index, ratio);
            });
        });
    }

    function bookSettingsHtml() {
        var fontLabel = state.bookFont === "sans" ? "Sans" : (state.bookFont === "mono" ? "Mono" : "Serif");
        if (!state.bookSettingsOpen) return "";
        return '<div class="book-settings">' +
            '<div class="book-setting-row"><button id="bookFontMinus" class="btn book-setting-button" type="button">A-</button><span class="book-setting-label">Font ' + state.bookFontSize + 'px</span><button id="bookFontPlus" class="btn book-setting-button" type="button">A+</button></div>' +
            '<div class="book-setting-row book-lines-row"><button id="bookLinesMinus5" class="btn book-line-step" type="button">-5</button><button id="bookLinesMinus1" class="btn book-line-step" type="button">-1</button><span id="bookLinesLabel" class="book-setting-label book-lines-label">' + state.bookLinesPerPage + ' lines/page</span><button id="bookLinesPlus1" class="btn book-line-step" type="button">+1</button><button id="bookLinesPlus5" class="btn book-line-step" type="button">+5</button></div>' +
            '<div class="book-setting-row"><button id="bookMarginMinus" class="btn book-setting-button" type="button">Margin -</button><span class="book-setting-label">' + state.bookMargin + 'px</span><button id="bookMarginPlus" class="btn book-setting-button" type="button">Margin +</button></div>' +
            '<div class="book-setting-row"><button id="bookLineMinus" class="btn book-setting-button" type="button">Spacing -</button><span class="book-setting-label">' + (state.bookLineHeight / 100).toFixed(2) + '</span><button id="bookLinePlus" class="btn book-setting-button" type="button">Spacing +</button></div>' +
            '<div class="book-setting-row book-typeface-row"><span class="book-setting-side"></span><button id="bookFontType" class="btn book-setting-type" type="button">Typeface: ' + fontLabel + '</button><span class="book-setting-side"></span></div></div>';
    }

    function renderBookReader(section, restoreRatio) {
        var book = state.currentBook;
        var index = parseInt(section.index, 10) || 0;
        var html = '<div class="book-reader">' +
            '<div id="bookControlShell" class="book-control-shell"><div class="book-reader-row">' +
            '<button id="bookBack" class="btn book-reader-btn" type="button">Books</button>' +
            '<button id="bookPrev" class="btn book-reader-btn" type="button">Prev</button>' +
            '<span id="bookPageCount" class="book-section-count">1/1</span>' +
            '<button id="bookNext" class="btn book-reader-btn" type="button">Next</button>' +
            '<button id="bookAa" class="btn book-reader-btn" type="button">Aa</button>' +
            '</div>' + bookSettingsHtml() + '</div><div id="bookControlSpacer" class="book-control-spacer"></div>' +
            '<div id="bookSideRail" class="book-side-rail"><button id="bookPrevSide" class="book-side-prev" type="button"><span>PREV<br>PAGE</span></button></div>' +
            '<div id="bookPageViewport" class="book-page-viewport"><div id="bookText" class="book-text"><div class="book-reading-title">' + escapeHtml(section.title || book.title) + '</div>' + section.html + '</div></div></div>';
        document.body.className = "book-reader-active";
        el("view").innerHTML = html;
        state.currentBookSection = section;
        state.bookSectionIndex = index;
        state.bookPageIndex = 0;
        state.bookPageCount = 1;
        applyBookTextStyle();
        bindBookReaderControls();
        bindBookImages();
        layoutBookPages(restoreRatio || 0);
        window.onscroll = null;
        window.onresize = function () {
            if (document.body.className === "book-reader-active") scheduleBookLayout();
        };
        setStatus("Reading " + (book.title || "book") + " - section " + (index + 1) + "/" + (parseInt(book.sectionCount, 10) || 1) + ".", false);
    }

    function ensureBookImagePage(image) {
        var parent, tag, wrapper;
        if (!image || !image.parentNode) return image;
        parent = image.parentNode;
        tag = parent.tagName ? String(parent.tagName).toLowerCase() : "";
        if ((" " + (parent.className || "") + " ").indexOf(" book-image-page ") >= 0) return parent;
        if (tag === "figure") {
            parent.className = (parent.className ? parent.className + " " : "") + "book-image-page";
            return parent;
        }
        wrapper = document.createElement("span");
        wrapper.className = "book-image-page";
        parent.insertBefore(wrapper, image);
        wrapper.appendChild(image);
        return wrapper;
    }

    function fitBookImage(image, contentWidth, pageHeight) {
        var box, naturalWidth, naturalHeight, maxWidth, maxHeight, scale, width, height, extraHeight;
        if (!image || image.style.display === "none") return;
        box = ensureBookImagePage(image);
        maxWidth = Math.max(80, Math.floor(contentWidth - 4));
        maxHeight = Math.max(60, Math.floor(pageHeight - 22));
        naturalWidth = image.naturalWidth || parseInt(image.getAttribute("width"), 10) || 0;
        naturalHeight = image.naturalHeight || parseInt(image.getAttribute("height"), 10) || 0;

        if (box && box !== image) {
            box.style.display = "block";
            box.style.width = "100%";
            box.style.maxWidth = contentWidth + "px";
            box.style.marginLeft = "0px";
            box.style.marginRight = "0px";
            box.style.webkitColumnBreakBefore = "always";
            box.style.webkitColumnBreakInside = "avoid";
            box.style.pageBreakInside = "avoid";
        }

        /*
         * Old Kindle WebKit can ignore max-height for replaced elements while
         * laying them out in CSS columns. Give loaded images an explicit pixel
         * size so a tall image can never extend below the page box and be clipped.
         */
        if (naturalWidth > 0 && naturalHeight > 0) {
            extraHeight = 0;
            if (box && box !== image && box.tagName && String(box.tagName).toLowerCase() === "figure") {
                extraHeight = Math.max(0, (box.offsetHeight || 0) - (image.offsetHeight || 0));
                if (extraHeight > 0) maxHeight = Math.max(60, maxHeight - extraHeight);
            }
            scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
            width = Math.max(1, Math.floor(naturalWidth * scale));
            height = Math.max(1, Math.floor(naturalHeight * scale));
            image.style.width = width + "px";
            image.style.height = height + "px";
            image.style.maxWidth = "none";
            image.style.maxHeight = "none";
        } else {
            image.style.width = "auto";
            image.style.height = "auto";
            image.style.maxWidth = maxWidth + "px";
            image.style.maxHeight = maxHeight + "px";
        }
        image.style.display = "block";
        image.style.webkitColumnBreakInside = "avoid";
        image.style.pageBreakInside = "avoid";
        image.style.marginLeft = "auto";
        image.style.marginRight = "auto";
    }

    function bindBookImages() {
        var root = el("bookText"), images, list, i;
        if (!root || !root.getElementsByTagName) return;
        images = root.getElementsByTagName("img");
        list = [];
        for (i = 0; i < images.length; i += 1) list.push(images[i]);
        for (i = 0; i < list.length; i += 1) {
            ensureBookImagePage(list[i]);
            list[i].onload = function () { scheduleBookLayout(); };
            list[i].onerror = function () {
                var box = this.parentNode;
                this.style.display = "none";
                if (box && (" " + (box.className || "") + " ").indexOf(" book-image-page ") >= 0) box.style.display = "none";
                scheduleBookLayout();
            };
        }
    }

    function scheduleBookLayout() {
        if (state.bookLayoutTimer) window.clearTimeout(state.bookLayoutTimer);
        state.bookLayoutTimer = window.setTimeout(function () {
            var ratio = bookScrollRatio();
            state.bookLayoutTimer = null;
            layoutBookPages(ratio);
        }, 80);
    }

    function applyBookTextStyle() {
        var node = el("bookText");
        if (!node) return;
        node.style.fontSize = state.bookFontSize + "px";
        node.style.lineHeight = String(state.bookLineHeight / 100);
        node.style.fontFamily = bookFontFamily();
    }

    function layoutBookPages(restoreRatio) {
        var shell = el("bookControlShell"), spacer = el("bookControlSpacer"), viewport = el("bookPageViewport"), flow = el("bookText"), rail = el("bookSideRail"), prevSide = el("bookPrevSide");
        var doc = document.documentElement, rows, toolbarHeight, screenWidth, viewportWidth, viewportHeight, railWidth, margin, contentWidth, gap;
        var linePx, maxLines, pageLines, pageHeight, scrollWidth, count, images, i;
        if (!shell || !spacer || !viewport || !flow) return;

        /*
         * v26 pagination: the reader chooses how many text line-heights make one page.
         * The fixed Aa settings panel is ignored when measuring the reading area so
         * opening settings does not silently change page breaks. Images/headings
         * consume vertical space inside the same page, just like a physical page.
         */
        rows = shell.getElementsByClassName ? shell.getElementsByClassName("book-reader-row") : null;
        toolbarHeight = rows && rows.length ? (rows[0].offsetHeight || 48) + 8 : 58;
        screenWidth = window.innerWidth || doc.clientWidth || 600;
        railWidth = 58;
        viewportWidth = Math.max(140, screenWidth - railWidth);
        viewportHeight = (window.innerHeight || doc.clientHeight || 800) - toolbarHeight;
        if (viewportHeight < 180) viewportHeight = 180;

        if (rail) {
            rail.style.position = "fixed";
            rail.style.left = "0px";
            rail.style.top = toolbarHeight + "px";
            rail.style.width = railWidth + "px";
            rail.style.height = viewportHeight + "px";
            rail.style.zIndex = "998";
        }
        if (prevSide) prevSide.style.height = viewportHeight + "px";

        margin = Math.max(0, Math.min(state.bookMargin, Math.floor((viewportWidth - 120) / 2)));
        contentWidth = Math.max(120, viewportWidth - (margin * 2));
        gap = margin * 2;
        linePx = Math.max(1, state.bookFontSize * (state.bookLineHeight / 100));
        maxLines = Math.max(5, Math.min(40, Math.floor((viewportHeight - 14) / linePx)));
        pageLines = Math.max(5, Math.min(state.bookLinesPerPage, maxLines));
        if (pageLines !== state.bookLinesPerPage) {
            state.bookLinesPerPage = pageLines;
            if (el("bookLinesLabel")) el("bookLinesLabel").innerHTML = pageLines + " lines/page";
            saveReaderSettings();
        }
        pageHeight = Math.max(linePx * pageLines + 8, linePx * 5 + 8);
        if (pageHeight > viewportHeight) pageHeight = viewportHeight;

        spacer.style.height = toolbarHeight + "px";
        viewport.style.marginLeft = railWidth + "px";
        viewport.style.width = viewportWidth + "px";
        viewport.style.height = viewportHeight + "px";
        flow.style.position = "relative";
        flow.style.left = "0px";
        flow.style.width = contentWidth + "px";
        flow.style.height = Math.floor(pageHeight) + "px";
        flow.style.marginLeft = margin + "px";
        flow.style.marginRight = "0px";
        flow.style.paddingLeft = "0px";
        flow.style.paddingRight = "0px";
        flow.style.webkitColumnWidth = contentWidth + "px";
        flow.style.columnWidth = contentWidth + "px";
        flow.style.webkitColumnGap = gap + "px";
        flow.style.columnGap = gap + "px";
        flow.style.webkitColumnFill = "auto";
        flow.style.columnFill = "auto";
        applyBookTextStyle();

        images = flow.getElementsByTagName ? flow.getElementsByTagName("img") : [];
        for (i = 0; i < images.length; i += 1) fitBookImage(images[i], contentWidth, pageHeight);

        scrollWidth = flow.scrollWidth || contentWidth;
        count = Math.max(1, Math.ceil((scrollWidth + margin) / viewportWidth));
        state.bookPageCount = count;
        bookScrollToRatio(typeof restoreRatio === "number" ? restoreRatio : 0);
    }

    function updateBookPageControls() {
        var label = el("bookPageCount"), prev = el("bookPrev"), prevSide = el("bookPrevSide"), next = el("bookNext");
        var sectionCount = state.currentBook ? parseInt(state.currentBook.sectionCount, 10) || 1 : 1;
        var atStart = state.bookSectionIndex <= 0 && state.bookPageIndex <= 0;
        if (label) label.innerHTML = (state.bookPageIndex + 1) + "/" + state.bookPageCount;
        if (prev) prev.disabled = atStart;
        if (prevSide) prevSide.disabled = atStart;
        if (next) next.disabled = state.bookSectionIndex >= sectionCount - 1 && state.bookPageIndex >= state.bookPageCount - 1;
    }

    function showBookPage(pageIndex, saveProgress) {
        var viewport = el("bookPageViewport"), flow = el("bookText"), doc = document.documentElement, pageWidth;
        if (!viewport || !flow) return;
        pageIndex = parseInt(pageIndex, 10);
        if (isNaN(pageIndex) || pageIndex < 0) pageIndex = 0;
        if (pageIndex >= state.bookPageCount) pageIndex = state.bookPageCount - 1;
        state.bookPageIndex = pageIndex;
        pageWidth = viewport.clientWidth || window.innerWidth || doc.clientWidth || 600;
        flow.style.left = (-pageIndex * pageWidth) + "px";
        updateBookPageControls();
        if (saveProgress) scheduleBookProgressSave();
    }

    function nextBookPage() {
        var sectionCount = state.currentBook ? parseInt(state.currentBook.sectionCount, 10) || 1 : 1;
        if (state.bookPageIndex < state.bookPageCount - 1) {
            showBookPage(state.bookPageIndex + 1, true);
            return;
        }
        if (state.bookSectionIndex < sectionCount - 1) {
            forceSaveBookProgress(function () { loadBookSection(state.bookSectionIndex + 1, 0); });
        }
    }

    function previousBookPage() {
        if (state.bookPageIndex > 0) {
            showBookPage(state.bookPageIndex - 1, true);
            return;
        }
        if (state.bookSectionIndex > 0) {
            forceSaveBookProgress(function () { loadBookSection(state.bookSectionIndex - 1, 10000); });
        }
    }

    function changeBookSetting(kind, delta) {
        if (kind === "font") state.bookFontSize = Math.max(14, Math.min(38, state.bookFontSize + delta));
        if (kind === "lines") state.bookLinesPerPage = Math.max(5, Math.min(40, state.bookLinesPerPage + delta));
        if (kind === "margin") state.bookMargin = Math.max(0, Math.min(80, state.bookMargin + delta));
        if (kind === "line") state.bookLineHeight = Math.max(110, Math.min(220, state.bookLineHeight + delta));
        saveReaderSettings();
        rerenderBookControlsKeepPosition();
    }

    function cycleBookFont() {
        state.bookFont = state.bookFont === "serif" ? "sans" : (state.bookFont === "sans" ? "mono" : "serif");
        saveReaderSettings();
        rerenderBookControlsKeepPosition();
    }

    function rerenderBookControlsKeepPosition() {
        var ratio = bookScrollRatio();
        var section = state.currentBookSection;
        if (!section) return;
        renderBookReader(section, ratio);
    }

    function bindBookReaderControls() {
        var viewport = el("bookPageViewport");
        el("bookBack").onclick = function () { showBooks(state.booksPage || 1, ""); };
        el("bookPrev").onclick = previousBookPage;
        el("bookPrevSide").onclick = previousBookPage;
        el("bookNext").onclick = nextBookPage;
        el("bookAa").onclick = function () { state.bookSettingsOpen = !state.bookSettingsOpen; rerenderBookControlsKeepPosition(); };
        if (viewport) {
            viewport.onclick = function () { nextBookPage(); };
        }
        if (state.bookSettingsOpen) {
            el("bookFontMinus").onclick = function () { changeBookSetting("font", -2); };
            el("bookFontPlus").onclick = function () { changeBookSetting("font", 2); };
            el("bookLinesMinus5").onclick = function () { changeBookSetting("lines", -5); };
            el("bookLinesMinus1").onclick = function () { changeBookSetting("lines", -1); };
            el("bookLinesPlus1").onclick = function () { changeBookSetting("lines", 1); };
            el("bookLinesPlus5").onclick = function () { changeBookSetting("lines", 5); };
            el("bookMarginMinus").onclick = function () { changeBookSetting("margin", -10); };
            el("bookMarginPlus").onclick = function () { changeBookSetting("margin", 10); };
            el("bookLineMinus").onclick = function () { changeBookSetting("line", -10); };
            el("bookLinePlus").onclick = function () { changeBookSetting("line", 10); };
            el("bookFontType").onclick = cycleBookFont;
        }
    }

    function loadBookSection(index, restoreRatio) {
        var book = state.currentBook;
        if (!book) return;
        index = parseInt(index, 10);
        if (isNaN(index) || index < 0) index = 0;
        if (index >= book.sectionCount) index = book.sectionCount - 1;
        state.bookSectionIndex = index;
        state.bookPageIndex = 0;
        state.bookPageCount = 1;
        window.onscroll = null;
        window.onresize = null;
        el("view").innerHTML = '<div class="notice">Loading book section...</div>';
        window.scrollTo(0, 0);
        xhrGet("/api/books/" + encodeURIComponent(book.id) + "/section/" + index, function (err, json) {
            if (err || !json || !json.section) {
                setStatus(err || "Could not load book section.", true);
                return;
            }
            renderBookReader(json.section, restoreRatio || 0);
            state.bookProgressDirty = true;
            scheduleBookProgressSave();
        });
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
        el("randomBtn").onclick = loadRandomManga;
        el("booksBtn").onclick = function () { showBooks(1, ""); };
        el("savedBtn").onclick = function () { showSaved(1); };
        el("historyBtn").onclick = function () { showHistory(1); };
        el("accountBtn").onclick = showAccount;
        refreshAccountButton();
        el("search").onkeypress = function (evt) {
            evt = evt || window.event;
            if ((evt.keyCode || evt.which) === 13) doSearch();
        };

        setStatus("ES5 v26 started. tap-to-next ebook + side back rail + fast line steps + manga reader. Testing API...", false);
        xhrGet("/api/health", function (err) {
            if (err) {
                setStatus("Local API failed: " + err, true);
                showHtml(
                    '<div class="notice">The browser can run this app, but the server API is not responding.</div>'
                );
                return;
            }
            checkAuth(function () {
                xhrGet("/api/books/status", function (bookErr, bookInfo) {
                    state.booksConfigured = !!(!bookErr && bookInfo && bookInfo.configured);
                });
                xhrGet("/api/translation/status", function (translationErr, translationInfo) {
                    if (!translationErr && translationInfo) {
                        state.translationAvailable = !!translationInfo.enabled;
                        state.translationPrefetchAhead = parseInt(translationInfo.prefetchAhead, 10);
                        if (!isFinite(state.translationPrefetchAhead)) state.translationPrefetchAhead = 2;
                    } else {
                        state.translationAvailable = false;
                    }
                    loadHome();
                });
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
