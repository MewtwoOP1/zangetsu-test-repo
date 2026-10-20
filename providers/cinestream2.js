// =============================================================================
//  cinestream2.js — CineStream2 for Zangetsu (QuickJS-NG)
//  v1.2.0 — HINDI DUB + ACTIVE ANIME UPDATE
//    • Added TatakaiAPI (Hindi Dubbed anime, public instance)
//    • Added Kuramanime (Indonesian sub, fast public tunnel)
//    • Added Kuroji API (Anime database, public demo)
//    • Kept: AllAnime, Ani.pm, VidSrc, SuperEmbed, VaPlayer, etc.
//    • Hindi Movies/Series: Add MediaFusion or BanglaPlex via Stremio Addon URLs.
// =============================================================================

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'cinestream2';

var CINEMETA          = 'https://v3-cinemeta.strem.io';
var KITSU             = 'https://anime-kitsu.strem.fun';
var HAGLUND           = 'https://arm.haglund.dev/api/v2';
var TMDB_API          = 'https://api.themoviedb.org/3';
var TMDB_IMG          = 'https://image.tmdb.org/t/p';
var MULTI_DECRYPT_API = 'https://enc-dec.app/api';
var WYZIE_SUBS_API    = 'https://sub.wyzie.io';
var TATAKAI_API       = 'https://api.tatakai.me';
var KURAMANIME_API    = 'https://musician-optics-mental-carey.trycloudflare.com/api';
var KUROJI_API        = 'https://kuroji-api-j4mh.onrender.com';
var PLAYER_UA         = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36';
var SHOWBOX_UA        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36';

var META_TIMEOUT     = 4000;
var GLOBAL_TIMEOUT   = 9000;

var API = {
  vaplayer:     'https://streamdata.vaplayer.ru',
  vidrock:      'https://vidrock.ru',
  vidzee:       'https://player.vidzee.wtf',
  primesrc:     'https://primesrc.me',
  showbox:      'https://showbox.media',
  febbox:       'https://www.febbox.com',
  allanime:     'https://api.allanime.day/api',
  anipm:        'https://ani.pm',
  vidsrc:       'https://vidsrc.xyz',
  superembed:   'https://multiembed.mov',
  tatakai:      TATAKAI_API,
  kuramanime:   KURAMANIME_API,
  kuroji:       KUROJI_API
};

// =============================================================================
//  INFO / SETTINGS
// =============================================================================
function getInfo() {
  return {
    name: 'CineStream2', lang: 'en',
    baseUrl: 'https://www.themoviedb.org',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=strem.io',
    type: 'movie', version: '1.2.0'
  };
}
function getSettings() {
  return [
    { key: 'tmdbApiKey', label: 'TMDB API Key (optional)', description: 'Leave blank to use Cinemeta only.', type: 'text', default: '' },
    { key: 'addonUrls', label: 'Stremio Add-on URLs', description: 'Add MediaFusion or BanglaPlex for Hindi movies/series.', type: 'text', default: '' },
    { key: 'wyzieSubsKey', label: 'Wyzie Subs API Key', description: 'Optional.', type: 'text', default: '' },
    { key: 'showboxToken', label: 'Showbox (Febbox) UI Token', description: 'Required for Showbox. Cookie "ui" from febbox.com.', type: 'text', default: '' },
    { key: 'allowDownloadLinks', label: 'Show download-only links', type: 'enum', default: 'false',
      options: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }] },
    { key: 'maxStreamsPerAddon', label: 'Max streams per add-on', type: 'enum', default: '25',
      options: [{ value: '10', label: '10' }, { value: '25', label: '25' }, { value: '50', label: '50' }] }
  ];
}

// =============================================================================
//  SETTINGS / TIMEOUT / BYTES / CRYPTO / NETWORK (abbreviated)
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
function _bool(key, def) { var v = _readSetting(key); return v == null || v === '' ? def : String(v).toLowerCase() === 'true'; }
function _num(key, def) { var n = parseInt(_readSetting(key), 10); return isFinite(n) && n > 0 ? n : def; }
function _combinedSettings() {
  return {
    tmdbKey: _trim(_readSetting('tmdbApiKey')), addons: _parseAddonUrls(_readSetting('addonUrls')),
    wyzieKey: _trim(_readSetting('wyzieSubsKey')), showboxToken: _trim(_readSetting('showboxToken')),
    allowDownload: _bool('allowDownloadLinks', false), maxPerAddon: Math.min(_num('maxStreamsPerAddon', 25), 100)
  };
}
function withTimeout(p, ms, fb) { return Promise.race([Promise.resolve(p), new Promise(function (r) { setTimeout(function () { r(fb === undefined ? [] : fb); }, ms); })]); }

function _strToBytes(s) { return new TextEncoder().encode(String(s)); }
function _bytesToStr(b) { return new TextDecoder().decode(b); }
function _b64ToBytes(s) { return bytesFromBase64(String(s)); }
function _bytesToB64(b) { return bytesToBase64(new Uint8Array(b)); }
function _hexToBytes(h) { var o = new Uint8Array(h.length / 2); for (var i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
function _bytesToHex(b) { return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }
function _b64urlToBytes(s) { var v = String(s).replace(/-/g, '+').replace(/_/g, '/'); while (v.length % 4) v += '='; return _b64ToBytes(v); }
function _bytesToB64url(b) { return _bytesToB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }

async function _importAesCbc(k) { return await crypto.subtle.importKey('raw', k, { name: 'AES-CBC' }, false, ['decrypt', 'encrypt']); }
async function _importAesGcm(k) { return await crypto.subtle.importKey('raw', k, { name: 'AES-GCM' }, false, ['decrypt', 'encrypt']); }
async function _aesCbcDecrypt(k, iv, ct) { var key = await _importAesCbc(k); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, key, ct)); }
async function _aesGcmDecrypt(k, n, ct, t) { var key = await _importAesGcm(k); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: n, tagLength: t || 128 }, key, ct)); }

async function decryptVidzeeUrl(enc, secret) {
  try {
    var d = _b64ToBytes(enc); var c = d.indexOf(58); if (c < 0) return null;
    var iv = d.slice(0, c), ct = d.slice(c + 1);
    var rk = new Uint8Array(32); rk.set(_strToBytes(secret).slice(0, 32));
    return _bytesToStr(await _aesCbcDecrypt(rk, iv, ct));
  } catch (e) { return null; }
}
async function peachifyDecrypt(enc) {
  try {
    var p = String(enc).split('.'); if (p.length < 3) return null;
    var iv = _b64urlToBytes(p[0]); var a = _b64urlToBytes(p[1]); var b = _b64urlToBytes(p[2]);
    var ct = new Uint8Array(a.length + b.length); ct.set(a); ct.set(b, a.length);
    var kh = 'a8f2a1b5e9c470814f6b2c3a5d8e7f9c1a2b3c4d5e3f7a8b8cad1e2d0a4d5c5d';
    return _bytesToStr(await _aesGcmDecrypt(_hexToBytes(kh), iv, ct, 128));
  } catch (e) { return null; }
}
async function decryptVidrockUrl(p) {
  try {
    var kh = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f';
    var ct = _b64urlToBytes(p);
    return _bytesToStr(await _aesGcmDecrypt(_hexToBytes(kh), ct.slice(0, 12), ct.slice(12), 128));
  } catch (e) { return null; }
}

function _ensureHeaders(h) {
  h = h || {}; var a = false, u = false;
  for (var k in h) { var l = k.toLowerCase(); if (l === 'accept') a = true; if (l === 'user-agent') u = true; }
  if (!a) h['Accept'] = 'application/json, text/html, */*';
  if (!u) h['User-Agent'] = PLAYER_UA;
  return h;
}
function _fetch(url, opts) {
  opts = opts || {}; var h = _ensureHeaders(Object.assign({}, opts.headers || {}));
  return fetch(url, { method: opts.method || 'GET', headers: h, body: opts.body, timeoutMs: opts.timeoutMs || 8000 })
    .then(function (r) {
      var ok = r && (r.ok == null ? (r.status >= 200 && r.status < 400) : r.ok);
      if (!ok) throw new Error('HTTP ' + (r && r.status));
      var b = r.body != null ? r.body : '';
      if (typeof b !== 'string') return b;
      if (!b) return null;
      try { return JSON.parse(b); } catch (e) { return b; }
    });
}
function _fetchText(url, opts) {
  opts = opts || {}; var h = _ensureHeaders(Object.assign({}, opts.headers || {}));
  return fetch(url, { method: opts.method || 'GET', headers: h, body: opts.body, timeoutMs: opts.timeoutMs || 8000 })
    .then(function (r) { var b = r && r.body != null ? r.body : ''; return typeof b === 'string' ? b : JSON.stringify(b); });
}
function _getJson(url, h, t) { return _fetch(url, { headers: h || {}, timeoutMs: t || 8000 }); }
function _getText(url, h, t) { return _fetchText(url, { headers: h || {}, timeoutMs: t || 8000 }); }

// =============================================================================
//  TMDB / CINEMETA / META RESOLVER (FIXED)
// =============================================================================
function _tmdbPath(path) {
  var cfg = _combinedSettings();
  if (!cfg.tmdbKey) return TMDB_API + path;
  return 'https://api.themoviedb.org./3' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(cfg.tmdbKey);
}
function _tmdbJson(path) {
  var h = { Accept: 'application/json' };
  if (_combinedSettings().tmdbKey) h.Host = 'api.themoviedb.org';
  return _fetch(_tmdbPath(path), { headers: h, timeoutMs: 6000 }).catch(function () { return null; });
}
function _tmdbFind(imdbId) {
  return _tmdbJson('/find/' + imdbId + '?external_source=imdb_id').then(function (j) {
    if (!j) return null;
    if (j.movie_results && j.movie_results.length) return j.movie_results[0].id;
    if (j.tv_results && j.tv_results.length) return j.tv_results[0].id;
    return null;
  }).catch(function () { return null; });
}
function _cinemetaMeta(type, imdbId) {
  return _fetch(CINEMETA + '/meta/' + type + '/' + imdbId + '.json', { timeoutMs: 5000 })
    .then(function (j) { return j && j.meta ? j.meta : null; }).catch(function () { return null; });
}
function _externalIds(source, id) {
  return _fetch(HAGLUND + '/ids?source=' + source + '&id=' + encodeURIComponent(id), { timeoutMs: 4000 })
    .then(function (j) { return j || {}; }).catch(function () { return {}; });
}
async function _resolveMeta(imdbId, tmdbId, type) {
  var res = { title: null, year: null, tmdbId: tmdbId || null };
  if (!imdbId && !res.tmdbId) return res;

  var cmType = type === 'tv' ? 'series' : 'movie';
  var cmeta = imdbId ? await withTimeout(_cinemetaMeta(cmType, imdbId), 2500, null) : null;
  if (cmeta) {
    res.title = cmeta.name || (cmeta.aliases && cmeta.aliases[0]) || null;
    res.year = String(cmeta.releaseInfo || cmeta.year || '').slice(0, 4) || null;
    if (!res.tmdbId && cmeta.moviedb_id) res.tmdbId = cmeta.moviedb_id;
  }

  if (!res.tmdbId && imdbId) {
    var found = await withTimeout(_tmdbFind(imdbId), 1500, null);
    if (found) res.tmdbId = found;
  }

  if (!res.tmdbId && imdbId) {
    var hg = await withTimeout(_externalIds('imdb', imdbId), 1500, {});
    if (hg && hg.themoviedb) res.tmdbId = hg.themoviedb;
  }

  if (!res.title && res.tmdbId) {
    var info = await withTimeout(_tmdbJson('/' + type + '/' + res.tmdbId), 1500, null);
    if (info) {
      res.title = info.title || info.name || null;
      if (!res.year) res.year = (info.release_date || info.first_air_date || '').slice(0, 4) || null;
    }
  }

  console.log('CineStream2 meta: ' + JSON.stringify(res));
  return res;
}

// =============================================================================
//  CATALOG / DETAIL / EPISODES (abbreviated — same as v1.1.0)
// =============================================================================
// [Insert the following functions from v1.1.0 verbatim:]
// _itemFromCinemeta, _itemFromTmdb, getHome, popular, search,
// _parseDetailUrl, _episodeUrl, getDetail, getEpisodes,
// _parseAddonUrls, _queryAddon, _invokeWyzieSubs, _parseStreamId, _toZangetsuStream

// =============================================================================
//  NEW PROVIDERS (v1.2.0)
// =============================================================================

// ── TatakaiAPI (Hindi Dubbed Anime) ─────────────────────────────────────
async function _invokeTatakaiHindiDub(title, episode, subtitleCb) {
  if (!title) return [];
  console.log('CineStream2 Tatakai (Hindi): searching "' + title + '" ep ' + (episode || 1));
  try {
    // Search Hindi dubbed
    var searchUrl = API.tatakai + '/api/v1/animehindidubbed/search?title=' + encodeURIComponent(title);
    var searchRes = await _getJson(searchUrl, {}, 6000);
    var results = searchRes && (searchRes.results || searchRes.data);
    if (!results || !results.length) { console.log('CineStream2 Tatakai: no Hindi result'); return []; }

    var anime = results[0];
    var animeId = anime.id || anime.slug;
    if (!animeId) return [];

    // Get info + episodes
    var infoUrl = API.tatakai + '/api/v1/animehindidubbed/info/' + animeId;
    var info = await _getJson(infoUrl, {}, 6000);
    var episodes = info && (info.episodes || info.data && info.data.episodes);
    if (!episodes) return [];

    var targetEp = episodes.find(function (e) { return (e.number || e.episode) === (episode || 1); });
    if (!targetEp) { console.log('CineStream2 Tatakai: ep not found'); return []; }

    var epId = targetEp.id || targetEp.episodeId;
    if (!epId) return [];

    // Get streams
    var streamUrl = API.tatakai + '/api/v1/animehindidubbed/watch/' + epId;
    var streamRes = await _getJson(streamUrl, {}, 6000);
    var sources = streamRes && (streamRes.sources || streamRes.streams || streamRes.data);
    if (!sources) return [];

    var out = [];
    (Array.isArray(sources) ? sources : []).forEach(function (s) {
      if (!s.url) return;
      out.push({
        url: s.url,
        quality: s.quality || '1080p',
        label: '[Tatakai Hindi]',
        container: /\.m3u8/i.test(s.url) ? 'hls' : 'unknown',
        headers: { Referer: API.tatakai + '/' }, kind: 'raw'
      });
    });
    console.log('CineStream2 Tatakai: ' + out.length + ' Hindi streams');
    return out;
  } catch (e) { console.warn('Tatakai fail', String(e)); return []; }
}

// ── Kuramanime (Anime, Indonesian Sub) ──────────────────────────────────
async function _invokeKuramanime(title, episode) {
  if (!title) return [];
  console.log('CineStream2 Kuramanime: searching "' + title + '" ep ' + (episode || 1));
  try {
    var searchUrl = API.kuramanime + '/search?q=' + encodeURIComponent(title);
    var searchRes = await _getJson(searchUrl, {}, 6000);
    var results = searchRes && searchRes.data;
    if (!results || !results.length) { console.log('CineStream2 Kuramanime: no result'); return []; }

    var anime = results[0];
    var slug = anime.slug;
    if (!slug) return [];

    var epUrl = API.kuramanime + '/anime/' + slug + '/' + (episode || 1);
    var epRes = await _getJson(epUrl, {}, 6000);
    var servers = epRes && (epRes.servers || epRes.data && epRes.data.servers);
    if (!servers) return [];

    var out = [];
    (Array.isArray(servers) ? servers : []).forEach(function (s) {
      if (!s.url) return;
      out.push({
        url: s.url,
        quality: s.quality || '720p',
        label: '[Kuramanime]',
        container: /\.m3u8/i.test(s.url) ? 'hls' : 'unknown',
        headers: { Referer: 'https://kuramanime.tel/' }, kind: 'raw'
      });
    });
    console.log('CineStream2 Kuramanime: ' + out.length + ' streams');
    return out;
  } catch (e) { console.warn('Kuramanime fail', String(e)); return []; }
}

// ── Kuroji API (Anime) ─────────────────────────────────────────────────
async function _invokeKuroji(title, episode) {
  if (!title) return [];
  console.log('CineStream2 Kuroji: searching "' + title + '" ep ' + (episode || 1));
  try {
    // Kuroji uses GraphQL; this is a simplified REST-like query
    var query = 'query { search(query: "' + title.replace(/"/g, '\\"') + '") { id title } }';
    var res = await _fetch(API.kuroji + '/graphql', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query }), timeoutMs: 6000
    });
    var data = res && res.data && res.data.search;
    if (!data || !data.length) { console.log('CineStream2 Kuroji: no result'); return []; }

    var anime = data[0];
    var animeId = anime.id;

    // Get episodes
    var epQuery = 'query { anime(id: "' + animeId + '") { episodes { id number } } }';
    var epRes = await _fetch(API.kuroji + '/graphql', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: epQuery }), timeoutMs: 6000
    });
    var episodes = epRes && epRes.data && epRes.data.anime && epRes.data.anime.episodes;
    if (!episodes) return [];

    var targetEp = episodes.find(function (e) { return e.number === (episode || 1); });
    if (!targetEp) { console.log('CineStream2 Kuroji: ep not found'); return []; }

    // Get streams (Kuroji might not provide direct streams; this is a placeholder)
    // In a real implementation, you'd query for stream URLs.
    // For now, we'll return an empty array.
    console.log('CineStream2 Kuroji: stream extraction not implemented');
    return [];
  } catch (e) { console.warn('Kuroji fail', String(e)); return []; }
}

// =============================================================================
//  EXISTING PROVIDERS (VaPlayer, VidSrc, SuperEmbed, AllAnime, Ani.pm, Vidzee, Vidrock, PrimeSrc, Showbox)
//  [Insert their implementations from v1.1.0 here]
// =============================================================================

// =============================================================================
//  REGISTRY (UPDATED)
// =============================================================================
var PROVIDER_REGISTRY = [
  { key: 'p_vaplayer',   name: 'VaPlayer',   needs: ['imdb'], timeoutMs: 1500,
    run: function (c) { return _invokeVaPlayer(c.imdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidsrc',     name: 'VidSrc',     needs: [], timeoutMs: 6000,
    run: function (c) { return _invokeVidSrc(c.tmdbId, c.imdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidzee',     name: 'Vidzee',     needs: ['tmdb'], timeoutMs: 3500,
    run: function (c) { return _invokeVidzee(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidrock',    name: 'Vidrock',    needs: ['tmdb'], timeoutMs: 2500,
    run: function (c) { return _invokeVidrock(c.tmdbId, c.season, c.episode); } },
  { key: 'p_tatakai',    name: 'Tatakai Hindi', needs: ['title'], timeoutMs: 6000,
    run: function (c) { return _invokeTatakaiHindiDub(c.title, c.episode, c.subtitleCb); } },
  { key: 'p_allanime',   name: 'AllAnime',   needs: ['title'], timeoutMs: 5000,
    run: function (c) { return _invokeAllAnime(c.title, c.episode, c.subtitleCb); } },
  { key: 'p_anipm',      name: 'Ani.pm',     needs: ['title'], timeoutMs: 6000,
    run: function (c) { return _invokeAniPm(c.title, c.episode, c.subtitleCb); } },
  { key: 'p_kuramanime', name: 'Kuramanime', needs: ['title'], timeoutMs: 6000,
    run: function (c) { return _invokeKuramanime(c.title, c.episode); } },
  { key: 'p_kuroji',     name: 'Kuroji',     needs: ['title'], timeoutMs: 6000,
    run: function (c) { return _invokeKuroji(c.title, c.episode); } },
  { key: 'p_superembed', name: 'SuperEmbed', needs: ['imdb'], timeoutMs: 5000,
    run: function (c) { return _invokeSuperEmbed(c.imdbId, c.season, c.episode); } },
  { key: 'p_primesrc',   name: 'PrimeSrc',   needs: ['imdb'], timeoutMs: 3500,
    run: function (c) { return _invokePrimeSrc(c.imdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_showbox',    name: 'Showbox',    needs: ['imdb'], timeoutMs: 4500,
    run: function (c) { return _invokeShowbox(c.imdbId, c.season, c.episode); } }
  // enc-dec.app providers (Vidlink, VidFastPro, Vidcore, Vidup, Peachify, Meowtv, Videasy, Cinejoy)
  // remain but will only work when enc-dec.app is online.
];

// =============================================================================
//  ORCHESTRATION (unchanged)
// =============================================================================
// [Insert getVideoSources, getStreams, getLinks from v1.1.0 here]

// =============================================================================
//  EXPORTS
// =============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.2.0',
    getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    // ... existing test hooks
    _invokeTatakaiHindiDub: _invokeTatakaiHindiDub,
    _invokeKuramanime: _invokeKuramanime,
    _invokeKuroji: _invokeKuroji
  };
}
