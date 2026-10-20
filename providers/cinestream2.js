// =============================================================================
//  cinestream2.js — CineStream2 provider for Zangetsu (QuickJS-NG)
//
//  v1.0.3 — META-RESOLUTION FIX + SHOWBOX RESTORED
//    • New _resolveMeta(): Cinemeta + TMDB /find in parallel + TMDB detail fallback
//    • All tmdbId/title-dependent providers now correctly await the shared meta
//    • metaPromise cap: 700ms → 1500ms (real-world networks complete)
//    • Showbox restored (1 attempt, 800ms/request, 2200ms total)
//    • Fixed Cinejoy double-fetch bug
//
//  v1.0.2 — SPEED RELEASE (removed Moviebox, Castle; parallelised servers)
//  v1.0.1 — tmdb:// scheme, videoId, moviedb_id, TMDB path fix
//  v1.0.0 — initial port
// =============================================================================

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID)
  : 'cinestream2';

var CINEMETA            = 'https://v3-cinemeta.strem.io';
var KITSU               = 'https://anime-kitsu.strem.fun';
var HAGLUND             = 'https://arm.haglund.dev/api/v2';
var TMDB_API            = 'https://api.themoviedb.org/3';
var TMDB_IMG            = 'https://image.tmdb.org/t/p';
var IMG_PROXY           = 'https://wsrv.nl/?url=';
var AIO_META_PRIMARY    = 'https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta';
var AIO_META_FALLBACK   = 'https://94c8cb9f702d-tmdb-addon.baby-beamup.club/meta';
var MULTI_DECRYPT_API   = 'https://enc-dec.app/api';
var WYZIE_SUBS_API      = 'https://sub.wyzie.io';
var PLAYER_UA           = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36';

// Speed envelope
var META_TIMEOUT     = 1500;   // ms — Cinemeta + TMDB find + TMDB detail (all wrapped together)
var PROVIDER_TIMEOUT = 1000;   // ms — per-provider default
var SHOWBOX_TIMEOUT  = 2200;   // ms — Showbox is slower but user asked for it
var ADDON_TIMEOUT    = 1800;   // ms — per-addon
var GLOBAL_TIMEOUT   = 3000;   // ms — total budget

var API = {
  vidlink:      'https://vidlink.pro',
  vidfast:      'https://vidfast.vc',
  vidcore:      'https://vidcore.io',
  vidup:        'https://vidup.to',
  vidrock:      'https://vidrock.ru',
  videasy:      'https://api.speedracelight.com',
  vaplayer:     'https://streamdata.vaplayer.ru',
  fshare:       'https://fsharetv.cc',
  meowtv:       'https://api.meowtv.ru',
  meowtvBase:   'https://meowtv.ru',
  peachify:     'https://x.eat-peach.sbs',
  peachifyBase: 'https://peachify.top',
  cinejoy:      'https://api.shegu.st',
  cinejoyBase:  'https://cinejoy.to',
  showbox:      'https://showbox.media',
  febbox:       'https://www.febbox.com'
};

// =============================================================================
//  INFO / SETTINGS
// =============================================================================
function getInfo() {
  return {
    name: 'CineStream2',
    lang: 'en',
    baseUrl: 'https://www.themoviedb.org',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=strem.io',
    type: 'movie',
    version: '1.0.3'
  };
}

function getSettings() {
  return [
    { key: 'tmdbApiKey', label: 'TMDB API Key (optional)',
      description: 'Personal TMDB v3 key. Leave blank to use the app default.',
      type: 'text', default: '' },
    { key: 'addonUrls', label: 'Stremio Add-on URLs',
      description: 'Comma / newline separated manifest URLs. Streams come from these add-ons.',
      type: 'text', default: '' },
    { key: 'wyzieSubsKey', label: 'Wyzie Subs API Key',
      description: 'Optional. Enables the Wyzie subtitle provider.',
      type: 'text', default: '' },
    { key: 'showboxToken', label: 'Showbox (Febbox) UI Token',
      description: 'Febbox UI token. Required to enable Showbox.',
      type: 'text', default: '' },
    { key: 'allowDownloadLinks', label: 'Show download-only links',
      description: 'Include sources labelled "Download" and video.googleusercontent links.',
      type: 'enum', default: 'false',
      options: [
        { value: 'false', label: 'Off (recommended)' },
        { value: 'true',  label: 'On' }
      ] },
    { key: 'maxStreamsPerAddon', label: 'Max streams per add-on',
      description: 'Cap the number of streams returned from each configured add-on.',
      type: 'enum', default: '25',
      options: [
        { value: '10',  label: '10' },
        { value: '25',  label: '25' },
        { value: '50',  label: '50' },
        { value: '100', label: '100' }
      ] }
  ];
}

// =============================================================================
//  SETTING ACCESSORS
// =============================================================================
function _readSetting(key) {
  try {
    var s = typeof __settings !== 'undefined' && __settings ? __settings[SOURCE_ID] : null;
    return s && s[key] != null ? s[key] : null;
  } catch (e) { return null; }
}
function _trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
function _bool(key, def) {
  var v = _readSetting(key);
  if (v == null || v === '') return def;
  return String(v).toLowerCase() === 'true';
}
function _num(key, def) {
  var n = parseInt(_readSetting(key), 10);
  return isFinite(n) && n > 0 ? n : def;
}
function _combinedSettings() {
  return {
    tmdbKey:       _trim(_readSetting('tmdbApiKey')),
    addons:        _parseAddonUrls(_readSetting('addonUrls')),
    wyzieKey:      _trim(_readSetting('wyzieSubsKey')),
    showboxToken:  _trim(_readSetting('showboxToken')),
    allowDownload: _bool('allowDownloadLinks', false),
    maxPerAddon:   Math.min(_num('maxStreamsPerAddon', 25), 100)
  };
}

// =============================================================================
//  TIMEOUT
// =============================================================================
function withTimeout(promise, ms, fallback) {
  var fb = fallback === undefined ? [] : fallback;
  return Promise.race([
    Promise.resolve(promise),
    new Promise(function (resolve) { setTimeout(function () { resolve(fb); }, ms); })
  ]);
}

// =============================================================================
//  BYTES / CRYPTO
// =============================================================================
function _strToBytes(s) { return new TextEncoder().encode(String(s)); }
function _bytesToStr(b) { return new TextDecoder().decode(b); }
function _b64ToBytes(s) { return bytesFromBase64(String(s)); }
function _bytesToB64(b) { return bytesToBase64(new Uint8Array(b)); }
function _hexToBytes(hex) {
  hex = String(hex);
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function _bytesToHex(b) {
  return Array.from(new Uint8Array(b)).map(function (x) {
    return x.toString(16).padStart(2, '0');
  }).join('');
}
function _b64urlToBytes(s) {
  var v = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (v.length % 4) v += '=';
  return _b64ToBytes(v);
}
function _bytesToB64url(b) {
  return _bytesToB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
async function _importAesCbc(rawKey) {
  return await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['decrypt', 'encrypt']);
}
async function _importAesGcm(rawKey) {
  return await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt', 'encrypt']);
}
async function _aesCbcDecrypt(rawKey, iv, ct) {
  var k = await _importAesCbc(rawKey);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, k, ct));
}
async function _aesGcmDecrypt(rawKey, nonce, ct, tagBits) {
  var k = await _importAesGcm(rawKey);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: tagBits || 128 }, k, ct));
}
async function peachifyDecrypt(encrypt) {
  try {
    var parts = String(encrypt).split('.');
    if (parts.length < 3) return null;
    var iv = _b64urlToBytes(parts[0]);
    var p1 = _b64urlToBytes(parts[1]);
    var p2 = _b64urlToBytes(parts[2]);
    var ct = new Uint8Array(p1.length + p2.length);
    ct.set(p1); ct.set(p2, p1.length);
    var keyHex = 'a8f2a1b5e9c470814f6b2c3a5d8e7f9c1a2b3c4d5e3f7a8b8cad1e2d0a4d5c5d';
    return _bytesToStr(await _aesGcmDecrypt(_hexToBytes(keyHex), iv, ct, 128));
  } catch (e) { return null; }
}
async function decryptVidrockUrl(payload) {
  try {
    var keyHex = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f';
    var ct = _b64urlToBytes(payload);
    return _bytesToStr(await _aesGcmDecrypt(_hexToBytes(keyHex), ct.slice(0, 12), ct.slice(12), 128));
  } catch (e) { return null; }
}
function _md5(str) {
  function F(x, y, z) { return (x & y) | (~x & z); }
  function G(x, y, z) { return (x & z) | (y & ~z); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | ~z); }
  function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }
  function add(a, b) { return (a + b) >>> 0; }
  var S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
           5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
           4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
           6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  var K = [];
  for (var i = 0; i < 64; i++) K[i] = (Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  var bytes = _strToBytes(str);
  var bitLen = bytes.length * 8;
  var padded = new Uint8Array(((bytes.length + 8) >>> 6) * 64 + 64);
  padded.set(bytes); padded[bytes.length] = 0x80;
  var dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);
  var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (var off = 0; off < padded.length; off += 64) {
    var M = [];
    for (var j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
    var A = a0, B = b0, C = c0, D = d0;
    for (var k = 0; k < 64; k++) {
      var Fn, g;
      if (k < 16) { Fn = F(B, C, D); g = k; }
      else if (k < 32) { Fn = G(B, C, D); g = (5 * k + 1) % 16; }
      else if (k < 48) { Fn = H(B, C, D); g = (3 * k + 5) % 16; }
      else { Fn = I(B, C, D); g = (7 * k) % 16; }
      var tmp = D; D = C; C = B;
      B = add(B, rotl(add(add(A, Fn), add(K[k], M[g])), S[k]));
      A = tmp;
    }
    a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
  }
  var out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0, true); out.setUint32(4, b0, true);
  out.setUint32(8, c0, true); out.setUint32(12, d0, true);
  return _bytesToHex(out.buffer);
}

// =============================================================================
//  NETWORK
// =============================================================================
function _fetch(url, opts) {
  opts = opts || {};
  return fetch(url, {
    method: opts.method || 'GET',
    headers: opts.headers || { Accept: 'application/json' },
    body: opts.body,
    timeoutMs: opts.timeoutMs || 8000
  }).then(function (r) {
    var ok = r && (r.ok == null ? (r.status >= 200 && r.status < 400) : r.ok);
    if (!ok) throw new Error('HTTP ' + (r && r.status));
    var body = r.body != null ? r.body : '';
    if (typeof body !== 'string') return body;
    if (!body) return null;
    try { return JSON.parse(body); } catch (e) { return body; }
  });
}
function _fetchText(url, opts) {
  opts = opts || {};
  return fetch(url, {
    method: opts.method || 'GET',
    headers: opts.headers || {},
    body: opts.body,
    timeoutMs: opts.timeoutMs || 8000
  }).then(function (r) { return r && r.body != null ? r.body : ''; });
}
function _getJson(url, headers, timeoutMs) {
  return _fetch(url, { headers: headers || { Accept: 'application/json' }, timeoutMs: timeoutMs || 8000 });
}
function _getText(url, headers, timeoutMs) {
  return _fetchText(url, { headers: headers || {}, timeoutMs: timeoutMs || 8000 });
}

// =============================================================================
//  TMDB / CINEMETA
// =============================================================================
function _tmdbPath(path) {
  var cfg = _combinedSettings();
  if (!cfg.tmdbKey) return TMDB_API + path;
  var base = 'https://api.themoviedb.org./3';
  return base + path + (path.indexOf('?') >= 0 ? '&' : '?') +
         'api_key=' + encodeURIComponent(cfg.tmdbKey);
}
function _tmdbJson(path) {
  var cfg = _combinedSettings();
  var headers = { Accept: 'application/json' };
  if (cfg.tmdbKey) headers.Host = 'api.themoviedb.org';
  return _fetch(_tmdbPath(path), { headers: headers, timeoutMs: 6000 })
    .catch(function (e) { console.warn('TMDB fail', path, e); return null; });
}
function _tmdbImage(path, size) {
  if (!path) return null;
  return TMDB_IMG + '/' + (size || 'w500') + path;
}
function _tmdbFind(imdbId) {
  return _tmdbJson('/find/' + imdbId + '?external_source=imdb_id')
    .then(function (json) {
      if (!json) return null;
      if (json.movie_results && json.movie_results.length) return json.movie_results[0].id;
      if (json.tv_results && json.tv_results.length) return json.tv_results[0].id;
      return null;
    })
    .catch(function () { return null; });
}
function _cinemetaMeta(type, imdbId) {
  return _fetch(CINEMETA + '/meta/' + type + '/' + imdbId + '.json', { timeoutMs: 5000 })
    .then(function (j) { return j && j.meta ? j.meta : null; })
    .catch(function () { return null; });
}
function _kitsuMeta(kitsuId) {
  var id = String(kitsuId).replace(':', '%3A');
  return _fetch(KITSU + '/meta/series/' + id + '.json', { timeoutMs: 5000 })
    .then(function (j) { return j && j.meta ? j.meta : null; })
    .catch(function () { return null; });
}
function _externalIds(source, id) {
  return _fetch(HAGLUND + '/ids?source=' + source + '&id=' + encodeURIComponent(id), { timeoutMs: 4000 })
    .then(function (j) { return j || {}; })
    .catch(function () { return {}; });
}
function _enrichFromAioMetadata(type, imdbId) {
  if (!imdbId) return Promise.resolve(null);
  return _fetch(AIO_META_PRIMARY + '/' + type + '/' + imdbId + '.json', { timeoutMs: 5000 })
    .catch(function () {
      return _fetch(AIO_META_FALLBACK + '/' + type + '/' + imdbId + '.json', { timeoutMs: 5000 })
        .catch(function () { return null; });
    })
    .then(function (j) { return j && j.meta ? j.meta : null; });
}

// =============================================================================
//  ★ NEW — META RESOLVER (the fix for "only VaPlayer works")
// =============================================================================
async function _resolveMeta(imdbId, tmdbId, type) {
  // type is 'movie' or 'tv' (the TMDB identifier)
  var result = { title: null, year: null, tmdbId: tmdbId || null };

  var cmetaJob = imdbId ? _cinemetaMeta(type === 'tv' ? 'series' : 'movie', imdbId) : Promise.resolve(null);
  var findJob  = (imdbId && !tmdbId) ? _tmdbFind(imdbId) : Promise.resolve(tmdbId || null);

  var r = await Promise.all([cmetaJob, findJob]);
  var cmeta = r[0];
  var found = r[1];

  if (cmeta) {
    result.title = cmeta.name || (cmeta.aliases && cmeta.aliases[0]) || null;
    result.year = _year(cmeta);
    if (!result.tmdbId && cmeta.moviedb_id) result.tmdbId = cmeta.moviedb_id;
  }
  if (!result.tmdbId && found) result.tmdbId = found;

  // Last resort: TMDB detail for title
  if (!result.title && result.tmdbId) {
    try {
      var info = await _tmdbJson('/' + type + '/' + result.tmdbId);
      if (info) {
        result.title = info.title || info.name || null;
        if (!result.year) result.year = (info.release_date || info.first_air_date || '').slice(0, 4) || null;
      }
    } catch (e) {}
  }

  console.log('CineStream2 meta:', JSON.stringify(result));
  return result;
}

// =============================================================================
//  UTILS
// =============================================================================
function _year(rec) {
  return String(rec.release_date || rec.first_air_date || rec.releaseInfo || rec.year || '').slice(0, 4) || null;
}
function _pad(n) { n = parseInt(n, 10) || 0; return n < 10 ? '0' + n : String(n); }
function _tmdbUrl(type, id) {
  return 'tmdb://' + (type === 'tv' || type === 'series' ? 'tv' : 'movie') + '/' + String(id);
}

// =============================================================================
//  CATALOG ITEMS
// =============================================================================
function _itemFromCinemeta(m) {
  if (!m || !m.id) return null;
  var isTv = m.type === 'series';
  var url = _tmdbUrl(isTv ? 'tv' : 'movie', m.id);
  var title = (m.aliases && m.aliases.length && m.aliases[0]) || m.name || '';
  if (!title) return null;
  var item = {
    id: url, url: url,
    title: _year(m) ? title + ' (' + _year(m) + ')' : title,
    cover: m.poster || null,
    banner: m.background || null,
    type: 'movie', sourceId: SOURCE_ID,
    imdbId: m.id, tmdbIsTv: isTv
  };
  if (m.moviedb_id) item.tmdbId = m.moviedb_id;
  if (m.imdbRating != null && isFinite(Number(m.imdbRating))) {
    item.score = Math.round(Number(m.imdbRating) * 10);
  }
  return item;
}
function _itemFromTmdb(rec, forcedType) {
  if (!rec || rec.id == null) return null;
  if (rec.media_type === 'person') return null;
  var isTv = forcedType === 'tv' || rec.media_type === 'tv' || rec.first_air_date != null;
  if (rec.media_type && rec.media_type !== 'movie' && rec.media_type !== 'tv') return null;
  var title = _trim(rec.title || rec.name || '');
  if (!title) return null;
  var url = _tmdbUrl(isTv ? 'tv' : 'movie', rec.id);
  return {
    id: url, url: url,
    title: _year(rec) ? title + ' (' + _year(rec) + ')' : title,
    cover: rec.poster_path ? _tmdbImage(rec.poster_path) : null,
    banner: rec.backdrop_path ? _tmdbImage(rec.backdrop_path, 'w780') : null,
    type: 'movie', sourceId: SOURCE_ID,
    tmdbId: rec.id, tmdbIsTv: isTv,
    score: rec.vote_average != null ? Math.round(Number(rec.vote_average) * 10) : undefined
  };
}

// =============================================================================
//  CATALOG
// =============================================================================
function getHome(opts) {
  return Promise.all([
    _fetch(CINEMETA + '/catalog/movie/top.json', { timeoutMs: 6000 }).catch(function () { return null; }),
    _fetch(CINEMETA + '/catalog/series/top.json', { timeoutMs: 6000 }).catch(function () { return null; }),
    _fetch(KITSU + '/catalog/anime/kitsu-anime-trending.json', { timeoutMs: 6000 }).catch(function () { return null; }),
    _tmdbJson('/trending/all/week')
  ]).then(function (rows) {
    var lists = [];
    function addRow(title, list) { if (list && list.length) lists.push({ title: title, items: list }); }
    addRow('Top Movies',       (rows[0] && rows[0].metas || []).map(_itemFromCinemeta).filter(Boolean));
    addRow('Top Series',       (rows[1] && rows[1].metas || []).map(_itemFromCinemeta).filter(Boolean));
    addRow('Trending Anime',   (rows[2] && rows[2].metas || []).map(_itemFromCinemeta).filter(Boolean));
    addRow('Trending on TMDB', (rows[3] && rows[3].results || []).map(function (r) {
      return _itemFromTmdb(r, null);
    }).filter(Boolean));
    return lists;
  });
}
function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = [];
    rows.forEach(function (r) { r.items.forEach(function (i) { out.push(i); }); });
    return out;
  });
}
function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  return Promise.all([
    _fetch(CINEMETA + '/catalog/movie/top/search=' + encodeURIComponent(q) + '.json', { timeoutMs: 6000 }).catch(function () { return null; }),
    _fetch(CINEMETA + '/catalog/series/top/search=' + encodeURIComponent(q) + '.json', { timeoutMs: 6000 }).catch(function () { return null; }),
    _tmdbJson('/search/multi?query=' + encodeURIComponent(q) + '&page=' + p)
  ]).then(function (rows) {
    var seen = {}, out = [];
    function push(item) {
      if (!item) return;
      var k = (item.imdbId || '') + '|' + (item.tmdbId || '') + '|' + item.title;
      if (seen[k]) return;
      seen[k] = true;
      out.push(item);
    }
    (rows[0] && rows[0].metas || []).forEach(function (m) { push(_itemFromCinemeta(m)); });
    (rows[1] && rows[1].metas || []).forEach(function (m) { push(_itemFromCinemeta(m)); });
    (rows[2] && rows[2].results || []).forEach(function (m) { push(_itemFromTmdb(m, null)); });
    return out;
  });
}

// =============================================================================
//  DETAIL / EPISODES
// =============================================================================
function _parseDetailUrl(value) {
  var s = String(value || '');
  if (!s) return null;
  var m = s.match(/^tmdb:\/\/(movie|tv|series)\/([^\/?#]+)/i);
  if (m) {
    var kind = m[1].toLowerCase() === 'movie' ? 'movie' : 'tv';
    var id = decodeURIComponent(m[2]);
    if (/^tt\d+$/.test(id)) return { kind: kind === 'movie' ? 'movie' : 'series', id: id, source: 'cinemeta' };
    if (/^\d+$/.test(id)) return { kind: 'tmdb', type: kind, id: id };
  }
  m = s.match(/^cinestream:\/\/(movie|series|kitsu)\/(.+)$/i);
  if (m) return { kind: m[1].toLowerCase(), id: decodeURIComponent(m[2]) };
  m = s.match(/^cinestream:\/\/tmdb\/(movie|tv)\/(\d+)/i);
  if (m) return { kind: 'tmdb', type: m[1].toLowerCase(), id: m[2] };
  m = s.match(/^(tt\d+)/);
  if (m) return { kind: 'movie', id: m[1] };
  return null;
}
function _episodeUrl(type, imdbId, tmdbId, season, episode) {
  var kind = type === 'tv' || type === 'series' ? 'series' : 'movie';
  var payload = {
    id:     imdbId || (tmdbId ? 'tmdb:' + tmdbId : ''),
    videoId: imdbId || (tmdbId ? 'tmdb:' + tmdbId : ''),
    imdbId: imdbId || undefined,
    tmdbId: tmdbId || undefined,
    type:   kind,
    season: season || 0,
    episode: episode || 0
  };
  if (tmdbId) payload.tmdbIsTv = kind === 'series';
  return JSON.stringify(payload);
}
function _statusFromCinemeta(s) {
  var v = String(s || '').toLowerCase();
  if (/returning|production|planned/.test(v)) return 'ongoing';
  if (/ended|released/.test(v))               return 'completed';
  if (/cancel/.test(v))                       return 'cancelled';
  return 'unknown';
}
function getDetail(url, opts) {
  var parsed = _parseDetailUrl(url);
  if (!parsed) return Promise.resolve(null);

  if (parsed.kind === 'movie' || parsed.kind === 'series') {
    var cmType = parsed.kind === 'series' ? 'series' : 'movie';
    return Promise.all([
      _cinemetaMeta(cmType, parsed.id),
      _enrichFromAioMetadata(cmType, parsed.id)
    ]).then(function (rs) {
      if (!rs[0]) return null;
      return _buildFromCinemeta(rs[0], parsed, rs[1], url);
    });
  }
  if (parsed.kind === 'tmdb') {
    return _tmdbJson('/' + parsed.type + '/' + parsed.id +
                     '?append_to_response=external_ids,credits,videos,alternative_titles')
      .then(function (info) {
        if (!info || info.id == null) return null;
        return _buildFromTmdb(info, parsed, url);
      });
  }
  if (parsed.kind === 'kitsu') {
    return _externalIds('kitsu', parsed.id).then(function (ids) {
      if (ids && ids.imdb) return getDetail(_tmdbUrl('tv', ids.imdb), opts);
      return _kitsuMeta(parsed.id).then(function (meta) {
        if (!meta) return null;
        return _buildFromKitsu(meta, parsed, url);
      });
    });
  }
  return Promise.resolve(null);
}
function _buildFromCinemeta(meta, parsed, extras, sourceUrl) {
  var isTv = parsed.kind === 'series';
  var title = (meta.aliases && meta.aliases[0]) || meta.name || 'Untitled';
  var year = _year(meta);
  var genres = meta.genre || meta.genres || [];
  var imdbId = meta.imdb_id || parsed.id;
  var tmdbId = meta.moviedb_id || null;
  var episodes = isTv
    ? (meta.videos || []).filter(function (v) { return v.season !== 0; })
        .sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); })
        .map(function (v) {
          return {
            id: String(v.season) + 'x' + String(v.episode),
            title: 'S' + _pad(v.season) + ' E' + _pad(v.episode) + ' - ' + (v.name || v.title || ''),
            number: v.episode, season: v.season,
            url: _episodeUrl('series', imdbId, tmdbId, v.season, v.episode),
            date: v.firstAired || v.released || null, thumbnail: v.thumbnail || null
          };
        })
    : [{ id: 'movie', title: title, number: 1, url: _episodeUrl('movie', imdbId, tmdbId, 0, 0) }];

  var result = {
    id: sourceUrl, url: sourceUrl,
    title: title,
    cover: meta.poster || null,
    banner: meta.background || (extras && extras.background) || null,
    description: (meta.awards ? '[' + meta.awards + '] ' : '') + (meta.description || ''),
    status: _statusFromCinemeta(meta.status),
    genres: genres, studios: [], type: 'movie', sourceId: SOURCE_ID,
    year: year, imdbId: imdbId, tmdbId: tmdbId, tmdbIsTv: isTv,
    logo: meta.logo || (extras && extras.logo) || null,
    episodes: episodes, subCount: episodes.length, dubCount: 0
  };
  if (meta.imdbRating) result.score = Math.round(Number(meta.imdbRating) * 10);
  if (extras && extras.app_extras && extras.app_extras.cast) {
    result.actors = extras.app_extras.cast.map(function (c) {
      return { name: c.name, role: c.character, image: c.photo ? IMG_PROXY + c.photo : null };
    }).filter(function (a) { return a.name; });
  }
  return result;
}
function _buildFromTmdb(info, parsed, sourceUrl) {
  var isTv = parsed.type === 'tv';
  var title = info.title || info.name || 'Untitled';
  var imdbId = (info.external_ids && info.external_ids.imdb_id) || null;
  var genres = (info.genres || []).map(function (g) { return g.name; });
  var episodes = [];

  function finalize() {
    var result = {
      id: sourceUrl, url: sourceUrl,
      title: title,
      cover: info.poster_path ? TMDB_IMG + '/w500' + info.poster_path : null,
      banner: info.backdrop_path ? TMDB_IMG + '/w780' + info.backdrop_path : null,
      description: info.overview || '',
      status: _statusFromCinemeta(info.status),
      genres: genres, studios: [], type: 'movie', sourceId: SOURCE_ID,
      year: (info.release_date || info.first_air_date || '').slice(0, 4) || null,
      imdbId: imdbId, tmdbId: info.id, tmdbIsTv: isTv,
      episodes: episodes, subCount: episodes.length, dubCount: 0
    };
    if (info.vote_average) result.score = Math.round(Number(info.vote_average) * 10);
    return result;
  }

  if (!isTv) {
    episodes = [{ id: 'movie', title: title, number: 1, url: _episodeUrl('movie', imdbId, parsed.id, 0, 0) }];
    return Promise.resolve(finalize());
  }
  var maxSeasons = Math.min(info.number_of_seasons || 1, 40);
  var jobs = [];
  for (var s = 1; s <= maxSeasons; s++) {
    (function (seasonNo) {
      jobs.push(_tmdbJson('/tv/' + parsed.id + '/season/' + seasonNo));
    })(s);
  }
  return Promise.all(jobs).then(function (seasonData) {
    seasonData.sort(function (a, b) { return (a && a.season_number || 0) - (b && b.season_number || 0); });
    seasonData.forEach(function (sd) {
      if (!sd || !sd.episodes) return;
      sd.episodes.forEach(function (ep) {
        if (ep.episode_number == null) return;
        episodes.push({
          id: String(sd.season_number) + 'x' + String(ep.episode_number),
          title: 'S' + _pad(sd.season_number) + ' E' + _pad(ep.episode_number) + ' - ' + (ep.name || ''),
          number: ep.episode_number, season: sd.season_number,
          url: _episodeUrl('series', imdbId, parsed.id, sd.season_number, ep.episode_number),
          date: ep.air_date || null,
          thumbnail: ep.still_path ? TMDB_IMG + '/w300' + ep.still_path : null
        });
      });
    });
    return finalize();
  });
}
function _buildFromKitsu(meta, parsed, sourceUrl) {
  var episodes = (meta.videos || []).map(function (v) {
    return {
      id: String(v.season) + 'x' + String(v.episode),
      title: 'S' + _pad(v.season) + ' E' + _pad(v.episode) + ' - ' + (v.title || ''),
      number: v.episode, season: v.season,
      url: _episodeUrl('series', null, meta.moviedb_id, v.season, v.episode),
      date: v.firstAired || null, thumbnail: v.thumbnail || null
    };
  });
  return {
    id: sourceUrl, url: sourceUrl,
    title: (meta.aliases && meta.aliases[0]) || meta.name || 'Untitled',
    cover: meta.poster || null,
    banner: meta.background || null,
    description: meta.description || '',
    status: _statusFromCinemeta(meta.status),
    genres: meta.genres || meta.genre || [], studios: [], type: 'movie', sourceId: SOURCE_ID,
    year: _year(meta),
    imdbId: null, tmdbId: meta.moviedb_id || null, tmdbIsTv: true,
    episodes: episodes, subCount: episodes.length, dubCount: 0
  };
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) {
    return d && Array.isArray(d.episodes) ? d.episodes : [];
  });
}

// =============================================================================
//  STREMIO ADD-ONS
// =============================================================================
function _parseAddonUrls(raw) {
  var src = String(raw || '');
  var parts = src.split(/[,;\r\n]+/);
  var out = [], seen = {};
  for (var i = 0; i < parts.length; i++) {
    var v = _trim(parts[i]);
    if (!v) continue;
    v = v.replace(/^stremio:\/\//i, 'https://').replace(/#.*$/, '');
    if (!/^https?:\/\//i.test(v)) continue;
    var q = '', qi = v.indexOf('?');
    if (qi >= 0) { q = v.substring(qi + 1); v = v.substring(0, qi); }
    v = v.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
    var n = v + (q ? '::q::' + q : '');
    if (!seen[n]) { seen[n] = true; out.push(n); }
  }
  return out;
}
function _addonParts(base) {
  var v = String(base || '');
  var marker = v.indexOf('::q::');
  if (marker < 0) return { root: v, query: '' };
  return { root: v.substring(0, marker), query: v.substring(marker + 5) };
}
function _manifestUrl(base) {
  var p = _addonParts(base);
  return p.root + '/manifest.json' + (p.query ? '?' + p.query : '');
}
function _streamEndpoint(base, type, id) {
  var p = _addonParts(base);
  return p.root + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) +
    '.json' + (p.query ? '?' + p.query : '');
}
function _subtitleEndpoint(base, type, id) {
  var p = _addonParts(base);
  return p.root + '/subtitles/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) +
    '.json' + (p.query ? '?' + p.query : '');
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
  if (imdb) {
    if (type === 'series' && season > 0 && episode > 0) add(imdb + ':' + season + ':' + episode);
    add(imdb);
  }
  if (tmdb) {
    add(String(tmdb));
    add('tmdb:' + (type === 'series' ? 'series' : 'movie') + ':' + String(tmdb));
    if (type === 'series' && season > 0 && episode > 0) {
      add('tmdb:series:' + String(tmdb) + ':' + season + ':' + episode);
    }
  }
  return { ids: ids, type: type, season: season, episode: episode };
}
function _toZangetsuStream(raw, sourceName, allowDownload) {
  if (!raw || typeof raw !== 'object') return null;
  var url = typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url) ? raw.url : '';
  if (!url) return null;
  var isDownload = /video-downloads\.googleusercontent/i.test(url) ||
                   /Instant Download/i.test(raw.name || '');
  if (isDownload && !allowDownload) return null;
  var text = String(raw.name || '') + ' ' + String(raw.title || '') + ' ' + String(raw.description || '');
  var qMatch = text.match(/(2160p|4k|1440p|1080p|720p|480p|360p)/i);
  var quality = qMatch ? (qMatch[1].toLowerCase() === '4k' ? '2160p' : qMatch[1].toLowerCase()) : 'Auto';
  var container = /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls'
                : /\.(mp4|m4v|mov|webm)(?:[?#]|$)/i.test(url) ? 'mp4' : 'unknown';
  var headers = {};
  var hints = raw.behaviorHints || {};
  var proxyReq = (hints.proxyHeaders && hints.proxyHeaders.request) || {};
  if (proxyReq.Referer) headers.Referer = proxyReq.Referer;
  if (proxyReq.Origin) headers.Origin = proxyReq.Origin;
  if (proxyReq['User-Agent']) headers['User-Agent'] = proxyReq['User-Agent'];
  if (!headers['User-Agent'] && hints.headers) {
    ['User-Agent', 'Referer', 'Origin'].forEach(function (k) {
      if (hints.headers[k] && !headers[k]) headers[k] = hints.headers[k];
    });
  }
  var labelParts = [sourceName];
  if (raw.name) labelParts.push(raw.name);
  if (raw.title) labelParts.push(raw.title);
  if (raw.description) labelParts.push(raw.description);
  return {
    url: url, quality: quality,
    label: labelParts.join(' · ').slice(0, 300),
    container: container, headers: headers, kind: 'raw'
  };
}
function _magnetFromStream(stream) {
  var ih = stream.infoHash;
  if (!ih) return null;
  var trackers = (stream.sources || [])
    .filter(function (s) { return /^tracker:/i.test(s); })
    .map(function (s) { return s.substring(8).trim(); })
    .filter(Boolean);
  var url = 'magnet:?xt=urn:btih:' + ih + '&dn=' + encodeURIComponent(ih);
  trackers.forEach(function (t) { url += '&tr=' + encodeURIComponent(t); });
  if (stream.fileIdx != null) url += '&index=' + stream.fileIdx;
  return url;
}
function _queryAddon(base, parsed, subtitleCb) {
  var cfg = _combinedSettings();
  return _fetch(_manifestUrl(base), { timeoutMs: 6000 }).then(function (manifest) {
    if (!manifest) return [];
    var resources = manifest.resources;
    var supportsStream = !Array.isArray(resources) ||
      resources.some(function (r) { return r === 'stream' || (r && r.name === 'stream'); });
    var jobs = [];
    if (supportsStream) {
      parsed.ids.forEach(function (id) {
        jobs.push(_fetch(_streamEndpoint(base, parsed.type, id), { timeoutMs: 6000 }).then(function (data) {
          var streams = data && Array.isArray(data.streams) ? data.streams : [];
          var out = [];
          streams.forEach(function (s) {
            if (s && s.infoHash && !s.url) {
              var mag = _magnetFromStream(s);
              if (mag) out.push({
                url: mag, quality: 'Auto',
                label: '[magnet] ' + (s.title || s.name || '').slice(0, 200),
                container: 'magnet', headers: {}, kind: 'magnet'
              });
            } else {
              var z = _toZangetsuStream(s, manifest.name || 'Addon', cfg.allowDownload);
              if (z) out.push(z);
            }
          });
          return out;
        }).catch(function () { return []; }));
      });
    }
    if (subtitleCb && parsed.ids.length) {
      var supportsSubs = !Array.isArray(resources) ||
        resources.some(function (r) { return r === 'subtitles' || (r && r.name === 'subtitles'); });
      if (supportsSubs) {
        jobs.push(_fetch(_subtitleEndpoint(base, parsed.type, parsed.ids[0]), { timeoutMs: 6000 }).then(function (data) {
          var subs = data && Array.isArray(data.subtitles) ? data.subtitles : [];
          subs.forEach(function (s) {
            if (s && s.url) subtitleCb({ url: s.url, lang: s.lang || s.lang_code || 'Unknown' });
          });
          return [];
        }).catch(function () { return []; }));
      }
    }
    return Promise.all(jobs).then(function (lists) {
      var out = [];
      lists.forEach(function (l) { out = out.concat(l); });
      return out.slice(0, cfg.maxPerAddon);
    });
  }).catch(function (e) { console.warn('addon fail', base, String(e)); return []; });
}
function _invokeWyzieSubs(imdbId, season, episode, subtitleCb) {
  var cfg = _combinedSettings();
  if (!cfg.wyzieKey || !imdbId) return Promise.resolve();
  var url = WYZIE_SUBS_API + '/search?id=' + encodeURIComponent(imdbId);
  if (season > 0 && episode > 0) url += '&season=' + season + '&episode=' + episode;
  url += '&source=all&key=' + encodeURIComponent(cfg.wyzieKey);
  return _fetch(url, { timeoutMs: 4000 }).then(function (list) {
    if (!Array.isArray(list)) return;
    list.forEach(function (s) {
      if (s && s.url) subtitleCb({ url: s.url, lang: s.display || s.language || 'Unknown' });
    });
  }).catch(function (e) { console.warn('wyzie fail', e); });
}

// =============================================================================
//  PROVIDERS
// =============================================================================

// VaPlayer — imdbId only, no meta needed
async function _invokeVaPlayer(imdbId, season, episode, subtitleCb) {
  if (!imdbId) return [];
  var referer = 'https://nextgencloudfabric.com/';
  var url = season == null
    ? API.vaplayer + '/api.php?imdb=' + imdbId + '&type=movie'
    : API.vaplayer + '/api.php?imdb=' + imdbId + '&type=tv&season=' + season + '&episode=' + episode;
  try {
    var res = JSON.parse(await _getText(url, { Referer: referer }, 5000));
    var out = [];
    ((res && res.data && res.data.stream_urls) || []).forEach(function (u) {
      if (!u) return;
      out.push({
        url: u, quality: 'Auto', label: '[VaPlayer]',
        container: /\.m3u8/i.test(u) ? 'hls' : 'unknown',
        headers: { Referer: referer }, kind: 'raw'
      });
    });
    if (subtitleCb && res && res.default_subs) {
      res.default_subs.forEach(function (s) {
        if (s && s.url) subtitleCb({ url: s.url, lang: s.lang || s.code || 'Unknown' });
      });
    }
    return out;
  } catch (e) { return []; }
}

// Vidlink
async function _invokeVidlink(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  try {
    var parsed = JSON.parse(await _getText(MULTI_DECRYPT_API + '/enc-vidlink?text=' + tmdbId, {}, 5000));
    var payload = parsed && parsed.result;
    if (!payload) return [];
    var headers = { 'User-Agent': PLAYER_UA, Referer: API.vidlink + '/', Origin: API.vidlink };
    var epUrl = season == null
      ? API.vidlink + '/api/b/movie/' + payload
      : API.vidlink + '/api/b/tv/' + payload + '/' + season + '/' + episode;
    var stream = JSON.parse(await _getText(epUrl, headers, 5000)).stream;
    if (!stream) return [];
    var out = [];
    Object.keys(stream.qualities || {}).forEach(function (k) {
      var q = stream.qualities[k];
      if (!q || !q.url) return;
      out.push({
        url: q.url,
        quality: k === '1080' ? '1080p' : k === '720' ? '720p' : k === '480' ? '480p' : k === '360' ? '360p' : 'Auto',
        label: '[VidLink] ' + k,
        container: q.type === 'm3u8' || /\.m3u8/i.test(q.url) ? 'hls' : 'unknown',
        headers: q.headers || {}, kind: 'raw'
      });
    });
    if (subtitleCb) (stream.captions || []).forEach(function (c) {
      if (c && c.url && c.language) subtitleCb({ url: c.url, lang: c.language });
    });
    return out;
  } catch (e) { return []; }
}

// Vidrock
async function _invokeVidrock(tmdbId, season, episode) {
  if (!tmdbId) return [];
  var type = season == null ? 'movie' : 'tv';
  var query = season == null ? String(tmdbId) : tmdbId + '_' + season + '_' + episode;
  var headers = { Origin: API.vidrock, Referer: API.vidrock + '/', 'User-Agent': PLAYER_UA };
  try {
    var data = JSON.parse(await _getText(API.vidrock + '/api/' + type + '/' + query + '/', headers, 5000));
    var keys = Object.keys(data);
    var decrypted = await Promise.all(keys.map(async function (key) {
      var encUrl = data[key] && data[key].url;
      if (!encUrl || encUrl === 'error' || encUrl === 'null') return null;
      var dec = await decryptVidrockUrl(encUrl);
      if (!dec) return null;
      return {
        url: dec, quality: 'Auto', label: '[Vidrock ' + key + ']',
        container: /m3u8/i.test(dec) ? 'hls' : 'unknown',
        headers: headers, kind: 'raw'
      };
    }));
    return decrypted.filter(Boolean);
  } catch (e) { return []; }
}

// Peachify
async function _invokePeachify(tmdbId, season, episode) {
  if (!tmdbId) return [];
  var headers = {
    Origin: API.peachifyBase, Referer: API.peachifyBase + '/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137.0.0.0'
  };
  var servers = ['multi', 'hr', 'holly', 'air', 'moviebox'];
  var serverResults = await Promise.all(servers.map(async function (server) {
    try {
      var url = season == null
        ? API.peachify + '/' + server + '/movie/' + tmdbId
        : API.peachify + '/' + server + '/tv/' + tmdbId + '/' + season + '/' + episode;
      var encrypt = JSON.parse(await _getText(url, headers, 5000)).data;
      if (!encrypt) return [];
      var decrypted = await peachifyDecrypt(encrypt);
      if (!decrypted) return [];
      var json = JSON.parse(decrypted);
      var provider = json.providerName || 'Peachify';
      var out = [];
      (json.sources || []).forEach(function (src) {
        if (!src.url) return;
        var finalUrl = src.url, realHeaders = src.headers || {};
        if (/\/m3u8-proxy|\/mp4-proxy/.test(src.url)) {
          try {
            var u = new URL(src.url);
            finalUrl = u.searchParams.get('url') || src.url;
            var h = u.searchParams.get('headers');
            if (h) realHeaders = JSON.parse(h);
          } catch (e) {}
        }
        out.push({
          url: finalUrl,
          quality: src.quality ? src.quality + 'p' : 'Auto',
          label: '[Peachify ' + provider + ']' + (src.dub ? ' · ' + src.dub : ''),
          container: src.type === 'hls' ? 'hls' : 'unknown',
          headers: {
            Origin: realHeaders.origin || API.peachifyBase,
            Referer: realHeaders.referer || API.peachifyBase + '/',
            'User-Agent': realHeaders['user-agent'] || headers['User-Agent']
          },
          kind: 'raw'
        });
      });
      return out;
    } catch (e) { return []; }
  }));
  var out = [];
  serverResults.forEach(function (r) { out = out.concat(r); });
  return out;
}

// Meowtv
async function _invokeMeowtv(tmdbId, season, episode) {
  if (!tmdbId) return [];
  var servers = ['ipcloud', 'dcloud', 'tik', 'turkce', 'hindiv3'];
  var type = season != null ? 'tv' : 'movie';
  var headers = { 'User-Agent': PLAYER_UA, Origin: API.meowtvBase, Referer: API.meowtvBase + '/' };
  var serverResults = await Promise.all(servers.map(async function (server) {
    try {
      var url = API.meowtv + '/streams/' + type + '/' + tmdbId;
      if (season != null) url += '/' + season + '/' + episode;
      url += '?s=' + server;
      var json = JSON.parse(await _getText(url, headers, 5000));
      var dec = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-meowtv', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: json }), timeoutMs: 5000
      }));
      var r = dec && dec.result;
      if (!r || !r.url) return [];
      return [{
        url: r.url, quality: '1080p',
        label: '[MeowTV ' + server + '] ' + (r.language || ''),
        container: /\.m3u8/i.test(r.url) ? 'hls' : 'unknown',
        headers: headers, kind: 'raw'
      }];
    } catch (e) { return []; }
  }));
  var out = [];
  serverResults.forEach(function (r) { out = out.concat(r); });
  return out;
}

// VidFastPro
async function _invokeVidFastPro(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  var base = API.vidfast;
  var url = season == null
    ? base + '/movie/' + tmdbId + '/'
    : base + '/tv/' + tmdbId + '/' + season + '/' + episode + '/';
  var headers = { 'User-Agent': PLAYER_UA, Referer: base + '/' };
  try {
    var html = await _getText(url, headers, 5000);
    var m = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    if (!m) return [];
    var parsed = JSON.parse(await _getText(
      MULTI_DECRYPT_API + '/enc-vidfast?text=' + encodeURIComponent(m[1]), {}, 5000));
    var result = parsed && parsed.result;
    if (!result || !result.servers || !result.stream || !result.token) return [];
    var postHeaders = Object.assign({}, headers, { 'X-CSRF-Token': result.token });
    var serversEnc = await _fetchText(result.servers, { method: 'POST', headers: postHeaders, timeoutMs: 5000 });
    var dec = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-vidfast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: serversEnc }), timeoutMs: 5000
    }));
    var servers = (dec && dec.result) || [];
    var serverResults = await Promise.all(servers.map(async function (srv) {
      if (!srv || !srv.data) return [];
      try {
        var streamEnc = await _fetchText(result.stream + '/' + srv.data,
          { method: 'POST', headers: postHeaders, timeoutMs: 5000 });
        var final = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-vidfast', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: streamEnc }), timeoutMs: 5000
        }));
        var r = final && final.result;
        if (!r || !r.url) return [];
        if (subtitleCb && r.tracks) r.tracks.forEach(function (t) {
          if (t.file && t.label) subtitleCb({ url: t.file, lang: t.label });
        });
        var is4k = r.is4kAvailable || /4K/i.test(srv.description || '');
        return [{
          url: r.url, quality: is4k ? '2160p' : '1080p',
          label: '[VidFastPro ' + (srv.name || '') + ']',
          container: /\.m3u8/i.test(r.url) ? 'hls' : 'unknown',
          headers: postHeaders, kind: 'raw'
        }];
      } catch (e) { return []; }
    }));
    var out = [];
    serverResults.forEach(function (r) { out = out.concat(r); });
    return out;
  } catch (e) { return []; }
}

// Vidcore
async function _invokeVidcore(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  var headers = { 'User-Agent': PLAYER_UA, Referer: API.vidcore + '/', 'X-Requested-With': 'XMLHttpRequest' };
  var baseUrl = season == null
    ? API.vidcore + '/movie/' + tmdbId
    : API.vidcore + '/tv/' + tmdbId + '/' + season + '/' + episode;
  try {
    var encM = (await _getText(baseUrl, {}, 5000)).match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    if (!encM) return [];
    var init = JSON.parse(await _getText(
      MULTI_DECRYPT_API + '/enc-vidcore?text=' + encodeURIComponent(encM[1]), {}, 5000)).result;
    if (!init) return [];
    headers['X-CSRF-Token'] = init.token;
    var serversEnc = await _fetchText(init.servers, { method: 'POST', headers: headers, timeoutMs: 5000 });
    var serversList = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-vidcore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: serversEnc }), timeoutMs: 5000
    })).result || [];

    var serverResults = await Promise.all(serversList.map(async function (srv) {
      try {
        var streamEnc = await _fetchText(init.stream + '/' + srv.data,
          { method: 'POST', headers: headers, timeoutMs: 5000 });
        var decStream = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-vidcore', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: streamEnc }), timeoutMs: 5000
        })).result;
        if (!decStream || !decStream.url) return [];
        (decStream.tracks || []).forEach(function (t) {
          if (t.file && t.label && subtitleCb) subtitleCb({ url: t.file, lang: t.label });
        });
        return [{
          url: decStream.url, quality: '1080p',
          label: '[Vidcore ' + srv.name + ']',
          container: /m3u8/i.test(decStream.url) ? 'hls' : 'unknown',
          headers: headers, kind: 'raw'
        }];
      } catch (e) { return []; }
    }));
    var out = [];
    serverResults.forEach(function (r) { out = out.concat(r); });
    return out;
  } catch (e) { return []; }
}

// Vidup
async function _invokeVidup(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  var headers = { 'User-Agent': PLAYER_UA, Referer: API.vidup + '/', 'X-Requested-With': 'XMLHttpRequest' };
  var url = season != null
    ? API.vidup + '/tv/' + tmdbId + '/' + season + '/' + episode
    : API.vidup + '/movie/' + tmdbId;
  try {
    var encM = (await _getText(url, {}, 5000)).match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    if (!encM) return [];
    var parsed = JSON.parse(await _getText(
      MULTI_DECRYPT_API + '/enc-vidup?text=' + encM[1], headers, 5000));
    if (parsed.status !== 200 || !parsed.result) return [];
    var result = parsed.result;
    var postHeaders = Object.assign({}, headers, { 'X-CSRF-Token': result.token });
    var serversEnc = await _fetchText(result.servers, { method: 'POST', headers: postHeaders, timeoutMs: 5000 });
    var servers = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-vidup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: serversEnc }), timeoutMs: 5000
    })).result || [];

    var serverResults = await Promise.all(servers.map(async function (srv) {
      if (!srv.data) return [];
      try {
        var streamEnc = await _fetchText(result.stream + '/' + srv.data,
          { method: 'POST', headers: postHeaders, timeoutMs: 5000 });
        var stream = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-vidup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: streamEnc }), timeoutMs: 5000
        })).result;
        if (!stream || !stream.url) return [];
        (stream.tracks || []).forEach(function (t) {
          if (t.file && t.label && subtitleCb) subtitleCb({ url: t.file, lang: t.label });
        });
        return [{
          url: stream.url, quality: '1080p',
          label: '[Vidup ' + (srv.name || '') + ']',
          container: /m3u8/i.test(stream.url) ? 'hls' : 'unknown',
          headers: { Referer: API.vidup + '/' }, kind: 'raw'
        }];
      } catch (e) { return []; }
    }));
    var out = [];
    serverResults.forEach(function (r) { out = out.concat(r); });
    return out;
  } catch (e) { return []; }
}

// Fshare
async function _invokeFshare(title, imdbId) {
  if (!title) return [];
  var slug = (title + ' episode 1 ' + (imdbId || ''))
    .toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
  var url = API.fshare + '/w/' + slug;
  try {
    var html = await _getText(url, {}, 5000);
    var tokMatch = html.match(/Movie\.setSource\('([^']+)'/);
    if (!tokMatch) return [];
    var trailer = (html.match(/id=["']trailer["'][^>]+value=["']([^"']+)["']/i) || [])[1] || '';
    var res = JSON.parse(await _getText(
      API.fshare + '/api/file/' + tokMatch[1] + '/source?trailer=' +
      encodeURIComponent(trailer) + '&type=watch', {}, 5000));
    var file = res && res.data && res.data.file;
    if (!file) return [];
    var sources = (file.sources || []).concat(
      (file.alternatives || []).reduce(function (a, b) { return a.concat(b); }, []));
    var out = [], seen = {};
    sources.forEach(function (s) {
      if (!s || !s.src || seen[s.id]) return;
      seen[s.id] = true;
      out.push({
        url: API.fshare + s.src,
        quality: s.quality ? s.quality + 'p' : 'Auto',
        label: '[Fshare]', container: 'mp4',
        headers: { Referer: url, 'User-Agent': PLAYER_UA }, kind: 'raw'
      });
    });
    return out;
  } catch (e) { return []; }
}

// Videasy
async function _invokeVideasy(title, tmdbId, imdbId, year, season, episode, subtitleCb) {
  if (!title || !tmdbId) return [];
  var servers = ['myflixerzupcloud','downloader2','m4uhd','hdmovie','cdn',
                 'superflix','lamovie','jett','tejo','neon2','ym'];
  var encTitle = encodeURIComponent(encodeURIComponent(title));
  var headers = { Accept: '*/*', Referer: 'https://player.videasy.to/', Origin: 'https://player.videasy.to' };
  var seed;
  try {
    seed = (await _getJson(API.videasy + '/seed?mediaId=' + tmdbId, headers, 5000)).seed;
  } catch (e) { return []; }
  if (!seed) return [];

  var serverResults = await Promise.all(servers.map(async function (server) {
    try {
      var url = season == null
        ? API.videasy + '/' + server + '/sources-with-title?title=' + encTitle +
          '&mediaType=movie&year=' + (year || '') + '&tmdbId=' + tmdbId +
          '&imdbId=' + (imdbId || '') + '&enc=2&seed=' + encodeURIComponent(seed)
        : API.videasy + '/' + server + '/sources-with-title?title=' + encTitle +
          '&mediaType=tv&year=' + (year || '') + '&tmdbId=' + tmdbId +
          '&episodeId=' + episode + '&seasonId=' + season +
          '&imdbId=' + (imdbId || '') + '&enc=2&seed=' + encodeURIComponent(seed);
      var encText = await _getText(url, headers, 5000);
      var result = (await _fetch(MULTI_DECRYPT_API + '/dec-videasy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: encText, id: tmdbId, seed: seed }), timeoutMs: 5000
      })).result;
      if (!result) return [];
      var out = [];
      (result.sources || []).forEach(function (s) {
        if (!s || !s.url) return;
        out.push({
          url: s.url, quality: s.quality || 'Auto',
          label: '[Videasy ' + server + '] ' + (s.quality || ''),
          container: /\.m3u8/i.test(s.url) ? 'hls' : /\.(mp4|mkv)/i.test(s.url) ? 'mp4' : 'unknown',
          headers: headers, kind: 'raw'
        });
      });
      if (subtitleCb) (result.subtitles || []).forEach(function (sub) {
        if (sub && sub.url) subtitleCb({ url: sub.url, lang: sub.language || 'Unknown' });
      });
      return out;
    } catch (e) { return []; }
  }));
  var out = [];
  serverResults.forEach(function (r) { out = out.concat(r); });
  return out;
}

// Cinejoy — fixed double-fetch bug
async function _invokeCinejoy(title, imdbId, tmdbId, year, season, episode, subtitleCb) {
  if (!title) return [];
  var isSeries = season != null && episode != null;
  var type = isSeries ? 'series' : 'movie';
  var headers = { Accept: '*/*', Origin: API.cinejoyBase, Referer: API.cinejoyBase + '/', 'User-Agent': PLAYER_UA };
  try {
    var servers = ((JSON.parse(await _getText(API.cinejoy + '/servers', headers, 5000)).servers) || [])
      .map(function (s) { return s && s.name; }).filter(Boolean);
    var encodedTitle = encodeURIComponent(title);

    var serverResults = await Promise.all(servers.map(async function (server) {
      try {
        var targetUrl = API.cinejoy + '/?title=' + encodedTitle + '&type=' + type +
          '&year=' + (year || '') + '&imdb=' + (imdbId || '') + '&tmdb=' + (tmdbId || '') +
          '&server=' + server + (isSeries ? '&season=' + season + '&episode=' + episode : '');
        var encRes = JSON.parse(await _getText(
          MULTI_DECRYPT_API + '/enc-cinejoy?url=' + encodeURIComponent(targetUrl), {}, 5000));
        if (!encRes || encRes.status !== 200 || !encRes.result || !encRes.result.data) return [];
        var decoded = _b64urlToBytes(encRes.result.data);
        if (!decoded) return [];
        var resp = await fetch(API.cinejoy + '/g', {
          method: 'POST', headers: headers, body: decoded, timeoutMs: 5000
        });
        var buf = await Promise.resolve(resp && resp.arrayBuffer ? resp.arrayBuffer() : null);
        if (!buf) return [];
        var b64 = _bytesToB64url(new Uint8Array(buf));

        // FIXED: single fetch, not double
        var decText = await _fetchText(MULTI_DECRYPT_API + '/dec-cinejoy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: b64, state: encRes.result.state }), timeoutMs: 5000
        });
        var decResult = JSON.parse(decText).result;
        if (!decResult) return [];
        var data = decResult.data;
        if (!data || data.error) return [];

        var out = [];
        (data.stream || []).forEach(function (st) {
          if (st.type === 'hls' && st.playlist) {
            out.push({
              url: st.playlist, quality: '1080p',
              label: '[Cinejoy ' + server + ']', container: 'hls',
              headers: headers, kind: 'raw'
            });
          } else if (st.type === 'file' && st.qualities) {
            Object.keys(st.qualities).forEach(function (qk) {
              var q = st.qualities[qk];
              if (!q || !q.url || !/^https:/.test(q.url)) return;
              out.push({
                url: q.url,
                quality: qk === '4k' ? '2160p' : qk === '1080' ? '1080p' : qk === '720' ? '720p' : qk === '480' ? '480p' : 'Auto',
                label: '[Cinejoy ' + server + ' ' + qk + ']',
                container: /\.m3u8/i.test(q.url) ? 'hls' : 'unknown',
                headers: headers, kind: 'raw'
              });
            });
          }
          if (subtitleCb && st.captions) st.captions.forEach(function (c) {
            if (c && c.url) subtitleCb({ url: c.url, lang: c.language || c.id || 'Unknown' });
          });
        });
        return out;
      } catch (e) { return []; }
    }));
    var out = [];
    serverResults.forEach(function (r) { out = out.concat(r); });
    return out;
  } catch (e) { return []; }
}

// Showbox — RESTORED, tight timeouts, no retry
async function _invokeShowbox(imdbId, season, episode) {
  var token = _readSetting('showboxToken');
  if (!imdbId || !token) return [];
  var HDR = {
    Accept: 'application/json, text/html, */*',
    'Accept-Language': 'en',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/139.0.0.0'
  };
  var STEP_TIMEOUT = 800;
  try {
    // 1. Search — single attempt (no retry loop)
    var searchHtml = await _getText(API.showbox + '/search?keyword=' + imdbId, HDR, STEP_TIMEOUT);
    var hrefMatch = searchHtml.match(
      /class="film-name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"/) ||
      searchHtml.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*film-name[^"]*"/);
    if (!hrefMatch) return [];

    // 2. Detail → mediaId
    var detailHtml = await _getText(API.showbox + hrefMatch[1], HDR, STEP_TIMEOUT);
    var idMatch = detailHtml.match(/class="heading-name[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/);
    if (!idMatch) return [];
    var parts = idMatch[1].split('/');
    var mediaId = parseInt(parts[parts.length - 1], 10);
    if (!mediaId) return [];

    // 3. Share key
    var type = season != null ? 2 : 1;
    var shareJson = await _getJson(
      API.showbox + '/index/share_link?id=' + mediaId + '&type=' + type, HDR, STEP_TIMEOUT);
    var shareLink = shareJson && shareJson.data && shareJson.data.link;
    if (!shareLink) return [];
    var shareKey = shareLink.split('/').pop();

    // 4. Root file list
    var listJson = await _getJson(
      API.febbox + '/file/file_share_list?share_key=' + shareKey, HDR, STEP_TIMEOUT);
    var fileData = listJson && listJson.data;
    if (!fileData || !fileData.file_list) return [];

    // 5. Find video file
    var videoFile;
    if (season != null && episode != null) {
      var folder = fileData.file_list.find(function (f) {
        return f.is_dir && (
          (f.file_name || '').toLowerCase().indexOf('season ' + season) >= 0 ||
          (f.file_name || '').toLowerCase().indexOf('s' + String(season).padStart(2, '0')) >= 0
        );
      }) || fileData.file_list.find(function (f) { return f.is_dir; });
      if (!folder) return [];
      var epJson = await _getJson(
        API.febbox + '/file/file_share_list?share_key=' + shareKey + '&parent_id=' + folder.fid,
        HDR, STEP_TIMEOUT);
      var epList = (epJson && epJson.data && epJson.data.file_list) || [];
      var pad = String(episode).padStart(2, '0');
      videoFile = epList.find(function (f) {
        if (f.is_dir) return false;
        var name = (f.file_name || '').toLowerCase();
        return name.indexOf('e' + pad) >= 0 || name.indexOf('ep' + pad) >= 0 ||
               name.indexOf('episode ' + episode) >= 0;
      });
    } else {
      videoFile = fileData.file_list.find(function (f) { return !f.is_dir; });
    }
    if (!videoFile) return [];

    // 6. Quality list
    var cookieToken = token.startsWith('ui=') ? token : 'ui=' + token;
    var qualJson = await _getJson(
      API.febbox + '/console/video_quality_list?fid=' + videoFile.fid + '&share_key=' + shareKey,
      Object.assign({}, HDR, { Cookie: cookieToken }), STEP_TIMEOUT);
    var qualHtml = qualJson && qualJson.html;
    if (!qualHtml) return [];

    var VIDEO_HEADERS = {
      Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.8',
      Connection: 'keep-alive', Range: 'bytes=0-',
      Referer: API.febbox + '/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/139.0.0.0'
    };
    var out = [];
    var re = /<div[^>]*class="[^"]*file_quality[^"]*"[^>]*>/g;
    var mm;
    while ((mm = re.exec(qualHtml)) !== null) {
      var tag = mm[0];
      var u = (tag.match(/data-url="([^"]+)"/) || [])[1];
      var q = (tag.match(/data-quality="([^"]+)"/) || [])[1];
      if (!u || !q) continue;
      var isOrg = q === 'ORG';
      out.push({
        url: u.replace(/\\\//g, '/'),
        quality: isOrg ? '2160p' : (q.match(/\d{3,4}/) || ['Auto'])[0] + 'p',
        label: '[ShowBox' + (isOrg ? ' ORG' : '') + ']',
        container: /\.m3u8/.test(u) ? 'hls' : 'unknown',
        headers: VIDEO_HEADERS, kind: 'raw'
      });
    }
    return out;
  } catch (e) { console.warn('Showbox fail', String(e)); return []; }
}

// =============================================================================
//  REGISTRY
// =============================================================================
// needsMeta: provider requires ctx.title and/or ctx.tmdbId to be resolved first
var PROVIDER_REGISTRY = [
  { key: 'p_vaplayer',   name: 'VaPlayer',   needsMeta: false, timeoutMs: 1000,
    run: function (c) { return _invokeVaPlayer(c.imdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_showbox',    name: 'Showbox',    needsMeta: false, timeoutMs: 2200,
    run: function (c) { return _invokeShowbox(c.imdbId, c.season, c.episode); } },
  { key: 'p_vidlink',    name: 'Vidlink',    needsMeta: true, timeoutMs: 1000,
    run: function (c) { return _invokeVidlink(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidrock',    name: 'Vidrock',    needsMeta: true, timeoutMs: 1000,
    run: function (c) { return _invokeVidrock(c.tmdbId, c.season, c.episode); } },
  { key: 'p_peachify',   name: 'Peachify',   needsMeta: true, timeoutMs: 1000,
    run: function (c) { return _invokePeachify(c.tmdbId, c.season, c.episode); } },
  { key: 'p_meowtv',     name: 'Meowtv',     needsMeta: true, timeoutMs: 1000,
    run: function (c) { return _invokeMeowtv(c.tmdbId, c.season, c.episode); } },
  { key: 'p_vidfastpro', name: 'VidFastPro', needsMeta: true, timeoutMs: 1000,
    run: function (c) { return _invokeVidFastPro(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidcore',    name: 'Vidcore',    needsMeta: true, timeoutMs: 1000,
    run: function (c) { return _invokeVidcore(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidup',      name: 'Vidup',      needsMeta: true, timeoutMs: 1000,
    run: function (c) { return _invokeVidup(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_fshare',     name: 'Fshare',     needsMeta: true, timeoutMs: 1000,
    run: function (c) { return c.season == null ? _invokeFshare(c.title, c.imdbId) : Promise.resolve([]); } },
  { key: 'p_videasy',    name: 'Videasy',    needsMeta: true, timeoutMs: 1000,
    run: function (c) { return _invokeVideasy(c.title, c.tmdbId, c.imdbId, c.year, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_cinejoy',    name: 'Cinejoy',    needsMeta: true, timeoutMs: 1000,
    run: function (c) { return _invokeCinejoy(c.title, c.imdbId, c.tmdbId, c.year, c.season, c.episode, c.subtitleCb); } }
];

// =============================================================================
//  ORCHESTRATION
// =============================================================================
async function getVideoSources(episodeUrl, opts) {
  opts = opts || {};
  var parsed = _parseStreamId(episodeUrl);
  if (!parsed.ids.length) {
    console.warn('CineStream2: no ids parsed');
    return [];
  }

  var cfg = _combinedSettings();
  var subs = [];
  var subtitleCb = function (s) { if (s && s.url) subs.push(s); };

  // Extract imdbId/tmdbId from the episode JSON
  var parsedObj = null;
  if (typeof episodeUrl === 'string' && episodeUrl.charAt(0) === '{') {
    try { parsedObj = JSON.parse(episodeUrl); } catch (e) {}
  } else if (episodeUrl && typeof episodeUrl === 'object') {
    parsedObj = episodeUrl;
  }
  var imdbId = (parsedObj && (parsedObj.imdbId || parsedObj.imdb_id)) || null;
  var tmdbId = (parsedObj && (parsedObj.tmdbId || parsedObj.tmdb_id || parsedObj.moviedb_id)) || null;

  if (!imdbId) {
    for (var i = 0; i < parsed.ids.length; i++) {
      if (/^tt\d+/.test(parsed.ids[i])) { imdbId = parsed.ids[i]; break; }
    }
  }

  // Shared meta resolution — Cinemeta + TMDB find + TMDB detail fallback
  var metaPromise = withTimeout(
    _resolveMeta(imdbId, tmdbId, parsed.type === 'series' ? 'tv' : 'movie'),
    META_TIMEOUT,
    { title: null, year: null, tmdbId: tmdbId || null }
  ).catch(function (e) {
    console.warn('meta resolve failed', String(e));
    return { title: null, year: null, tmdbId: tmdbId || null };
  });

  var ctx = {
    imdbId: imdbId, tmdbId: tmdbId,
    title: null, year: null,
    season: parsed.season, episode: parsed.episode,
    subtitleCb: subtitleCb
  };

  // Fire every provider in parallel
  var jobPromises = [];
  for (var p = 0; p < PROVIDER_REGISTRY.length; p++) {
    (function (provider) {
      var task;
      if (provider.needsMeta) {
        task = metaPromise.then(function (meta) {
          if (meta) {
            if (meta.title) ctx.title = meta.title;
            if (meta.year) ctx.year = meta.year;
            if (!ctx.tmdbId && meta.tmdbId) ctx.tmdbId = meta.tmdbId;
          }
          return provider.run(ctx);
        });
      } else {
        task = Promise.resolve(provider.run(ctx));
      }
      jobPromises.push(
        withTimeout(task, provider.timeoutMs || PROVIDER_TIMEOUT, []).catch(function (e) {
          console.warn('provider fail', provider.key, String(e));
          return [];
        })
      );
    })(PROVIDER_REGISTRY[p]);
  }

  // Add-ons
  cfg.addons.forEach(function (base) {
    jobPromises.push(
      withTimeout(_queryAddon(base, parsed, subtitleCb), ADDON_TIMEOUT).catch(function () { return []; })
    );
  });

  // Wyzie
  if (cfg.wyzieKey && imdbId) {
    _invokeWyzieSubs(imdbId, parsed.season, parsed.episode, subtitleCb);
  }

  var lists = await withTimeout(Promise.all(jobPromises), GLOBAL_TIMEOUT, []);

  var seen = new Set();
  var out = [];
  for (var l = 0; l < lists.length; l++) {
    var list = lists[l] || [];
    for (var s = 0; s < list.length; s++) {
      var stream = list[s];
      if (stream && stream.url && !seen.has(stream.url)) {
        seen.add(stream.url);
        out.push(stream);
      }
    }
  }

  var cb = opts.onSubtitle || opts.subtitleCallback;
  if (typeof cb === 'function') {
    var subSeen = new Set();
    subs.forEach(function (s) {
      if (!subSeen.has(s.url)) { subSeen.add(s.url); cb(s); }
    });
  }

  console.log('CineStream2: ' + out.length + ' streams | title=' + (ctx.title || '?') +
              ' | tmdbId=' + (ctx.tmdbId || '?') + ' | imdbId=' + (ctx.imdbId || '?'));
  return out;
}

function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts)   { return getVideoSources(id, opts); }

// =============================================================================
//  EXPORTS
// =============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.3',
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
    // Test hooks
    withTimeout: withTimeout,
    _resolveMeta: _resolveMeta,
    _tmdbFind: _tmdbFind,
    _itemFromCinemeta: _itemFromCinemeta,
    _itemFromTmdb: _itemFromTmdb,
    _parseAddonUrls: _parseAddonUrls,
    _parseStreamId: _parseStreamId,
    _parseDetailUrl: _parseDetailUrl,
    _episodeUrl: _episodeUrl,
    _tmdbUrl: _tmdbUrl,
    _combinedSettings: _combinedSettings,
    _toZangetsuStream: _toZangetsuStream,
    _invokeVaPlayer: _invokeVaPlayer,
    _invokeShowbox: _invokeShowbox,
    _invokeVidlink: _invokeVidlink,
    _invokeVidrock: _invokeVidrock,
    _invokePeachify: _invokePeachify,
    _invokeMeowtv: _invokeMeowtv,
    _invokeVidFastPro: _invokeVidFastPro,
    _invokeVidcore: _invokeVidcore,
    _invokeVidup: _invokeVidup,
    _invokeFshare: _invokeFshare,
    _invokeVideasy: _invokeVideasy,
    _invokeCinejoy: _invokeCinejoy,
    peachifyDecrypt: peachifyDecrypt,
    decryptVidrockUrl: decryptVidrockUrl,
    _md5: _md5
  };
}
