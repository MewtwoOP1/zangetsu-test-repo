// =============================================================================
//  cinestream2.js — CineStream2 for Zangetsu
//  v2.1.2 — Restored Anime Metadata (Kitsu/Haglund), fixed episode mapping
// =============================================================================

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'cinestream2';

// ── Polyfills for QuickJS-NG ────────────────────────────────────────────
var _b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
var _btoa = (typeof btoa !== 'undefined') ? btoa : function(input) {
    var str = String(input); var output = '';
    for (var block, charCode, idx = 0, map = _b64chars; str.charAt(idx | 0) || (map = '=', idx % 1); output += map.charAt(63 & block >> 8 - idx % 1 * 8)) {
        charCode = str.charCodeAt(idx += 3 / 4);
        if (charCode > 0xFF) throw new Error("'btoa' failed");
        block = block << 8 | charCode;
    }
    return output;
};
var _atob = (typeof atob !== 'undefined') ? atob : function(input) {
    var str = String(input).replace(/=+$/, '');
    if (str.length % 4 == 1) throw new Error("'atob' failed");
    for (var bc = 0, bs, buffer, idx = 0, output = ''; buffer = str.charAt(idx++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
        buffer = _b64chars.indexOf(buffer);
    }
    return output;
};

// ── Endpoints ───────────────────────────────────────────────────────────
var CINEMETA = "https://v3-cinemeta.strem.io";
var KITSU_API = "https://anime-kitsu.strem.fun";
var HAGLUND_API = "https://arm.haglund.dev/api/v2";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_IMG = "https://image.tmdb.org/t/p";
var VA_PLAYER = "https://streamdata.vaplayer.ru";
var VIDROCK = "https://vidrock.to";
var VIDZEE = "https://player.vidzee.wtf";
var MULTI_DECRYPT = "https://enc-dec.app/api";
var SHOWBOX = "https://showbox.media";
var FEBBOX = "https://www.febbox.com";
var ANIKOTO_API = "https://anikotoapi.fampep.workers.dev";
var KISSKH = "https://kisskh.is";
var ANIMESALT = "https://animesalt.ac";
var VIDFAST = "https://vidfast.vc";
var HEXA = "https://theemoviedb.hexa.su";
var CINEJOY = "https://api.shegu.st";
var CINEJOY_BASE = "https://cinejoy.to";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// =============================================================================
//  INFO / SETTINGS
// =============================================================================
function getInfo() {
    return {
        name: 'CineStream2', lang: 'en',
        baseUrl: 'https://www.themoviedb.org',
        logo: 'https://www.google.com/s2/favicons?sz=256&domain=strem.io',
        type: 'movie', version: '2.1.2'
    };
}

function getSettings() {
    return [
        { key: 'tmdbApiKey', label: 'TMDB API Key (optional)', description: 'Required for TMDB catalog items.', type: 'text', default: '' },
        { key: 'showboxToken', label: 'Showbox (Febbox) UI Token', description: 'Required for Showbox.', type: 'text', default: '' },
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
        var r = await fetch(url, { method: opts.method || "GET", headers: headers, body: opts.body, timeoutMs: opts.timeoutMs || 10000 });
        if (!r) throw new Error("Empty");
        var text = r.body;
        return typeof text !== "string" ? JSON.stringify(text) : text;
    } catch (e) { return ""; }
}

async function fetchJson(url, opts) {
    var text = await fetchText(url, opts);
    try { return JSON.parse(text); } catch(e) { return null; }
}

function base64ToBytes(b64) {
    try {
        var bin = _atob(b64);
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
    return _btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function slugify(text) {
    if (!text) return "";
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// =============================================================================
//  CRYPTO
// =============================================================================
async function decryptVidzeeUrl(encryptedUrl, secret) {
    try {
        var decodedString = _atob(encryptedUrl);
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

function _itemFromKitsu(m) {
    if (!m || !m.id) return null;
    var url = 'tmdb://anime/' + m.id.replace("kitsu:", "kitsu-");
    var title = (m.aliases && m.aliases.length && m.aliases[0]) || m.name || '';
    if (!title) return null;
    return { id: url, url: url, title: title, cover: m.poster || null, banner: m.background || null, type: 'movie', sourceId: SOURCE_ID, kitsuId: m.id.replace("kitsu:", "") };
}

function _itemFromCinemeta(m) {
    if (!m || !m.id) return null;
    var isTv = m.type === 'series';
    var url = 'tmdb://' + (isTv ? 'tv' : 'movie') + '/' + m.id;
    var title = (m.aliases && m.aliases.length && m.aliases[0]) || m.name || '';
    if (!title) return null;
    var item = { id: url, url: url, title: _year(m) ? title + ' (' + _year(m) + ')' : title, cover: m.poster || null, banner: m.background || null, type: 'movie', sourceId: SOURCE_ID, imdbId: m.id, tmdbIsTv: isTv };
    if (m.moviedb_id) item.tmdbId = m.moviedb_id;
    if (m.imdbRating) item.score = Math.round(Number(m.imdbRating) * 10);
    return item;
}

async function getHome(opts) {
    var jobs = [
        fetchText(CINEMETA + "/catalog/movie/top.json"),
        fetchText(CINEMETA + "/catalog/series/top.json"),
        fetchText(KITSU_API + "/catalog/anime/kitsu-anime-trending.json")
    ];
    var rows = await Promise.all(jobs);
    var lists = [];
    
    if (rows[0]) { try { var j = JSON.parse(rows[0]); if (j.metas) lists.push({ title: 'Top Movies', items: j.metas.map(_itemFromCinemeta).filter(Boolean) }); } catch(e){} }
    if (rows[1]) { try { var j = JSON.parse(rows[1]); if (j.metas) lists.push({ title: 'Top Series', items: j.metas.map(_itemFromCinemeta).filter(Boolean) }); } catch(e){} }
    if (rows[2]) { try { var j = JSON.parse(rows[2]); if (j.metas) lists.push({ title: 'Trending Anime', items: j.metas.map(_itemFromKitsu).filter(Boolean) }); } catch(e){} }
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
    var jobs = [
        fetchText(CINEMETA + '/catalog/movie/top/search=' + encodeURIComponent(q) + '.json'),
        fetchText(CINEMETA + '/catalog/series/top/search=' + encodeURIComponent(q) + '.json'),
        fetchText(KITSU_API + '/catalog/anime/kitsu-anime-trending/search=' + encodeURIComponent(q) + '.json')
    ];
    var rows = await Promise.all(jobs);
    var out = [];
    if (rows[0]) { try { var j = JSON.parse(rows[0]); if (j.metas) j.metas.forEach(function(m) { var i = _itemFromCinemeta(m); if (i) out.push(i); }); } catch(e){} }
    if (rows[1]) { try { var j = JSON.parse(rows[1]); if (j.metas) j.metas.forEach(function(m) { var i = _itemFromCinemeta(m); if (i) out.push(i); }); } catch(e){} }
    if (rows[2]) { try { var j = JSON.parse(rows[2]); if (j.metas) j.metas.forEach(function(m) { var i = _itemFromKitsu(m); if (i) out.push(i); }); } catch(e){} }
    return out;
}

function _parseDetailUrl(value) {
    var s = String(value || ''); if (!s) return null;
    var m = s.match(/^tmdb:\/\/anime\/kitsu-(\d+)/i);
    if (m) return { kind: 'kitsu', id: m[1] };
    m = s.match(/^tmdb:\/\/(movie|tv|series)\/([^\/?#]+)/i);
    if (m) {
        var kind = m[1].toLowerCase() === 'movie' ? 'movie' : 'tv';
        var id = decodeURIComponent(m[2]);
        if (/^tt\d+$/.test(id)) return { kind: kind === 'movie' ? 'movie' : 'series', id: id };
        if (/^\d+$/.test(id)) return { kind: 'tmdb', type: kind, id: id };
    }
    return null;
}

function _episodeUrl(imdbId, tmdbId, season, episode, kitsuId, anilistId, malId) {
    return JSON.stringify({
        id: imdbId || (tmdbId ? 'tmdb:' + tmdbId : ''),
        imdbId: imdbId || undefined, tmdbId: tmdbId || undefined,
        kitsuId: kitsuId || undefined, anilistId: anilistId || undefined, malId: malId || undefined,
        type: kitsuId ? 'series' : (season ? 'series' : 'movie'),
        season: season || 0, episode: episode || 0
    });
}

async function getDetail(url, opts) {
    var parsed = _parseDetailUrl(url); if (!parsed) return null;
    
    if (parsed.kind === 'kitsu') {
        var kitsuRes = await fetchText(KITSU_API + '/meta/series/kitsu%3A' + parsed.id + '.json');
        if (!kitsuRes) return null;
        var meta; try { meta = JSON.parse(kitsuRes).meta; } catch(e) { return null; }
        if (!meta) return null;

        // Bridge Kitsu to IMDB/TMDB/AniList/MAL via Haglund
        var hgRes = await fetchText(HAGLUND_API + '/ids?source=kitsu&id=' + parsed.id);
        var hg = {}; try { hg = JSON.parse(hgRes) || {}; } catch(e) {}

        var imdbId = hg.imdb || null;
        var tmdbId = hg.themoviedb || null;
        var anilistId = hg.anilist || null;
        var malId = hg.myanimelist || null;

        var title = (meta.aliases && meta.aliases[0]) || meta.name || 'Untitled';
        var episodes = (meta.videos || []).map(function(v) {
            return { id: String(v.season) + 'x' + String(v.episode), title: 'S' + String(v.season).padStart(2, '0') + 'E' + String(v.episode).padStart(2, '0') + ' - ' + (v.title || ''), number: v.episode, season: v.season, url: _episodeUrl(imdbId, tmdbId, v.season, v.episode, parsed.id, anilistId, malId), date: v.firstAired || null, thumbnail: v.thumbnail || null };
        });
        
        return { id: url, url: url, title: title, cover: meta.poster || null, banner: meta.background || null, description: meta.description || '', status: 'unknown', genres: meta.genres || [], studios: [], type: 'movie', sourceId: SOURCE_ID, year: _year(meta), imdbId: imdbId, tmdbId: tmdbId, kitsuId: parsed.id, anilistId: anilistId, malId: malId, tmdbIsTv: true, episodes: episodes, subCount: episodes.length, dubCount: 0 };
    }
    
    if (parsed.kind === 'movie' || parsed.kind === 'series') {
        var cmRes = await fetchText(CINEMETA + '/meta/' + (parsed.kind === 'series' ? 'series' : 'movie') + '/' + parsed.id + '.json');
        if (!cmRes) return null;
        var meta; try { meta = JSON.parse(cmRes).meta; } catch(e) { return null; }
        if (!meta) return null;
        
        var isTv = parsed.kind === 'series';
        var title = (meta.aliases && meta.aliases[0]) || meta.name || 'Untitled';
        var imdbId = meta.imdb_id || parsed.id;
        var tmdbId = meta.moviedb_id || null;
        var episodes = isTv
            ? (meta.videos || []).filter(function(v) { return v.season !== 0; }).sort(function(a,b) { return (a.season-b.season)||(a.episode-b.episode); }).map(function(v) {
                return { id: String(v.season) + 'x' + String(v.episode), title: 'S' + String(v.season).padStart(2, '0') + 'E' + String(v.episode).padStart(2, '0') + ' - ' + (v.name || ''), number: v.episode, season: v.season, url: _episodeUrl(imdbId, tmdbId, v.season, v.episode), date: v.firstAired || null, thumbnail: v.thumbnail || null };
            })
            : [{ id: 'movie', title: title, number: 1, url: _episodeUrl(imdbId, tmdbId, 0, 0) }];
        return { id: url, url: url, title: title, cover: meta.poster || null, banner: meta.background || null, description: meta.description || '', status: 'unknown', genres: meta.genre || [], studios: [], type: 'movie', sourceId: SOURCE_ID, year: _year(meta), imdbId: imdbId, tmdbId: tmdbId, tmdbIsTv: isTv, episodes: episodes, subCount: episodes.length, dubCount: 0 };
    }

    if (parsed.kind === 'tmdb') {
        var key = _readSetting('tmdbApiKey'); if (!key) return null;
        var info = await fetchJson(TMDB_API + '/' + parsed.type + '/' + parsed.id + '?api_key=' + key + '&append_to_response=external_ids');
        if (!info || info.status_code) return null;
        var isTv = parsed.type === 'tv';
        var title = info.title || info.name || 'Untitled';
        var imdbId = info.external_ids ? info.external_ids.imdb_id : null;
        var episodes = [];
        if (isTv && info.seasons) {
            for (var i = 0; i < info.seasons.length; i++) {
                var s = info.seasons[i]; if (s.season_number === 0) continue;
                var epData = await fetchJson(TMDB_API + '/tv/' + parsed.id + '/season/' + s.season_number + '?api_key=' + key);
                if (epData && epData.episodes) epData.episodes.forEach(function(ep) {
                    episodes.push({ id: String(ep.season_number) + 'x' + String(ep.episode_number), title: 'S' + String(ep.season_number).padStart(2, '0') + 'E' + String(ep.episode_number).padStart(2, '0') + ' - ' + (ep.name || ''), number: ep.episode_number, season: ep.season_number, url: _episodeUrl(imdbId, parsed.id, ep.season_number, ep.episode_number), date: ep.air_date || null, thumbnail: ep.still_path ? TMDB_IMG + '/w300' + ep.still_path : null });
                });
            }
        } else if (!isTv) {
            episodes = [{ id: 'movie', title: title, number: 1, url: _episodeUrl(imdbId, parsed.id, 0, 0) }];
        }
        return { id: url, url: url, title: title, cover: info.poster_path ? TMDB_IMG + '/w500' + info.poster_path : null, banner: info.backdrop_path ? TMDB_IMG + '/w780' + info.backdrop_path : null, description: info.overview || '', status: 'unknown', genres: (info.genres||[]).map(function(g){return g.name;}), studios: [], type: 'movie', sourceId: SOURCE_ID, year: (info.release_date||info.first_air_date||'').slice(0,4)||null, imdbId: imdbId, tmdbId: parsed.id, tmdbIsTv: isTv, episodes: episodes, subCount: episodes.length, dubCount: 0 };
    }
    
    return null;
}

function getEpisodes(url, opts) { return getDetail(url, opts).then(function(d) { return d && d.episodes ? d.episodes : []; }); }

function _parseStreamId(raw) {
    var item = raw && typeof raw === 'object' ? raw : null;
    if (!item) { var s = String(raw||''); if (s.charAt(0) === '{') { try { item = JSON.parse(s); } catch(e){} } if (!item) item = { id: s }; }
    var imdb = String(item.imdbId || item.imdb_id || '');
    var tmdb = item.tmdbId || item.tmdb_id || item.moviedb_id || null;
    var kitsu = item.kitsuId || null;
    var anilist = item.anilistId || null;
    var mal = item.malId || null;
    var type = item.type === 'tv' || item.type === 'series' ? 'series' : 'movie';
    var season = parseInt(item.season, 10) || 0;
    var episode = parseInt(item.episode, 10) || 0;
    return { type: type, season: season, episode: episode, imdbId: imdb || null, tmdbId: tmdb || null, kitsuId: kitsu, anilistId: anilist, malId: mal };
}

async function _resolveMeta(parsed) {
    var meta = { title: null, year: null, imdbId: parsed.imdbId, tmdbId: parsed.tmdbId };
    if (meta.imdbId) {
        try {
            var data = await fetchJson(CINEMETA + "/meta/" + (parsed.type === "series" ? "series" : "movie") + "/" + meta.imdbId + ".json");
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
        var data = await fetchJson(url, { "Referer": referer });
        var out = [];
        if (data && data.data && data.data.stream_urls) data.data.stream_urls.forEach(function(u) { if (u) out.push({ url: fixUrl(u), quality: "Auto", label: "[VaPlayer]", container: u.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: { "Referer": referer } }); });
        if (data && data.default_subs) data.default_subs.forEach(function(s) { if (s.url) subCallback({ url: fixUrl(s.url), lang: s.lang || s.code || "Unknown" }); });
        return out;
    } catch(e) { return []; }
}

async function getVidrock(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var type = season == null ? "movie" : "tv";
    var query = season == null ? tmdbId : tmdbId + "_" + season + "_" + episode;
    var headers = { "Origin": VIDROCK, "Referer": VIDROCK + "/" };
    try {
        var data = await fetchJson(VIDROCK + "/api/" + type + "/" + query + "/", { headers: headers });
        var out = [];
        for (var key in data) {
            var enc = data[key].url;
            if (enc && enc !== "error" && enc !== "null") { var dec = await decryptVidrockUrl(enc); if (dec) out.push({ url: fixUrl(dec), quality: "Auto", label: "[Vidrock " + key + "]", container: dec.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: headers }); }
        }
        return out;
    } catch(e) { return []; }
}

async function getVidzee(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var secret = _atob("QTdrUDl4TTJRdjhMcjROejFIdDZZYzNCdzVKZjBEc1U=");
    var out = [];
    for (var i = 0; i < [0,1,2,4,5,6,7].length; i++) {
        var sr = [0,1,2,4,5,6,7][i];
        try {
            var url = season == null ? VIDZEE + "/api/server?id=" + tmdbId + "&sr=" + sr : VIDZEE + "/api/server?id=" + tmdbId + "&sr=" + sr + "&ss=" + season + "&ep=" + episode;
            var data = await fetchJson(url);
            var globalHeaders = {};
            if (data.headers) { for (var h in data.headers) globalHeaders[h] = data.headers[h]; }
            if (data.url) for (var j = 0; j < data.url.length; j++) {
                var item = data.url[j];
                if (item.link) {
                    var finalUrl = await decryptVidzeeUrl(item.link, secret);
                    if (finalUrl && finalUrl.indexOf("https:") > -1) {
                        var headersMap = Object.assign({}, globalHeaders);
                        out.push({ url: fixUrl(finalUrl), quality: "1080p", label: "[VidZee " + (item.name||"") + " (" + (item.lang||"Unknown") + ")]", container: item.type === "hls" || finalUrl.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: headersMap });
                    }
                }
            }
            if (data.tracks) data.tracks.forEach(function(t) { if (t.url && t.lang) subCallback({ url: fixUrl(t.url), lang: t.lang }); });
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
        var shareJson = await fetchJson(SHOWBOX + "/index/share_link?id=" + mediaId + "&type=" + type, { headers: headers });
        if (!shareJson.data || !shareJson.data.link) return [];
        var shareKey = shareJson.data.link.split("/").pop();
        var fileJson = await fetchJson(FEBBOX + "/file/file_share_list?share_key=" + shareKey, { headers: headers });
        if (!fileJson.data || !fileJson.data.file_list) return [];
        var videoFile = null;
        if (season != null && episode != null) {
            var seasonFolder = fileJson.data.file_list.find(function(f) { return f.is_dir && (f.file_name||"").toLowerCase().indexOf("season " + season) > -1; }) || fileJson.data.file_list.find(function(f) { return f.is_dir; });
            if (!seasonFolder) return [];
            var epData = await fetchJson(FEBBOX + "/file/file_share_list?share_key=" + shareKey + "&parent_id=" + seasonFolder.fid, { headers: headers });
            if (epData.data && epData.data.file_list) videoFile = epData.data.file_list.find(function(f) { return !f.is_dir && (f.file_name||"").toLowerCase().indexOf("e" + (episode<10?"0":"") + episode) > -1; }) || epData.data.file_list.find(function(f) { return !f.is_dir; });
        } else videoFile = fileJson.data.file_list.find(function(f) { return !f.is_dir; });
        if (!videoFile) return [];
        var qualJson = await fetchJson(FEBBOX + "/console/video_quality_list?fid=" + videoFile.fid + "&share_key=" + shareKey, { headers: Object.assign({}, headers, { "Cookie": token.indexOf("ui=") === 0 ? token : "ui=" + token }) });
        if (!qualJson.html) return [];
        var out = [], re = /<div[^>]*class="[^"]*file_quality[^"]*"[^>]*>/g, match;
        while ((match = re.exec(qualJson.html)) !== null) {
            var u = (match[0].match(/data-url="([^"]+)"/) || [])[1], q = (match[0].match(/data-quality="([^"]+)"/) || [])[1];
            if (u && q) out.push({ url: fixUrl(u.replace(/\\\//g, '/')), quality: q === 'ORG' ? '2160p' : (q.match(/\d{3,4}/) || ['Auto'])[0] + 'p', label: '[ShowBox]', container: u.indexOf('.m3u8') > -1 ? 'hls' : 'unknown', headers: headers });
        }
        return out;
    } catch(e) { return []; }
}

async function getAnikoto(title, year, episode, subCallback) {
    if (!title) return [];
    var headers = { "referer": "https://anikototv.to/", "x-requested-with": "XMLHttpRequest" };
    try {
        var filterHtml = await fetchText(ANIKOTO_API + "/filter?keyword=" + encodeURIComponent(title) + "&type=&year%5B%5D=" + (year||"") + "&ep_min=&ep_max=&sort=default");
        var dataTipMatch = filterHtml.match(/class="tip ani"[^>]*data-tip="([^"]+)"/);
        if (!dataTipMatch) return [];
        var infoJson = await fetchJson(ANIKOTO_API + "/ajax/episode/list/" + dataTipMatch[1] + "?vrf=", { headers: headers });
        var epMatch = infoJson.result.match(new RegExp('data-num="' + (episode||1) + '"[^>]*data-ids="([^"]+)"'));
        if (!epMatch) return [];
        var serversJson = await fetchJson(ANIKOTO_API + "/ajax/server/list?servers=" + epMatch[1], { headers: headers });
        var linkIdRegex = /data-link-id="([^"]+)"/g, linkIdMatch, out = [];
        while ((linkIdMatch = linkIdRegex.exec(serversJson.result)) !== null) {
            var serverJson = await fetchJson(ANIKOTO_API + "/ajax/server?get=" + linkIdMatch[1], { headers: headers });
            var embedUrl = serverJson.result ? serverJson.result.url : null;
            if (embedUrl) { var direct = await resolveEmbed(embedUrl); if (direct) out.push(direct); }
        }
        return out;
    } catch(e) { return []; }
}

async function resolveEmbed(embedUrl) {
    try {
        var html = await fetchText(embedUrl);
        var m3u8Match = html.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
        if (m3u8Match) return { url: fixUrl(m3u8Match[1]), quality: "1080p", label: "[Embed]", container: "hls", headers: { "Referer": embedUrl } };
        var megaMatch = html.match(/id="megaplay-player"[^>]*data-id="([^"]+)"/) || html.match(/data-id="([^"]+)"/);
        if (megaMatch) {
            var json = await fetchJson('https://megaplay.buzz/stream/getSources?id=' + megaMatch[1] + '&type=' + (embedUrl.indexOf('/dub') > -1 ? 'dub' : 'sub'));
            if (json && json.sources && json.sources.file) return { url: fixUrl(json.sources.file), quality: "1080p", label: "[MegaPlay]", container: "hls", headers: { "Referer": "https://megaplay.buzz/", "Origin": "https://megaplay.buzz" } };
        }
        return null;
    } catch(e) { return null; }
}

async function getKissKH(title, year, season, episode, subCallback) {
    if (!title) return [];
    try {
        var searchRes = await fetchJson(KISSKH + "/api/DramaList/Search?q=" + encodeURIComponent(title) + "&type=" + (season == null ? "2" : "1"), { "Referer": KISSKH + "/" });
        if (!searchRes || !searchRes.length) return [];
        var detailRes = await fetchJson(KISSKH + "/api/DramaList/Drama/" + searchRes[0].id + "?isq=false", { "Referer": KISSKH + "/" });
        if (!detailRes || !detailRes.episodes) return [];
        var targetEp = detailRes.episodes.find(function(e) { return e.number === (episode || 1); });
        if (!targetEp) return [];
        var encRes = await fetchJson(MULTI_DECRYPT + "/enc-kisskh?text=" + targetEp.id + "&type=vid", { "Referer": KISSKH });
        if (!encRes || !encRes.result) return [];
        var streamRes = await fetchJson(KISSKH + "/api/DramaList/Episode/" + targetEp.id + ".png?err=false&ts=&time=&kkey=" + encRes.result, { "Referer": KISSKH });
        if (!streamRes || !streamRes.Video) return [];
        var direct = await resolveEmbed(streamRes.Video); if (direct) return [direct];
        return [{ url: fixUrl(streamRes.Video), quality: "720p", label: "[KissKH]", container: streamRes.Video.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: { "Referer": KISSKH, "Origin": KISSKH } }];
    } catch(e) { return []; }
}

async function getAnimesalt(title, season, episode, subCallback) {
    var slug = slugify(title); if (!slug) return [];
    var headers = { "Referer": ANIMESALT + "/", "User-Agent": USER_AGENT };
    try {
        var html = await fetchText(season == null ? ANIMESALT + "/movies/" + slug + "/" : ANIMESALT + "/episode/" + slug + "-" + season + "x" + episode + "/", { headers: headers });
        var iframeMatch = html.match(/src="(https:\/\/as-cdn\d+\.top\/video\/([a-f0-9]+))"/);
        if (!iframeMatch) return [];
        var data = await fetchJson(iframeMatch[1].split("/video/")[0] + "/player/index.php?data=" + iframeMatch[2] + "&do=getVideo", { method: "POST", headers: { "Referer": ANIMESALT + "/", "Origin": iframeMatch[1].split("/video/")[0], "X-Requested-With": "XMLHttpRequest" }, body: "hash=" + iframeMatch[2] + "&r=" + encodeURIComponent(ANIMESALT + "/") });
        var m3u8 = data.videoSource || data.securedLink;
        return m3u8 ? [{ url: fixUrl(m3u8), quality: "1080p", label: "[AnimeSalt]", container: "hls", headers: headers }] : [];
    } catch(e) { return []; }
}

async function getVidfast(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var headers = { "User-Agent": USER_AGENT, "Referer": VIDFAST + "/" };
    try {
        var html = await fetchText(season == null ? VIDFAST + "/movie/" + tmdbId + "/" : VIDFAST + "/tv/" + tmdbId + "/" + season + "/" + episode + "/", { headers: headers });
        var m = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/); if (!m) return [];
        var data = await fetchJson(MULTI_DECRYPT + "/enc-vidfast?text=" + encodeURIComponent(m[1]));
        if (!data.result || !data.result.servers || !data.result.stream) return [];
        var postHeaders = Object.assign({}, headers, { "X-CSRF-Token": data.result.token });
        var serversDec = await fetchJson(MULTI_DECRYPT + "/dec-vidfast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: await fetchText(data.result.servers, { method: "POST", headers: postHeaders }) }) });
        if (!serversDec.result) return [];
        var out = [];
        for (var i = 0; i < serversDec.result.length; i++) {
            var server = serversDec.result[i]; if (!server.data) continue;
            var streamDec = await fetchJson(MULTI_DECRYPT + "/dec-vidfast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: await fetchText(data.result.stream + "/" + server.data, { method: "POST", headers: postHeaders }) }) });
            if (streamDec.result && streamDec.result.url) {
                out.push({ url: fixUrl(streamDec.result.url), quality: streamDec.result.is4kAvailable ? "2160p" : "1080p", label: "[Vidfast " + (server.name||"") + "]", container: streamDec.result.url.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: postHeaders });
                if (streamDec.result.tracks) streamDec.result.tracks.forEach(function(t) { if (t.file && t.label) subCallback({ url: fixUrl(t.file), lang: t.label }); });
            }
        }
        return out;
    } catch(e) { return []; }
}

async function getHexa(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var keyBytes = new Uint8Array(32); if (crypto.getRandomValues) crypto.getRandomValues(keyBytes);
    var key = Array.from(keyBytes).map(function(b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    try {
        var token = await fetchJson(MULTI_DECRYPT + "/enc-hexa");
        var encData = await fetchText(season == null ? HEXA + "/api/tmdb/movie/" + tmdbId + "/images" : HEXA + "/api/tmdb/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "/images", { headers: { "User-Agent": USER_AGENT, "Accept": "text/plain", "X-Api-Key": key, "X-Fingerprint-Lite": "e9136c41504646444", "Referer": "https://hexa.su/", "X-Cap-Token": token.result.token } });
        var decRes = await fetchJson(MULTI_DECRYPT + "/dec-hexa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: encData, key: key }) });
        if (!decRes.result) return [];
        var out = [];
        decRes.result.sources.forEach(function(src) { if (src.url) out.push({ url: fixUrl(src.url), quality: "1080p", label: "[Hexa " + (src.server||"") + "]", container: src.url.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: { "Referer": "https://hexa.su/" } }); });
        return out;
    } catch(e) { return []; }
}

async function getCinejoy(title, imdbId, tmdbId, year, season, episode, subCallback) {
    var headers = { "Accept": "*/*", "Origin": CINEJOY_BASE, "Referer": CINEJOY_BASE + "/", "User-Agent": USER_AGENT };
    try {
        var serversRes = await fetchJson(CINEJOY + "/servers", { headers: headers });
        if (!serversRes.servers) return [];
        var out = [];
        for (var i = 0; i < serversRes.servers.length; i++) {
            var server = serversRes.servers[i].name;
            var encRes = await fetchJson(MULTI_DECRYPT + "/enc-cinejoy?url=" + encodeURIComponent(CINEJOY + "/?title=" + encodeURIComponent(title||"") + "&type=" + (season != null ? "series" : "movie") + "&year=" + (year||"") + "&imdb=" + (imdbId||"") + "&tmdb=" + (tmdbId||"") + "&server=" + server + (season != null ? "&season=" + season + "&episode=" + episode : "")));
            if (!encRes.result || !encRes.result.data) continue;
            var encryptedResponse = await fetch(CINEJOY + "/g", { method: "POST", headers: headers, body: base64UrlToBytes(encRes.result.data) });
            var decRes = await fetchJson(MULTI_DECRYPT + "/dec-cinejoy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: bytesToBase64Url(new Uint8Array(await encryptedResponse.arrayBuffer())), state: encRes.result.state }) });
            if (!decRes.result || !decRes.result.data || decRes.result.data.error) continue;
            decRes.result.data.stream.forEach(function(st) {
                if (st.type === "hls" && st.playlist) out.push({ url: fixUrl(st.playlist), quality: "1080p", label: "[Cinejoy " + server + "]", container: "hls", headers: headers });
                else if (st.type === "file" && st.qualities) for (var qk in st.qualities) if (st.qualities[qk].url) out.push({ url: fixUrl(st.qualities[qk].url), quality: qk === "4k" ? "2160p" : qk === "1080" ? "1080p" : qk === "720" ? "720p" : qk === "480" ? "480p" : "Auto", label: "[Cinejoy " + server + " " + qk + "]", container: st.qualities[qk].url.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: headers });
                if (st.captions) st.captions.forEach(function(c) { if (c.url) subCallback({ url: fixUrl(c.url), lang: c.language || c.id || "Unknown" }); });
            });
        }
        return out;
    } catch(e) { return []; }
}

// =============================================================================
//  ORCHESTRATOR
// =============================================================================
async function getVideoSources(episodeUrl, opts) {
    opts = opts || {};
    var parsed = _parseStreamId(episodeUrl);
    var meta = await _resolveMeta(parsed);
    var subs = [];
    var subCallback = function(s) { if (s && s.url) subs.push(s); };
    
    var tasks = [];
    var safe = function(fn) { return withTimeout(fn, 15000, []).catch(function() { return []; }); };
    
    // Standard providers (use IMDB/TMDB)
    if (_bool('enableVaPlayer', true)) tasks.push(safe(getVaPlayer(meta.imdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableVidrock', true)) tasks.push(safe(getVidrock(meta.tmdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableVidzee', true)) tasks.push(safe(getVidzee(meta.tmdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableShowbox', false)) tasks.push(safe(getShowbox(meta.imdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableVidfast', true)) tasks.push(safe(getVidfast(meta.tmdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableHexa', true)) tasks.push(safe(getHexa(meta.tmdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableCinejoy', true)) tasks.push(safe(getCinejoy(meta.title, meta.imdbId, meta.tmdbId, meta.year, parsed.season, parsed.episode, subCallback)));
    
    // Anime providers (use title + absolute episode)
    if (_bool('enableAnikoto', true)) tasks.push(safe(getAnikoto(meta.title, meta.year, parsed.episode, subCallback)));
    if (_bool('enableKissKH', true)) tasks.push(safe(getKissKH(meta.title, meta.year, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableAnimeSalt', true)) tasks.push(safe(getAnimesalt(meta.title, parsed.season, parsed.episode, subCallback)));
    
    var results = await Promise.all(tasks);
    var out = [], seen = {};
    results.forEach(function(list) {
        if (!list) return;
        list.forEach(function(s) { if (s && s.url && !seen[s.url]) { seen[s.url] = true; out.push(s); } });
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
        version: '2.1.2',
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
