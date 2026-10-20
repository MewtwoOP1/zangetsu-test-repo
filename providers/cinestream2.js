// =============================================================================
//  cinestream2.js — CineStream2 for Zangetsu
//  v2.1.0 — Updated domains, added provider toggle checkboxes, fixed APIs
// =============================================================================

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'cinestream2';

// ── Updated Endpoints ───────────────────────────────────────────────────
var CINEMETA = "https://v3-cinemeta.strem.io";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_IMG = "https://image.tmdb.org/t/p";
var VA_PLAYER = "https://streamdata.vaplayer.ru";
var VIDROCK = "https://vidrock.to"; // Updated from .ru
var VIDZEE = "https://player.vidzee.wtf";
var MULTI_DECRYPT = "https://enc-dec.app/api";
var SHOWBOX = "https://showbox.media";
var FEBBOX = "https://www.febbox.com";
var ANIKOTO_API = "https://anikotoapi.fampep.workers.dev"; // Updated to API endpoint
var KISSKH = "https://kisskh.is"; // Updated from .nl
var ANIMESALT = "https://animesalt.ac";
var VIDFAST = "https://vidfast.vc";
var HEXA = "https://theemoviedb.hexa.su";
var CINEJOY = "https://api.shegu.st";
var CINEJOY_BASE = "https://cinejoy.to";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// =============================================================================
//  INFO / SETTINGS (with Toggles)
// =============================================================================
function getInfo() {
    return {
        name: 'CineStream2', lang: 'en',
        baseUrl: 'https://www.themoviedb.org',
        logo: 'https://www.google.com/s2/favicons?sz=256&domain=strem.io',
        type: 'movie', version: '2.1.0'
    };
}

function getSettings() {
    return [
        { key: 'tmdbApiKey', label: 'TMDB API Key (optional)', description: 'Required for TMDB catalog items.', type: 'text', default: '' },
        { key: 'showboxToken', label: 'Showbox (Febbox) UI Token', description: 'Required for Showbox.', type: 'text', default: '' },
        // Toggles for each provider
        { key: 'enableVaPlayer', label: 'Enable VaPlayer', type: 'bool', default: true },
        { key: 'enableVidrock', label: 'Enable Vidrock', type: 'bool', default: true },
        { key: 'enableVidzee', label: 'Enable Vidzee', type: 'bool', default: true },
        { key: 'enableShowbox', label: 'Enable Showbox', type: 'bool', default: false },
        { key: 'enableVidfast', label: 'Enable Vidfast', type: 'bool', default: true },
        { key: 'enableHexa', label: 'Enable Hexa', type: 'bool', default: true },
        { key: 'enableCinejoy', label: 'Enable Cinejoy', type: 'bool', default: true },
        { key: 'enableAnikoto', label: 'Enable Anikoto', type: 'bool', default: true },
        { key: 'enableKissKH', label: 'Enable KissKH', type: 'bool', default: true },
        { key: 'enableAnimeSalt', label: 'Enable AnimeSalt', type: 'bool', default: true },
        { key: 'debug', label: 'Debug logging', type: 'bool', default: false }
    ];
}

// =============================================================================
//  UTILITIES & NETWORK
// =============================================================================
function _readSetting(key) {
    try {
        if (typeof __settings === 'undefined' || !__settings) return null;
        if (__settings[SOURCE_ID] && __settings[SOURCE_ID][key] != null) return __settings[SOURCE_ID][key];
        if (__settings[key] != null) return __settings[key];
        return null;
    } catch (e) { return null; }
}
function _trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
function _bool(key, def) {
    var v = _readSetting(key);
    if (v == null || v === '') return def;
    return String(v).toLowerCase() === 'true' || v === true;
}

function withTimeout(promise, ms, fallback) {
    return Promise.race([
        Promise.resolve(promise).catch(function (e) { throw e; }),
        new Promise(function (resolve) { setTimeout(function () { resolve(fallback === undefined ? [] : fallback); }, ms); })
    ]);
}

function fixUrl(url, base) {
    if (!url) return "";
    url = String(url).trim();
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
    if (url.indexOf("//") === 0) return "https:" + url;
    if (base) {
        if (url.indexOf("/") === 0) {
            var domainParts = base.split("/");
            if (domainParts.length > 2) return domainParts[0] + "//" + domainParts[2] + url;
        }
        return base + (base.endsWith("/") ? "" : "/") + url;
    }
    return "https://" + url;
}

async function fetchText(url, opts) {
    opts = opts || {};
    var headers = Object.assign({ "User-Agent": USER_AGENT }, opts.headers || {});
    try {
        var r = await fetch(url, {
            method: opts.method || "GET",
            headers: headers,
            body: opts.body,
            timeoutMs: opts.timeoutMs || 10000
        });
        if (!r) throw new Error("Empty response");
        var text = r.body;
        if (typeof text !== "string") text = JSON.stringify(text);
        return text;
    } catch (e) { return ""; }
}

async function fetchJson(url, opts) {
    var text = await fetchText(url, opts);
    try { return JSON.parse(text); } catch(e) { return null; }
}

function base64ToBytes(b64) {
    try {
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    } catch (e) { return new Uint8Array(0); }
}

function base64UrlToBytes(s) {
    var v = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (v.length % 4) v += '=';
    return base64ToBytes(v);
}

function bytesToBase64Url(b) {
    var bin = '';
    for (var i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function slugify(text) {
    if (!text) return "";
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// =============================================================================
//  CRYPTO FUNCTIONS
// =============================================================================
async function decryptVidzeeUrl(encryptedUrl, secret) {
    try {
        var decodedString = atob(encryptedUrl);
        var parts = decodedString.split(":");
        if (parts.length < 2) return null;
        var iv = base64ToBytes(parts[0]);
        var ct = base64ToBytes(parts[1]);
        var keyBytes = new Uint8Array(32);
        keyBytes.set(new TextEncoder().encode(secret).slice(0, 32));
        var key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
        var decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, key, ct);
        return new TextDecoder().decode(decrypted);
    } catch(e) { return null; }
}

async function decryptVidrockUrl(payload) {
    try {
        var keyHex = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";
        var keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g).map(function(b) { return parseInt(b, 16); }));
        var b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4) b64 += "=";
        var encryptedData = base64ToBytes(b64);
        var nonce = encryptedData.slice(0, 12);
        var ct = encryptedData.slice(12);
        var key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
        var decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, ct);
        return new TextDecoder().decode(decrypted);
    } catch(e) { return null; }
}

// =============================================================================
//  CATALOG & DETAILS
// =============================================================================
function _year(rec) {
    return String(rec.release_date || rec.first_air_date || rec.releaseInfo || rec.year || '').slice(0, 4) || null;
}
function _tmdbUrl(type, id) { return 'tmdb://' + (type === 'tv' || type === 'series' ? 'tv' : 'movie') + '/' + String(id); }

function _itemFromCinemeta(m) {
    if (!m || !m.id) return null;
    var isTv = m.type === 'series';
    var url = _tmdbUrl(isTv ? 'tv' : 'movie', m.id);
    var title = (m.aliases && m.aliases.length && m.aliases[0]) || m.name || '';
    if (!title) return null;
    var item = { id: url, url: url, title: _year(m) ? title + ' (' + _year(m) + ')' : title, cover: m.poster || null, banner: m.background || null, type: 'movie', sourceId: SOURCE_ID, imdbId: m.id, tmdbIsTv: isTv };
    if (m.moviedb_id) item.tmdbId = m.moviedb_id;
    if (m.imdbRating) item.score = Math.round(Number(m.imdbRating) * 10);
    return item;
}
function _itemFromTmdb(rec, forcedType) {
    if (!rec || rec.id == null || rec.media_type === 'person') return null;
    var isTv = forcedType === 'tv' || rec.media_type === 'tv' || rec.first_air_date != null;
    if (rec.media_type && rec.media_type !== 'movie' && rec.media_type !== 'tv') return null;
    var title = _trim(rec.title || rec.name || '');
    if (!title) return null;
    var url = _tmdbUrl(isTv ? 'tv' : 'movie', rec.id);
    return { id: url, url: url, title: _year(rec) ? title + ' (' + _year(rec) + ')' : title, cover: rec.poster_path ? TMDB_IMG + '/w500' + rec.poster_path : null, banner: rec.backdrop_path ? TMDB_IMG + '/w780' + rec.backdrop_path : null, type: 'movie', sourceId: SOURCE_ID, tmdbId: rec.id, tmdbIsTv: isTv };
}

async function getHome(opts) {
    var jobs = [
        fetchText(CINEMETA + "/catalog/movie/top.json").catch(function () { return null; }),
        fetchText(CINEMETA + "/catalog/series/top.json").catch(function () { return null; }),
        fetchText(CINEMETA + "/catalog/anime/kitsu-anime-trending.json").catch(function () { return null; })
    ];
    var rows = await Promise.all(jobs);
    var lists = [];
    function addRow(title, list) { if (list && list.length) lists.push({ title: title, items: list }); }
    
    if (rows[0]) { try { var j = JSON.parse(rows[0]); if (j.metas) addRow('Top Movies', j.metas.map(_itemFromCinemeta).filter(Boolean)); } catch(e){} }
    if (rows[1]) { try { var j = JSON.parse(rows[1]); if (j.metas) addRow('Top Series', j.metas.map(_itemFromCinemeta).filter(Boolean)); } catch(e){} }
    if (rows[2]) { try { var j = JSON.parse(rows[2]); if (j.metas) addRow('Trending Anime', j.metas.map(_itemFromCinemeta).filter(Boolean)); } catch(e){} }
    return lists;
}

async function popular(opts) {
    var rows = await getHome(opts);
    var out = [];
    rows.forEach(function (r) { r.items.forEach(function (i) { out.push(i); }); });
    return out;
}

async function search(query, page, opts) {
    var q = _trim(query); if (!q) return [];
    var res = await fetchText(CINEMETA + '/catalog/movie/top/search=' + encodeURIComponent(q) + '.json');
    var out = [];
    if (res) { try { var j = JSON.parse(res); if (j.metas) out = j.metas.map(_itemFromCinemeta).filter(Boolean); } catch(e){} }
    return out;
}

function _parseDetailUrl(value) {
    var s = String(value || ''); if (!s) return null;
    var m = s.match(/^tmdb:\/\/(movie|tv|series)\/([^\/?#]+)/i);
    if (m) {
        var kind = m[1].toLowerCase() === 'movie' ? 'movie' : 'tv';
        var id = decodeURIComponent(m[2]);
        if (/^tt\d+$/.test(id)) return { kind: kind === 'movie' ? 'movie' : 'series', id: id };
        if (/^\d+$/.test(id)) return { kind: 'tmdb', type: kind, id: id };
    }
    m = s.match(/^(tt\d+)/); if (m) return { kind: 'movie', id: m[1] };
    return null;
}

function _episodeUrl(type, imdbId, tmdbId, season, episode) {
    var kind = type === 'tv' || type === 'series' ? 'series' : 'movie';
    return JSON.stringify({ id: imdbId || (tmdbId ? 'tmdb:' + tmdbId : ''), videoId: imdbId || (tmdbId ? 'tmdb:' + tmdbId : ''), imdbId: imdbId || undefined, tmdbId: tmdbId || undefined, type: kind, season: season || 0, episode: episode || 0 });
}

async function getDetail(url, opts) {
    var parsed = _parseDetailUrl(url); if (!parsed) return null;
    
    if (parsed.kind === 'movie' || parsed.kind === 'series') {
        var cmType = parsed.kind === 'series' ? 'series' : 'movie';
        var res = await fetchText(CINEMETA + '/meta/' + cmType + '/' + parsed.id + '.json');
        if (!res) return null;
        var meta;
        try { meta = JSON.parse(res).meta; } catch(e) { return null; }
        if (!meta) return null;
        var isTv = parsed.kind === 'series';
        var title = (meta.aliases && meta.aliases[0]) || meta.name || 'Untitled';
        var imdbId = meta.imdb_id || parsed.id;
        var tmdbId = meta.moviedb_id || null;
        var episodes = isTv
            ? (meta.videos || []).filter(function (v) { return v.season !== 0; }).sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); }).map(function (v) {
                return { id: String(v.season) + 'x' + String(v.episode), title: 'S' + String(v.season).padStart(2, '0') + 'E' + String(v.episode).padStart(2, '0') + ' - ' + (v.name || ''), number: v.episode, season: v.season, url: _episodeUrl('series', imdbId, tmdbId, v.season, v.episode), date: v.firstAired || null, thumbnail: v.thumbnail || null };
            })
            : [{ id: 'movie', title: title, number: 1, url: _episodeUrl('movie', imdbId, tmdbId, 0, 0) }];
        return { id: url, url: url, title: title, cover: meta.poster || null, banner: meta.background || null, description: meta.description || '', status: 'unknown', genres: meta.genre || meta.genres || [], studios: [], type: 'movie', sourceId: SOURCE_ID, year: String(meta.releaseInfo || meta.year || '').slice(0, 4) || null, imdbId: imdbId, tmdbId: tmdbId, tmdbIsTv: isTv, episodes: episodes, subCount: episodes.length, dubCount: 0 };
    }
    
    if (parsed.kind === 'tmdb') {
        var key = _readSetting('tmdbApiKey');
        if (!key) return null;
        
        var tmdbRes = await fetchText(TMDB_API + '/' + parsed.type + '/' + parsed.id + '?api_key=' + key + '&append_to_response=external_ids');
        if (!tmdbRes) return null;
        var info;
        try { info = JSON.parse(tmdbRes); } catch(e) { return null; }
        if (!info || info.status_code) return null;
        
        var isTv2 = parsed.type === 'tv';
        var title2 = info.title || info.name || 'Untitled';
        var imdbId2 = info.external_ids ? info.external_ids.imdb_id : null;
        var episodes2 = [];
        
        if (isTv2 && info.seasons) {
            for (var i = 0; i < info.seasons.length; i++) {
                var season = info.seasons[i];
                if (season.season_number === 0) continue;
                var epRes = await fetchText(TMDB_API + '/tv/' + parsed.id + '/season/' + season.season_number + '?api_key=' + key);
                if (epRes) {
                    try {
                        var epData = JSON.parse(epRes);
                        if (epData.episodes) {
                            epData.episodes.forEach(function(ep) {
                                episodes2.push({ id: String(ep.season_number) + 'x' + String(ep.episode_number), title: 'S' + String(ep.season_number).padStart(2, '0') + 'E' + String(ep.episode_number).padStart(2, '0') + ' - ' + (ep.name || ''), number: ep.episode_number, season: ep.season_number, url: _episodeUrl('series', imdbId2, parsed.id, ep.season_number, ep.episode_number), date: ep.air_date || null, thumbnail: ep.still_path ? TMDB_IMG + '/w300' + ep.still_path : null });
                            });
                        }
                    } catch(e) {}
                }
            }
        } else if (!isTv2) {
            episodes2 = [{ id: 'movie', title: title2, number: 1, url: _episodeUrl('movie', imdbId2, parsed.id, 0, 0) }];
        }
        
        return { id: url, url: url, title: title2, cover: info.poster_path ? TMDB_IMG + '/w500' + info.poster_path : null, banner: info.backdrop_path ? TMDB_IMG + '/w780' + info.backdrop_path : null, description: info.overview || '', status: 'unknown', genres: (info.genres || []).map(function(g) { return g.name; }), studios: [], type: 'movie', sourceId: SOURCE_ID, year: (info.release_date || info.first_air_date || '').slice(0, 4) || null, imdbId: imdbId2, tmdbId: parsed.id, tmdbIsTv: isTv2, episodes: episodes2, subCount: episodes2.length, dubCount: 0 };
    }
    
    return null;
}

function getEpisodes(url, opts) {
    return getDetail(url, opts).then(function (d) { return d && Array.isArray(d.episodes) ? d.episodes : []; });
}

function _parseStreamId(raw) {
    var item = raw && typeof raw === 'object' ? raw : null;
    if (!item) {
        var s = String(raw || '');
        if (s.charAt(0) === '{') { try { item = JSON.parse(s); } catch (e) {} }
        if (!item) item = { id: s };
    }
    var rawId = String(item.videoId || item.id || '');
    var kind = String(item.type || (item.season || item.episode ? 'series' : 'movie')).toLowerCase();
    var type = kind === 'series' || kind === 'tv' ? 'series' : 'movie';
    var season = parseInt(item.season, 10) || 0;
    var episode = parseInt(item.episode, 10) || 0;
    var imdb = String(item.imdbId || item.imdb_id || '');
    var tmdb = item.tmdbId || item.tmdb_id || item.moviedb_id || null;
    var ids = [], seen = {};
    function add(v) { v = String(v == null ? '' : v); if (v && !seen[v]) { seen[v] = true; ids.push(v); } }
    if (rawId && !/^(?:tmdb|cinestream|imdb):\/\//i.test(rawId) && /^(?:tt\d+|\d+)$/.test(rawId)) {
        if (!imdb && /^tt\d+$/.test(rawId)) imdb = rawId;
        if (!tmdb && /^\d+$/.test(rawId)) tmdb = rawId;
    }
    if (imdb) { if (type === 'series' && season > 0 && episode > 0) add(imdb + ':' + season + ':' + episode); add(imdb); }
    if (tmdb) { add(String(tmdb)); add('tmdb:' + (type === 'series' ? 'series' : 'movie') + ':' + String(tmdb)); if (type === 'series' && season > 0 && episode > 0) add('tmdb:series:' + String(tmdb) + ':' + season + ':' + episode); }
    return { ids: ids, type: type, season: season, episode: episode, imdbId: imdb || null, tmdbId: tmdb || null };
}

async function _resolveMeta(parsed) {
    var meta = { title: null, year: null, imdbId: parsed.imdbId, tmdbId: parsed.tmdbId };
    if (!meta.imdbId && !meta.tmdbId) return meta;
    
    if (meta.imdbId) {
        try {
            var res = await fetchText(CINEMETA + "/meta/" + (parsed.type === "series" ? "series" : "movie") + "/" + meta.imdbId + ".json");
            var data = JSON.parse(res);
            if (data && data.meta) {
                meta.title = data.meta.name || (data.meta.aliases && data.meta.aliases[0]);
                meta.year = parseInt(data.meta.releaseInfo || data.meta.year);
                if (!meta.tmdbId && data.meta.moviedb_id) meta.tmdbId = data.meta.moviedb_id;
            }
        } catch(e) {}
    }
    return meta;
}

// =============================================================================
//  STREAM PROVIDERS
// =============================================================================

async function getVaPlayer(imdbId, season, episode, subCallback) {
    if (!imdbId) return [];
    var referer = "https://nextgencloudfabric.com/";
    var url = season == null ? VA_PLAYER + "/api.php?imdb=" + imdbId + "&type=movie" : VA_PLAYER + "/api.php?imdb=" + imdbId + "&type=tv&season=" + season + "&episode=" + episode;
    try {
        var res = await fetchText(url, { "Referer": referer });
        var data = JSON.parse(res);
        var out = [];
        if (data && data.data && data.data.stream_urls) {
            data.data.stream_urls.forEach(function(u) {
                if (u) out.push({ url: fixUrl(u), quality: "Auto", label: "[VaPlayer]", container: u.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: { "Referer": referer } });
            });
        }
        if (data && data.default_subs) {
            data.default_subs.forEach(function(s) { if (s.url) subCallback({ url: fixUrl(s.url), lang: s.lang || s.code || "Unknown" }); });
        }
        return out;
    } catch(e) { return []; }
}

async function getVidrock(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var type = season == null ? "movie" : "tv";
    var query = season == null ? tmdbId : tmdbId + "_" + season + "_" + episode;
    var url = VIDROCK + "/api/" + type + "/" + query + "/";
    var headers = { "Origin": VIDROCK, "Referer": VIDROCK + "/" };
    try {
        var res = await fetchText(url, { headers: headers });
        var data = JSON.parse(res);
        var out = [];
        for (var key in data) {
            var enc = data[key].url;
            if (enc && enc !== "error" && enc !== "null") {
                var dec = await decryptVidrockUrl(enc);
                if (dec) out.push({ url: fixUrl(dec), quality: "Auto", label: "[Vidrock " + key + "]", container: dec.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: headers });
            }
        }
        return out;
    } catch(e) { return []; }
}

async function getVidzee(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var secret = atob("QTdrUDl4TTJRdjhMcjROejFIdDZZYzNCdzVKZjBEc1U=");
    var defaultReferer = VIDZEE + "/";
    var servers = [0, 1, 2, 4, 5, 6, 7];
    var out = [];
    for (var i = 0; i < servers.length; i++) {
        var sr = servers[i];
        try {
            var url = season == null ? VIDZEE + "/api/server?id=" + tmdbId + "&sr=" + sr : VIDZEE + "/api/server?id=" + tmdbId + "&sr=" + sr + "&ss=" + season + "&ep=" + episode;
            var data = JSON.parse(await fetchText(url));
            var globalHeaders = {};
            if (data.headers) { for (var h in data.headers) globalHeaders[h] = data.headers[h]; }
            if (data.url) {
                for (var j = 0; j < data.url.length; j++) {
                    var item = data.url[j];
                    if (item.link) {
                        var finalUrl = await decryptVidzeeUrl(item.link, secret);
                        if (finalUrl && finalUrl.indexOf("https:") > -1) {
                            var headersMap = Object.assign({}, globalHeaders);
                            var referer = headersMap["referer"] || defaultReferer;
                            var displayName = "[VidZee " + (item.name||"") + " (" + (item.lang||"Unknown") + ")]";
                            out.push({ url: fixUrl(finalUrl), quality: "1080p", label: displayName, container: item.type === "hls" || finalUrl.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: headersMap });
                        }
                    }
                }
            }
            if (data.tracks) { data.tracks.forEach(function(t) { if (t.url && t.lang) subCallback({ url: fixUrl(t.url), lang: t.lang }); }); }
        } catch(e) {}
    }
    return out;
}

async function getShowbox(imdbId, season, episode, subCallback) {
    var token = _readSetting("showboxToken");
    if (!imdbId || !token) return [];
    var headers = { "User-Agent": USER_AGENT, "Accept": "application/json, text/html, */*" };
    try {
        var searchHtml = await fetchText(SHOWBOX + "/search?keyword=" + imdbId, { headers: headers });
        var hrefMatch = searchHtml.match(/class="film-name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"/) || searchHtml.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*film-name[^"]*"/);
        if (!hrefMatch) return [];
        
        var detailHtml = await fetchText(fixUrl(hrefMatch[1], SHOWBOX), { headers: headers });
        var idMatch = detailHtml.match(/class="heading-name[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/);
        if (!idMatch) return [];
        var mediaId = parseInt(idMatch[1].split("/").pop());
        if (!mediaId) return [];
        
        var type = season != null ? 2 : 1;
        var shareJson = JSON.parse(await fetchText(SHOWBOX + "/index/share_link?id=" + mediaId + "&type=" + type, { headers: headers }));
        if (!shareJson.data || !shareJson.data.link) return [];
        var shareKey = shareJson.data.link.split("/").pop();
        
        var fileJson = JSON.parse(await fetchText(FEBBOX + "/file/file_share_list?share_key=" + shareKey, { headers: headers }));
        if (!fileJson.data || !fileJson.data.file_list) return [];
        
        var fileList = fileJson.data.file_list;
        var videoFile = null;
        
        if (season != null && episode != null) {
            var seasonFolder = fileList.find(function(f) { return f.is_dir && (f.file_name||"").toLowerCase().indexOf("season " + season) > -1; }) || fileList.find(function(f) { return f.is_dir; });
            if (!seasonFolder) return [];
            var epData = JSON.parse(await fetchText(FEBBOX + "/file/file_share_list?share_key=" + shareKey + "&parent_id=" + seasonFolder.fid, { headers: headers }));
            if (epData.data && epData.data.file_list) {
                videoFile = epData.data.file_list.find(function(f) { return !f.is_dir && (f.file_name||"").toLowerCase().indexOf("e" + (episode<10?"0":"") + episode) > -1; }) || epData.data.file_list.find(function(f) { return !f.is_dir; });
            }
        } else {
            videoFile = fileList.find(function(f) { return !f.is_dir; });
        }
        
        if (!videoFile) return [];
        
        var cookieToken = token.indexOf("ui=") === 0 ? token : "ui=" + token;
        var qualHeaders = Object.assign({}, headers, { "Cookie": cookieToken });
        var qualJson = JSON.parse(await fetchText(FEBBOX + "/console/video_quality_list?fid=" + videoFile.fid + "&share_key=" + shareKey, { headers: qualHeaders }));
        if (!qualJson.html) return [];
        
        var out = [];
        var re = /<div[^>]*class="[^"]*file_quality[^"]*"[^>]*>/g;
        var match;
        while ((match = re.exec(qualJson.html)) !== null) {
            var u = (match[0].match(/data-url="([^"]+)"/) || [])[1];
            var q = (match[0].match(/data-quality="([^"]+)"/) || [])[1];
            if (u && q) out.push({ url: fixUrl(u.replace(/\\\//g, '/')), quality: q === 'ORG' ? '2160p' : (q.match(/\d{3,4}/) || ['Auto'])[0] + 'p', label: '[ShowBox]', container: u.indexOf('.m3u8') > -1 ? 'hls' : 'unknown', headers: headers });
        }
        return out;
    } catch(e) { return []; }
}

async function getAnikoto(title, year, episode, subCallback) {
    if (!title) return [];
    var headers = { "referer": "https://anikototv.to/", "x-requested-with": "XMLHttpRequest" };
    try {
        // Use the dedicated API endpoint
        var filterHtml = await fetchText(ANIKOTO_API + "/filter?keyword=" + encodeURIComponent(title) + "&type=&year%5B%5D=" + (year||"") + "&ep_min=&ep_max=&sort=default");
        var dataTipMatch = filterHtml.match(/class="tip ani"[^>]*data-tip="([^"]+)"/);
        if (!dataTipMatch) return [];
        
        var infoJson = JSON.parse(await fetchText(ANIKOTO_API + "/ajax/episode/list/" + dataTipMatch[1] + "?vrf=", { headers: headers }));
        var epMatch = infoJson.result.match(new RegExp('data-num="' + (episode||1) + '"[^>]*data-ids="([^"]+)"'));
        if (!epMatch) return [];
        
        var serversJson = JSON.parse(await fetchText(ANIKOTO_API + "/ajax/server/list?servers=" + epMatch[1], { headers: headers }));
        var linkIdRegex = /data-link-id="([^"]+)"/g;
        var linkIdMatch;
        var out = [];
        while ((linkIdMatch = linkIdRegex.exec(serversJson.result)) !== null) {
            var serverJson = JSON.parse(await fetchText(ANIKOTO_API + "/ajax/server?get=" + linkIdMatch[1], { headers: headers }));
            var embedUrl = serverJson.result ? serverJson.result.url : null;
            if (embedUrl) {
                var direct = await resolveEmbed(embedUrl);
                if (direct) out.push(direct);
            }
        }
        return out;
    } catch(e) { return []; }
}

async function resolveEmbed(embedUrl) {
    try {
        var html = await fetchText(embedUrl);
        var m3u8Match = html.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
        if (m3u8Match) {
            return { url: fixUrl(m3u8Match[1]), quality: "1080p", label: "[Embed]", container: "hls", headers: { "Referer": embedUrl } };
        }
        var megaMatch = html.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
        if (megaMatch) {
            var streamId = megaMatch[1];
            var type = embedUrl.indexOf('/dub') > -1 ? 'dub' : 'sub';
            var json = await fetchJson('https://megaplay.buzz/stream/getSources?id=' + streamId + '&type=' + type);
            if (json && json.sources && json.sources.file) {
                return { url: fixUrl(json.sources.file), quality: "1080p", label: "[MegaPlay]", container: "hls", headers: { "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz" } };
            }
        }
        return null;
    } catch(e) { return null; }
}

async function getKissKH(title, year, season, episode, subCallback) {
    if (!title) return [];
    try {
        var type = season == null ? "2" : "1";
        // Updated domain to kisskh.is
        var searchRes = JSON.parse(await fetchText(KISSKH + "/api/DramaList/Search?q=" + encodeURIComponent(title) + "&type=" + type, { "Referer": KISSKH + "/" }));
        if (!searchRes || !searchRes.length) return [];
        
        var detailRes = JSON.parse(await fetchText(KISSKH + "/api/DramaList/Drama/" + searchRes[0].id + "?isq=false", { "Referer": KISSKH + "/" }));
        if (!detailRes || !detailRes.episodes) return [];
        var targetEp = detailRes.episodes.find(function(e) { return e.number === (episode || 1); });
        if (!targetEp) return [];
        
        var encRes = JSON.parse(await fetchText(MULTI_DECRYPT + "/enc-kisskh?text=" + targetEp.id + "&type=vid", { "Referer": KISSKH }));
        if (!encRes || !encRes.result) return [];
        
        var streamRes = JSON.parse(await fetchText(KISSKH + "/api/DramaList/Episode/" + targetEp.id + ".png?err=false&ts=&time=&kkey=" + encRes.result, { "Referer": KISSKH }));
        if (!streamRes || !streamRes.Video) return [];
        
        var direct = await resolveEmbed(streamRes.Video);
        if (direct) return [direct];
        
        return [{ url: fixUrl(streamRes.Video), quality: "720p", label: "[KissKH]", container: streamRes.Video.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: { "Referer": KISSKH, "Origin": KISSKH } }];
    } catch(e) { return []; }
}

async function getAnimesalt(title, season, episode, subCallback) {
    var slug = slugify(title);
    if (!slug) return [];
    var headers = { "Referer": ANIMESALT + "/", "User-Agent": USER_AGENT };
    try {
        var url = season == null ? ANIMESALT + "/movies/" + slug + "/" : ANIMESALT + "/episode/" + slug + "-" + season + "x" + episode + "/";
        var html = await fetchText(url, { headers: headers });
        var iframeMatch = html.match(/src="(https:\/\/as-cdn\d+\.top\/video\/([a-f0-9]+))"/);
        if (!iframeMatch) return [];
        
        var playerCdn = iframeMatch[1].split("/video/")[0];
        var data = JSON.parse(await fetchText(playerCdn + "/player/index.php?data=" + iframeMatch[2] + "&do=getVideo", { method: "POST", headers: { "Referer": ANIMESALT + "/", "Origin": playerCdn, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded" }, body: "hash=" + iframeMatch[2] + "&r=" + encodeURIComponent(ANIMESALT + "/") }));
        var m3u8 = data.videoSource || data.securedLink;
        if (!m3u8) return [];
        return [{ url: fixUrl(m3u8), quality: "1080p", label: "[AnimeSalt]", container: "hls", headers: headers }];
    } catch(e) { return []; }
}

async function getVidfast(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var url = season == null ? VIDFAST + "/movie/" + tmdbId + "/" : VIDFAST + "/tv/" + tmdbId + "/" + season + "/" + episode + "/";
    var headers = { "User-Agent": USER_AGENT, "Referer": VIDFAST + "/" };
    try {
        var html = await fetchText(url, { headers: headers });
        var m = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
        if (!m) return [];
        
        var data = JSON.parse(await fetchText(MULTI_DECRYPT + "/enc-vidfast?text=" + encodeURIComponent(m[1]))).result;
        if (!data || !data.servers || !data.stream || !data.token) return [];
        
        var postHeaders = Object.assign({}, headers, { "X-CSRF-Token": data.token });
        var serversEnc = await fetchText(data.servers, { method: "POST", headers: postHeaders });
        var serversDec = JSON.parse(await fetchText(MULTI_DECRYPT + "/dec-vidfast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: serversEnc }) }));
        if (!serversDec || !serversDec.result) return [];
        
        var out = [];
        for (var i = 0; i < serversDec.result.length; i++) {
            var server = serversDec.result[i];
            if (!server.data) continue;
            var streamEnc = await fetchText(data.stream + "/" + server.data, { method: "POST", headers: postHeaders });
            var streamDec = JSON.parse(await fetchText(MULTI_DECRYPT + "/dec-vidfast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: streamEnc }) }));
            if (streamDec && streamDec.result && streamDec.result.url) {
                out.push({ url: fixUrl(streamDec.result.url), quality: streamDec.result.is4kAvailable ? "2160p" : "1080p", label: "[Vidfast " + (server.name||"") + "]", container: streamDec.result.url.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: postHeaders });
                if (streamDec.result.tracks) { streamDec.result.tracks.forEach(function(t) { if (t.file && t.label) subCallback({ url: fixUrl(t.file), lang: t.label }); }); }
            }
        }
        return out;
    } catch(e) { return []; }
}

async function getHexa(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var url = season == null ? HEXA + "/api/tmdb/movie/" + tmdbId + "/images" : HEXA + "/api/tmdb/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "/images";
    var keyBytes = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(keyBytes);
    var key = Array.from(keyBytes).map(function(b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    try {
        var token = JSON.parse(await fetchText(MULTI_DECRYPT + "/enc-hexa")).result.token;
        var encData = await fetchText(url, { headers: { "User-Agent": USER_AGENT, "Accept": "text/plain", "X-Api-Key": key, "X-Fingerprint-Lite": "e9136c41504646444", "Referer": "https://hexa.su/", "X-Cap-Token": token } });
        var decRes = JSON.parse(await fetchText(MULTI_DECRYPT + "/dec-hexa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: encData, key: key }) }));
        if (!decRes || !decRes.result) return [];
        
        var out = [];
        decRes.result.sources.forEach(function(src) {
            if (src.url) out.push({ url: fixUrl(src.url), quality: "1080p", label: "[Hexa " + (src.server||"") + "]", container: src.url.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: { "Referer": "https://hexa.su/" } });
        });
        return out;
    } catch(e) { return []; }
}

async function getCinejoy(title, imdbId, tmdbId, year, season, episode, subCallback) {
    var isSeries = season != null && episode != null;
    var type = isSeries ? "series" : "movie";
    var headers = { "Accept": "*/*", "Origin": CINEJOY_BASE, "Referer": CINEJOY_BASE + "/", "User-Agent": USER_AGENT };
    try {
        var serversRes = JSON.parse(await fetchText(CINEJOY + "/servers", { headers: headers }));
        if (!serversRes || !serversRes.servers) return [];
        
        var out = [];
        for (var i = 0; i < serversRes.servers.length; i++) {
            var server = serversRes.servers[i].name;
            var targetUrl = CINEJOY + "/?title=" + encodeURIComponent(title||"") + "&type=" + type + "&year=" + (year||"") + "&imdb=" + (imdbId||"") + "&tmdb=" + (tmdbId||"") + "&server=" + server + (isSeries ? "&season=" + season + "&episode=" + episode : "");
            
            var encRes = JSON.parse(await fetchText(MULTI_DECRYPT + "/enc-cinejoy?url=" + encodeURIComponent(targetUrl)));
            if (!encRes || encRes.status !== 200 || !encRes.result || !encRes.result.data) continue;
            
            var encryptedResponse = await fetch(CINEJOY + "/g", { method: "POST", headers: headers, body: base64UrlToBytes(encRes.result.data) });
            var arrayBuffer = await encryptedResponse.arrayBuffer();
            var b64Encrypted = bytesToBase64Url(new Uint8Array(arrayBuffer));
            
            var decRes = JSON.parse(await fetchText(MULTI_DECRYPT + "/dec-cinejoy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: b64Encrypted, state: encRes.result.state }) }));
            if (!decRes || !decRes.result || !decRes.result.data || decRes.result.data.error) continue;
            
            var streams = decRes.result.data.stream || [];
            streams.forEach(function(st) {
                if (st.type === "hls" && st.playlist) out.push({ url: fixUrl(st.playlist), quality: "1080p", label: "[Cinejoy " + server + "]", container: "hls", headers: headers });
                else if (st.type === "file" && st.qualities) {
                    for (var qk in st.qualities) {
                        var q = st.qualities[qk];
                        if (q.url) out.push({ url: fixUrl(q.url), quality: qk === "4k" ? "2160p" : qk === "1080" ? "1080p" : qk === "720" ? "720p" : qk === "480" ? "480p" : "Auto", label: "[Cinejoy " + server + " " + qk + "]", container: q.url.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: headers });
                    }
                }
                if (st.captions) st.captions.forEach(function(c) { if (c.url) subCallback({ url: fixUrl(c.url), lang: c.language || c.id || "Unknown" }); });
            });
        }
        return out;
    } catch(e) { return []; }
}

// =============================================================================
//  ORCHESTRATOR (with Toggles)
// =============================================================================
async function getVideoSources(episodeUrl, opts) {
    opts = opts || {};
    var parsed = _parseStreamId(episodeUrl);
    if (!parsed.ids.length) return [];
    
    var meta = await _resolveMeta(parsed);
    var subs = [];
    var subCallback = function(s) { if (s && s.url) subs.push(s); };
    
    var tasks = [];
    if (_bool('enableVaPlayer', true)) tasks.push(getVaPlayer(meta.imdbId, parsed.season, parsed.episode, subCallback));
    if (_bool('enableVidrock', true)) tasks.push(getVidrock(meta.tmdbId, parsed.season, parsed.episode, subCallback));
    if (_bool('enableVidzee', true)) tasks.push(getVidzee(meta.tmdbId, parsed.season, parsed.episode, subCallback));
    if (_bool('enableShowbox', false)) tasks.push(getShowbox(meta.imdbId, parsed.season, parsed.episode, subCallback));
    if (_bool('enableVidfast', true)) tasks.push(getVidfast(meta.tmdbId, parsed.season, parsed.episode, subCallback));
    if (_bool('enableHexa', true)) tasks.push(getHexa(meta.tmdbId, parsed.season, parsed.episode, subCallback));
    if (_bool('enableCinejoy', true)) tasks.push(getCinejoy(meta.title, meta.imdbId, meta.tmdbId, meta.year, parsed.season, parsed.episode, subCallback));
    if (_bool('enableAnikoto', true)) tasks.push(getAnikoto(meta.title, meta.year, parsed.episode, subCallback));
    if (_bool('enableKissKH', true)) tasks.push(getKissKH(meta.title, meta.year, parsed.season, parsed.episode, subCallback));
    if (_bool('enableAnimeSalt', true)) tasks.push(getAnimesalt(meta.title, parsed.season, parsed.episode, subCallback));
    
    var results = await Promise.all(tasks.map(function(t) { return withTimeout(t, 15000, []); }));
    
    var out = [];
    var seen = {};
    results.forEach(function(list) {
        if (!list) return;
        list.forEach(function(s) {
            if (s && s.url && !seen[s.url]) { seen[s.url] = true; out.push(s); }
        });
    });
    
    if (typeof opts.onSubtitle === 'function') {
        var subSeen = {};
        subs.forEach(function(s) { if (!subSeen[s.url]) { subSeen[s.url] = true; opts.onSubtitle(s); } });
    } else if (typeof opts.subtitleCallback === 'function') {
        var subSeen2 = {};
        subs.forEach(function(s) { if (!subSeen2[s.url]) { subSeen2[s.url] = true; opts.subtitleCallback(s); } });
    }
    
    console.log("CineStream2 DONE: " + out.length + " streams | " + (meta.title || "?") + " | imdb=" + (meta.imdbId || "?"));
    return out;
}

function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

// =============================================================================
//  EXPORTS
// =============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        version: '2.1.0',
        getInfo: getInfo,
        getSettings: getSettings,
        getHome: getHome,
        popular: popular,
        search: search,
        getDetail: getDetail,
        getEpisodes: getEpisodes,
        getVideoSources: getVideoSources,
        getStreams: getStreams,
        getLinks: getLinks,
        _parseStreamId: _parseStreamId
    };
}
