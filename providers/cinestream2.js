// =============================================================================
//  cinestream2.js — CineStream2 provider for Zangetsu (QuickJS-NG)
//
//  v1.0.1 — Fixes:
//    • URLs now use tmdb:// scheme (matches working reference provider)
//    • Episodes carry both id and videoId
//    • _parseStreamId honours moviedb_id
//    • TMDB path uses trailing-dot host when custom key is set
//    • getDetail falls back gracefully when Cinemeta is slow/down
//
//  Catalog : Cinemeta · TMDB · Kitsu
//  Sources : Stremio add-ons + 15 direct extractors
//  Runtime : QuickJS-NG (crypto.subtle, TextEncoder, bytesToBase64, fetch, URL)
// =============================================================================

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID)
  : 'cinestream2';

// ── Endpoints ───────────────────────────────────────────────────────────
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

var API = {
  torrentio:      'https://torrentio.strem.fun/limit=4',
  vidlink:        'https://vidlink.pro',
  vidfast:        'https://vidfast.vc',
  vidcore:        'https://vidcore.io',
  vidup:          'https://vidup.to',
  vidrock:        'https://vidrock.ru',
  videasy:        'https://api.speedracelight.com',
  vaplayer:       'https://streamdata.vaplayer.ru',
  fshare:         'https://fsharetv.cc',
  meowtv:         'https://api.meowtv.ru',
  meowtvBase:     'https://meowtv.ru',
  peachify:       'https://x.eat-peach.sbs',
  peachifyBase:   'https://peachify.top',
  cinejoy:        'https://api.shegu.st',
  cinejoyBase:    'https://cinejoy.to',
  castle:         'https://api.hlowb.com',
  showbox:        'https://showbox.media',
  febbox:         'https://www.febbox.com',
  movieboxHost:   'https://h5-api.aoneroom.com',
  movieboxList:   'https://h5.aoneroom.com'
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
    version: '1.0.1'
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
      description: 'Optional. Bearer token from febbox.com console. Enables Showbox.',
      type: 'text', default: '' },
    { key: 'castleKey', label: 'Castle APK Sign Key',
      description: 'Optional. Enables the Castle provider.',
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

// ── Setting accessors ──────────────────────────────────────────────────
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
    castleKey:     _trim(_readSetting('castleKey')),
    allowDownload: _bool('allowDownloadLinks', false),
    maxPerAddon:   Math.min(_num('maxStreamsPerAddon', 25), 100)
  };
}

// =============================================================================
//  BYTE HELPERS
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

// =============================================================================
//  WEB CRYPTO
// =============================================================================
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
async function _hmacSha256(rawKeyBytes, dataBytes) {
  var key = await crypto.subtle.importKey('raw', rawKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
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
//  NAMED DECRYPTS
// =============================================================================
async function decryptVidzeeUrl(encryptedUrl, secret) {
  try {
    var decoded = _b64ToBytes(encryptedUrl);
    var colonAt = decoded.indexOf(58);
    if (colonAt < 0) return null;
    var iv = decoded.slice(0, colonAt);
    var ct = decoded.slice(colonAt + 1);
    var rawKey = new Uint8Array(32);
    var secBytes = _strToBytes(secret);
    rawKey.set(secBytes.slice(0, 32));
    return _bytesToStr(await _aesCbcDecrypt(rawKey, iv, ct));
  } catch (e) { return null; }
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
    var nonce = ct.slice(0, 12);
    var tag = ct.slice(12);
    return _bytesToStr(await _aesGcmDecrypt(_hexToBytes(keyHex), nonce, tag, 128));
  } catch (e) { return null; }
}
async function decryptCastle(cipherTextB64, securityKeyB64) {
  var pepper = _strToBytes('T!BgJB');
  var keyWords = _b64ToBytes(securityKeyB64);
  var combined = new Uint8Array(keyWords.length + pepper.length);
  combined.set(keyWords); combined.set(pepper, keyWords.length);
  var keyMaterial = combined.slice(0, 16);
  var ct = _b64ToBytes(cipherTextB64);
  return _bytesToStr(await _aesCbcDecrypt(keyMaterial, keyMaterial, ct));
}
var _HIND_SECRET_B64 = 'NWU5NjA4NWM1NmUwZjU0ZWRhNjU3NzkwYWM1OGQxOWIyNzE0NzljNTA0MzY3ZmM5ZTZhNmMzM2YxZjgyNGU2Yg==';
async function hindmoviezSignHShare(rawId, domain) {
  var secret = _bytesToStr(_b64ToBytes(_HIND_SECRET_B64));
  var encoded = _bytesToB64url(_strToBytes(rawId));
  var t = Math.floor(Date.now() / 1000);
  var macBytes = await _hmacSha256(_strToBytes(secret), _strToBytes(encoded + '|' + t));
  var sig = _bytesToHex(macBytes).slice(0, 16);
  return domain + '/r.php?d=' + encodeURIComponent(encoded) + '&t=' + t + '&s=' + sig;
}
async function generateSignedUrl(url, secret) {
  try {
    var u = new URL(url);
    var timestamp = Math.floor(Date.now() / 1000).toString();
    var mac = await _hmacSha256(_strToBytes(secret), _strToBytes(u.pathname + timestamp));
    return url + '?verify=' + timestamp + '-' + encodeURIComponent(_bytesToB64(mac));
  } catch (e) { return null; }
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
    timeoutMs: opts.timeoutMs || 15000
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
    timeoutMs: opts.timeoutMs || 15000
  }).then(function (r) { return r && r.body != null ? r.body : ''; });
}
function _getJson(url, headers, timeoutMs) {
  return _fetch(url, { headers: headers || { Accept: 'application/json' }, timeoutMs: timeoutMs || 15000 });
}
function _getText(url, headers, timeoutMs) {
  return _fetchText(url, { headers: headers || {}, timeoutMs: timeoutMs || 15000 });
}

// =============================================================================
//  TMDB / CINEMETA
// =============================================================================

// FIX #4 — use trailing-dot host when a custom key is set (bypasses interceptor)
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
  return _fetch(_tmdbPath(path), { headers: headers, timeoutMs: 12000 })
    .catch(function (e) { console.warn('TMDB fail', path, e); return null; });
}
function _tmdbImage(path, size) {
  if (!path) return null;
  return TMDB_IMG + '/' + (size || 'w500') + path;
}
function _cinemetaMeta(type, imdbId) {
  return _fetch(CINEMETA + '/meta/' + type + '/' + imdbId + '.json')
    .then(function (j) { return j && j.meta ? j.meta : null; })
    .catch(function () { return null; });
}
function _kitsuMeta(kitsuId) {
  var id = String(kitsuId).replace(':', '%3A');
  return _fetch(KITSU + '/meta/series/' + id + '.json')
    .then(function (j) { return j && j.meta ? j.meta : null; })
    .catch(function () { return null; });
}
function _externalIds(source, id) {
  return _fetch(HAGLUND + '/ids?source=' + source + '&id=' + encodeURIComponent(id))
    .then(function (j) { return j || {}; })
    .catch(function () { return {}; });
}
function _enrichFromAioMetadata(type, imdbId) {
  if (!imdbId) return Promise.resolve(null);
  return _fetch(AIO_META_PRIMARY + '/' + type + '/' + imdbId + '.json')
    .catch(function () {
      return _fetch(AIO_META_FALLBACK + '/' + type + '/' + imdbId + '.json')
        .catch(function () { return null; });
    })
    .then(function (j) { return j && j.meta ? j.meta : null; });
}

// =============================================================================
//  UTILS
// =============================================================================
function _year(rec) {
  return String(rec.release_date || rec.first_air_date || rec.releaseInfo || rec.year || '').slice(0, 4) || null;
}
function _pad(n) { n = parseInt(n, 10) || 0; return n < 10 ? '0' + n : String(n); }

// FIX #1 — tmdb:// URLs (matching the working reference)
function _tmdbUrl(type, id) {
  return 'tmdb://' + (type === 'tv' || type === 'series' ? 'tv' : 'movie') + '/' + String(id);
}

// =============================================================================
//  CATALOG ITEMS
// =============================================================================
function _itemFromCinemeta(m) {
  if (!m || !m.id) return null;
  var isTv = m.type === 'series';
  // FIX #1 — tmdb:// scheme with IMDB ID encoded
  var url = _tmdbUrl(isTv ? 'tv' : 'movie', m.id);
  var title = (m.aliases && m.aliases.length && m.aliases[0]) || m.name || '';
  if (!title) return null;
  var item = {
    id: url, url: url,
    title: _year(m) ? title + ' (' + _year(m) + ')' : title,
    cover: m.poster || null,
    banner: m.background || null,
    type: 'movie',
    sourceId: SOURCE_ID,
    imdbId: m.id,
    tmdbIsTv: isTv
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
    type: 'movie',
    sourceId: SOURCE_ID,
    tmdbId: rec.id,
    tmdbIsTv: isTv,
    score: rec.vote_average != null ? Math.round(Number(rec.vote_average) * 10) : undefined
  };
}

// =============================================================================
//  CATALOG ENDPOINTS
// =============================================================================
function getHome(opts) {
  return Promise.all([
    _fetch(CINEMETA + '/catalog/movie/top.json').catch(function () { return null; }),
    _fetch(CINEMETA + '/catalog/series/top.json').catch(function () { return null; }),
    _fetch(KITSU + '/catalog/anime/kitsu-anime-trending.json').catch(function () { return null; }),
    _tmdbJson('/trending/all/week')
  ]).then(function (rows) {
    var lists = [];
    function addRow(title, list) {
      if (list && list.length) lists.push({ title: title, items: list });
    }
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
    _fetch(CINEMETA + '/catalog/movie/top/search=' + encodeURIComponent(q) + '.json').catch(function () { return null; }),
    _fetch(CINEMETA + '/catalog/series/top/search=' + encodeURIComponent(q) + '.json').catch(function () { return null; }),
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

// FIX #1 — accept tmdb:// for both IMDB IDs (tt…) and numeric TMDB IDs
function _parseDetailUrl(value) {
  var s = String(value || '');
  if (!s) return null;

  // tmdb://movie/tt1234567  →  Cinemeta lookup
  // tmdb://tv/tt1234567     →  Cinemeta series lookup
  // tmdb://movie/12345      →  TMDB lookup
  var m = s.match(/^tmdb:\/\/(movie|tv|series)\/([^\/?#]+)/i);
  if (m) {
    var kind = m[1].toLowerCase() === 'movie' ? 'movie' : 'tv';
    var id = decodeURIComponent(m[2]);
    if (/^tt\d+$/.test(id)) {
      return { kind: kind === 'movie' ? 'movie' : 'series', id: id, source: 'cinemeta' };
    }
    if (/^\d+$/.test(id)) {
      return { kind: 'tmdb', type: kind, id: id };
    }
  }

  // Legacy / fallback cinestream:// schemes
  m = s.match(/^cinestream:\/\/(movie|series|kitsu)\/(.+)$/i);
  if (m) return { kind: m[1].toLowerCase(), id: decodeURIComponent(m[2]) };
  m = s.match(/^cinestream:\/\/tmdb\/(movie|tv)\/(\d+)/i);
  if (m) return { kind: 'tmdb', type: m[1].toLowerCase(), id: m[2] };

  // Bare IMDB ID
  m = s.match(/^(tt\d+)/);
  if (m) return { kind: 'movie', id: m[1] };

  return null;
}

// FIX #2 — include videoId alongside id (matches reference)
function _episodeUrl(type, imdbId, tmdbId, season, episode) {
  var kind = type === 'tv' || type === 'series' ? 'series' : 'movie';
  var numericId = tmdbId || '';
  var payload = {
    id:     imdbId || (tmdbId ? 'tmdb:' + tmdbId : ''),
    videoId: imdbId || (tmdbId ? 'tmdb:' + tmdbId : ''),
    imdbId: imdbId || undefined,
    tmdbId: tmdbId || undefined,
    type:   kind,
    season: season || 0,
    episode: episode || 0
  };
  if (numericId) payload.tmdbIsTv = kind === 'series';
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

  // ── Cinemeta path (movies and series with IMDB IDs) ─────────────────
  if (parsed.kind === 'movie' || parsed.kind === 'series') {
    var cmType = parsed.kind === 'series' ? 'series' : 'movie';
    return Promise.all([
      _cinemetaMeta(cmType, parsed.id),
      _enrichFromAioMetadata(cmType, parsed.id)
    ]).then(function (rs) {
      var meta = rs[0], extras = rs[1];
      if (!meta) return null;
      return _buildFromCinemeta(meta, parsed, extras, url);
    });
  }

  // ── TMDB path ───────────────────────────────────────────────────────
  if (parsed.kind === 'tmdb') {
    return _tmdbJson('/' + parsed.type + '/' + parsed.id +
                     '?append_to_response=external_ids,credits,videos,alternative_titles')
      .then(function (info) {
        if (!info || info.id == null) return null;
        return _buildFromTmdb(info, parsed, url);
      });
  }

  // ── Kitsu bridge ────────────────────────────────────────────────────
  if (parsed.kind === 'kitsu') {
    return _externalIds('kitsu', parsed.id).then(function (ids) {
      if (ids && ids.imdb) {
        return getDetail(_tmdbUrl('tv', ids.imdb), opts);
      }
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
  var episodes = [];

  if (isTv) {
    episodes = (meta.videos || [])
      .filter(function (v) { return v.season !== 0; })
      .sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); })
      .map(function (v) {
        return {
          id: String(v.season) + 'x' + String(v.episode),
          title: 'S' + _pad(v.season) + ' E' + _pad(v.episode) + ' - ' + (v.name || v.title || ''),
          number: v.episode,
          season: v.season,
          url: _episodeUrl('series', imdbId, tmdbId, v.season, v.episode),
          date: v.firstAired || v.released || null,
          thumbnail: v.thumbnail || null
        };
      });
  } else {
    episodes = [{
      id: 'movie', title: title, number: 1,
      url: _episodeUrl('movie', imdbId, tmdbId, 0, 0)
    }];
  }

  var result = {
    id: sourceUrl, url: sourceUrl,
    title: title,
    cover: meta.poster || null,
    banner: meta.background || (extras && extras.background) || null,
    description: (meta.awards ? '[' + meta.awards + '] ' : '') + (meta.description || ''),
    status: _statusFromCinemeta(meta.status),
    genres: genres,
    studios: [],
    type: 'movie',
    sourceId: SOURCE_ID,
    year: year,
    imdbId: imdbId,
    tmdbId: tmdbId,
    tmdbIsTv: isTv,
    logo: meta.logo || (extras && extras.logo) || null,
    episodes: episodes,
    subCount: episodes.length,
    dubCount: 0
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

  if (isTv) {
    var seasonJobs = [];
    var maxSeasons = Math.min(info.number_of_seasons || 1, 40);
    for (var s = 1; s <= maxSeasons; s++) {
      (function (seasonNo) {
        seasonJobs.push(_tmdbJson('/tv/' + parsed.id + '/season/' + seasonNo));
      })(s);
    }
    return Promise.all(seasonJobs).then(function (seasonData) {
      seasonData.sort(function (a, b) {
        return (a && a.season_number || 0) - (b && b.season_number || 0);
      });
      seasonData.forEach(function (sd) {
        if (!sd || !sd.episodes) return;
        sd.episodes.forEach(function (ep) {
          if (ep.episode_number == null) return;
          episodes.push({
            id: String(sd.season_number) + 'x' + String(ep.episode_number),
            title: 'S' + _pad(sd.season_number) + ' E' + _pad(ep.episode_number) + ' - ' + (ep.name || ''),
            number: ep.episode_number,
            season: sd.season_number,
            url: _episodeUrl('series', imdbId, parsed.id, sd.season_number, ep.episode_number),
            date: ep.air_date || null,
            thumbnail: ep.still_path ? TMDB_IMG + '/w300' + ep.still_path : null
          });
        });
      });
      return finalize();
    });
  } else {
    episodes = [{
      id: 'movie', title: title, number: 1,
      url: _episodeUrl('movie', imdbId, parsed.id, 0, 0)
    }];
    return Promise.resolve(finalize());
  }

  function finalize() {
    var result = {
      id: sourceUrl, url: sourceUrl,
      title: title,
      cover: info.poster_path ? TMDB_IMG + '/w500' + info.poster_path : null,
      banner: info.backdrop_path ? TMDB_IMG + '/w780' + info.backdrop_path : null,
      description: info.overview || '',
      status: _statusFromCinemeta(info.status),
      genres: genres,
      studios: [],
      type: 'movie',
      sourceId: SOURCE_ID,
      year: (info.release_date || info.first_air_date || '').slice(0, 4) || null,
      imdbId: imdbId,
      tmdbId: info.id,
      tmdbIsTv: isTv,
      episodes: episodes,
      subCount: episodes.length,
      dubCount: 0
    };
    if (info.vote_average) result.score = Math.round(Number(info.vote_average) * 10);
    return result;
  }
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
    genres: meta.genres || meta.genre || [],
    studios: [], type: 'movie', sourceId: SOURCE_ID,
    year: _year(meta),
    imdbId: null, tmdbId: meta.moviedb_id || null, tmdbIsTv: true,
    episodes: episodes,
    subCount: episodes.length, dubCount: 0
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

// FIX #3 — accept videoId + moviedb_id
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

  function add(v) {
    v = String(v == null ? '' : v);
    if (v && !seen[v]) { seen[v] = true; ids.push(v); }
  }

  // Add rawId only if it looks like a real ID (not a URL)
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
  var quality = qMatch
    ? (qMatch[1].toLowerCase() === '4k' ? '2160p' : qMatch[1].toLowerCase())
    : 'Auto';
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
  if (raw.name)        labelParts.push(raw.name);
  if (raw.title)       labelParts.push(raw.title);
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
  return _fetch(_manifestUrl(base)).then(function (manifest) {
    if (!manifest) return [];
    var resources = manifest.resources;
    var supportsStream = !Array.isArray(resources) ||
      resources.some(function (r) { return r === 'stream' || (r && r.name === 'stream'); });
    var jobs = [];
    if (supportsStream) {
      parsed.ids.forEach(function (id) {
        jobs.push(_fetch(_streamEndpoint(base, parsed.type, id)).then(function (data) {
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
        jobs.push(_fetch(_subtitleEndpoint(base, parsed.type, parsed.ids[0])).then(function (data) {
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
  return _fetch(url).then(function (list) {
    if (!Array.isArray(list)) return;
    list.forEach(function (s) {
      if (s && s.url) subtitleCb({ url: s.url, lang: s.display || s.language || 'Unknown' });
    });
  }).catch(function (e) { console.warn('wyzie fail', e); });
}

// =============================================================================
//  DIRECT EXTRACTORS
// =============================================================================
async function _invokeVideasy(title, tmdbId, imdbId, year, season, episode, subtitleCb) {
  if (!title || !tmdbId) return [];
  var servers = ['myflixerzupcloud','downloader2','m4uhd','hdmovie','cdn',
                 'superflix','lamovie','jett','tejo','neon2','ym'];
  var encTitle = encodeURIComponent(encodeURIComponent(title));
  var headers = { Accept: '*/*', Referer: 'https://player.videasy.to/', Origin: 'https://player.videasy.to' };
  var out = [];
  try {
    var seedJson = await _getJson(API.videasy + '/seed?mediaId=' + tmdbId, headers);
    var seed = seedJson && seedJson.seed;
    if (!seed) return [];
    for (var i = 0; i < servers.length; i++) {
      try {
        var server = servers[i];
        var url = season == null
          ? API.videasy + '/' + server + '/sources-with-title?title=' + encTitle +
            '&mediaType=movie&year=' + (year || '') + '&tmdbId=' + tmdbId +
            '&imdbId=' + (imdbId || '') + '&enc=2&seed=' + encodeURIComponent(seed)
          : API.videasy + '/' + server + '/sources-with-title?title=' + encTitle +
            '&mediaType=tv&year=' + (year || '') + '&tmdbId=' + tmdbId +
            '&episodeId=' + episode + '&seasonId=' + season +
            '&imdbId=' + (imdbId || '') + '&enc=2&seed=' + encodeURIComponent(seed);
        var encText = await _getText(url, headers);
        var dec = await _fetch(MULTI_DECRYPT_API + '/dec-videasy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: encText, id: tmdbId, seed: seed })
        });
        var result = dec && dec.result;
        if (!result) continue;
        (result.sources || []).forEach(function (s) {
          if (!s || !s.url) return;
          out.push({
            url: s.url, quality: s.quality || 'Auto',
            label: '[Videasy ' + server + '] ' + (s.quality || ''),
            container: /\.m3u8/i.test(s.url) ? 'hls' : /\.(mp4|mkv)/i.test(s.url) ? 'mp4' : 'unknown',
            headers: headers, kind: 'raw'
          });
        });
        if (subtitleCb) {
          (result.subtitles || []).forEach(function (sub) {
            if (sub && sub.url) subtitleCb({ url: sub.url, lang: sub.language || 'Unknown' });
          });
        }
      } catch (e) {}
    }
    return out;
  } catch (e) { return []; }
}

async function _invokeVidlink(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  try {
    var encText = await _getText(MULTI_DECRYPT_API + '/enc-vidlink?text=' + tmdbId);
    var parsed = JSON.parse(encText);
    var payload = parsed && parsed.result;
    if (!payload) return [];
    var headers = { 'User-Agent': PLAYER_UA, Referer: API.vidlink + '/', Origin: API.vidlink };
    var epUrl = season == null
      ? API.vidlink + '/api/b/movie/' + payload
      : API.vidlink + '/api/b/tv/' + payload + '/' + season + '/' + episode;
    var data = JSON.parse(await _getText(epUrl, headers));
    var stream = data && data.stream;
    if (!stream) return [];
    var out = [];
    var quals = stream.qualities || {};
    Object.keys(quals).forEach(function (k) {
      var q = quals[k];
      if (!q || !q.url) return;
      out.push({
        url: q.url,
        quality: k === '1080' ? '1080p' : k === '720' ? '720p' : k === '480' ? '480p' : k === '360' ? '360p' : 'Auto',
        label: '[VidLink] ' + k,
        container: q.type === 'm3u8' || /\.m3u8/i.test(q.url) ? 'hls' : 'unknown',
        headers: q.headers || {}, kind: 'raw'
      });
    });
    if (subtitleCb) {
      (stream.captions || []).forEach(function (c) {
        if (c && c.url && c.language) subtitleCb({ url: c.url, lang: c.language });
      });
    }
    return out;
  } catch (e) { return []; }
}

async function _invokeVidFastPro(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  var base = API.vidfast;
  var url = season == null
    ? base + '/movie/' + tmdbId + '/'
    : base + '/tv/' + tmdbId + '/' + season + '/' + episode + '/';
  var headers = { 'User-Agent': PLAYER_UA, Referer: base + '/' };
  try {
    var html = await _getText(url, headers);
    var m = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    if (!m) return [];
    var enc = m[1];
    var encText = await _getText(MULTI_DECRYPT_API + '/enc-vidfast?text=' + encodeURIComponent(enc));
    var parsed = JSON.parse(encText);
    var result = parsed && parsed.result;
    if (!result || !result.servers || !result.stream || !result.token) return [];
    var postHeaders = Object.assign({}, headers, { 'X-CSRF-Token': result.token });
    var serversEnc = await _fetchText(result.servers, { method: 'POST', headers: postHeaders });
    var decTxt = await _fetchText(MULTI_DECRYPT_API + '/dec-vidfast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: serversEnc })
    });
    var dec = JSON.parse(decTxt);
    var servers = (dec && dec.result) || [];
    var out = [];
    for (var i = 0; i < servers.length; i++) {
      try {
        var srv = servers[i];
        if (!srv || !srv.data) continue;
        var streamEnc = await _fetchText(result.stream + '/' + srv.data, { method: 'POST', headers: postHeaders });
        var finalTxt = await _fetchText(MULTI_DECRYPT_API + '/dec-vidfast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: streamEnc })
        });
        var final = JSON.parse(finalTxt);
        var r = final && final.result;
        if (!r || !r.url) continue;
        if (subtitleCb && r.tracks) {
          r.tracks.forEach(function (t) {
            if (t.file && t.label) subtitleCb({ url: t.file, lang: t.label });
          });
        }
        var is4k = r.is4kAvailable || /4K/i.test(srv.description || '');
        out.push({
          url: r.url, quality: is4k ? '2160p' : '1080p',
          label: '[VidFastPro ' + (srv.name || '') + ']',
          container: /\.m3u8/i.test(r.url) ? 'hls' : 'unknown',
          headers: postHeaders, kind: 'raw'
        });
      } catch (e) {}
    }
    return out;
  } catch (e) { return []; }
}

async function _invokeCinejoy(title, imdbId, tmdbId, year, season, episode, subtitleCb) {
  if (!title) return [];
  var isSeries = season != null && episode != null;
  var type = isSeries ? 'series' : 'movie';
  var headers = { Accept: '*/*', Origin: API.cinejoyBase, Referer: API.cinejoyBase + '/', 'User-Agent': PLAYER_UA };
  try {
    var serversText = await _getText(API.cinejoy + '/servers', headers);
    var parsed = JSON.parse(serversText);
    var servers = ((parsed && parsed.servers) || []).map(function (s) { return s && s.name; }).filter(Boolean);
    var encodedTitle = encodeURIComponent(title);
    var out = [];
    for (var i = 0; i < servers.length; i++) {
      try {
        var server = servers[i];
        var targetUrl = API.cinejoy + '/?title=' + encodedTitle + '&type=' + type +
          '&year=' + (year || '') + '&imdb=' + (imdbId || '') + '&tmdb=' + (tmdbId || '') +
          '&server=' + server + (isSeries ? '&season=' + season + '&episode=' + episode : '');
        var encTxt = await _getText(MULTI_DECRYPT_API + '/enc-cinejoy?url=' + encodeURIComponent(targetUrl));
        var encRes = JSON.parse(encTxt);
        if (!encRes || encRes.status !== 200 || !encRes.result || !encRes.result.data) continue;
        var dataB64 = encRes.result.data;
        var state = encRes.result.state;
        var decoded = _b64urlToBytes(dataB64);
        if (!decoded) continue;
        var resp = await fetch(API.cinejoy + '/g', {
          method: 'POST', headers: headers, body: decoded, timeoutMs: 15000
        });
        var buf = await Promise.resolve(resp && resp.arrayBuffer ? resp.arrayBuffer() : null);
        if (!buf) continue;
        var bytesArr = new Uint8Array(buf);
        var b64 = _bytesToB64url(bytesArr);
        var decTxt = await _fetchText(MULTI_DECRYPT_API + '/dec-cinejoy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: b64, state: state })
        });
        var dec = JSON.parse(decTxt);
        var data = dec && dec.result && dec.result.data;
        if (!data || data.error) continue;
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
          if (subtitleCb && st.captions) {
            st.captions.forEach(function (c) {
              if (c && c.url) subtitleCb({ url: c.url, lang: c.language || c.id || 'Unknown' });
            });
          }
        });
      } catch (e) {}
    }
    return out;
  } catch (e) { return []; }
}

async function _invokeMeowtv(tmdbId, season, episode) {
  if (!tmdbId) return [];
  var servers = ['ipcloud', 'dcloud', 'tik', 'turkce', 'hindiv3'];
  var type = season != null ? 'tv' : 'movie';
  var headers = { 'User-Agent': PLAYER_UA, Origin: API.meowtvBase, Referer: API.meowtvBase + '/' };
  var out = [];
  for (var i = 0; i < servers.length; i++) {
    try {
      var server = servers[i];
      var url = API.meowtv + '/streams/' + type + '/' + tmdbId;
      if (season != null) url += '/' + season + '/' + episode;
      url += '?s=' + server;
      var json = JSON.parse(await _getText(url, headers));
      var dec = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-meowtv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: json })
      }));
      var r = dec && dec.result;
      if (!r || !r.url) continue;
      out.push({
        url: r.url, quality: '1080p',
        label: '[MeowTV ' + server + '] ' + (r.language || ''),
        container: /\.m3u8/i.test(r.url) ? 'hls' : 'unknown',
        headers: headers, kind: 'raw'
      });
    } catch (e) {}
  }
  return out;
}

async function _invokeVaPlayer(imdbId, season, episode, subtitleCb) {
  if (!imdbId) return [];
  var referer = 'https://nextgencloudfabric.com/';
  var url = season == null
    ? API.vaplayer + '/api.php?imdb=' + imdbId + '&type=movie'
    : API.vaplayer + '/api.php?imdb=' + imdbId + '&type=tv&season=' + season + '&episode=' + episode;
  try {
    var res = JSON.parse(await _getText(url, { Referer: referer }));
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

async function _invokeFshare(title, imdbId) {
  if (!title) return [];
  var slug = (title + ' episode 1 ' + (imdbId || ''))
    .toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
  var url = API.fshare + '/w/' + slug;
  try {
    var html = await _getText(url);
    var tokMatch = html.match(/Movie\.setSource\('([^']+)'/);
    if (!tokMatch) return [];
    var token = tokMatch[1];
    var trailerMatch = html.match(/id=["']trailer["'][^>]+value=["']([^"']+)["']/i);
    var trailer = trailerMatch ? trailerMatch[1] : '';
    var res = JSON.parse(await _getText(
      API.fshare + '/api/file/' + token + '/source?trailer=' + encodeURIComponent(trailer) + '&type=watch'));
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

async function _invokeMoviebox(title, season, episode, subtitleCb) {
  if (!title) return [];
  var HOST = 'h5-api.aoneroom.com', BASE = 'https://' + HOST;
  try {
    var pkgResp = await fetch(BASE + '/wefeed-h5api-bff/app/get-latest-app-pkgs?app_name=moviebox', {
      headers: { Accept: 'application/json' }, timeoutMs: 15000
    });
    var xUser = pkgResp && pkgResp.headers && pkgResp.headers.get
      ? pkgResp.headers.get('x-user') : null;
    if (!xUser) return [];
    var token = JSON.parse(xUser).token;
    if (!token) return [];

    var baseHeaders = {
      'X-Client-Info': '{"timezone":"Africa/Nairobi"}',
      'Accept-Language': 'en-US,en;q=0.5', Accept: 'application/json',
      Referer: BASE, Host: HOST, Connection: 'keep-alive',
      Authorization: 'Bearer ' + token,
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/138.0.0.0'
    };

    var subjectType = season != null ? 2 : 1;
    var searchData = JSON.parse(await _fetchText(BASE + '/wefeed-h5api-bff/subject/search', {
      method: 'POST',
      headers: Object.assign({}, baseHeaders, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ keyword: title, page: 1, perPage: 24, subjectType: subjectType })
    })).data;
    if (searchData && searchData.data) searchData = searchData.data;
    var items = (searchData && searchData.items) || [];

    var SEASON_SUFFIX = /\sS\d+(?:-S?\d+)*$/i;
    var titleRe = new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                             '(?:\\s+\\[([^\\]]+)\\])?$', 'i');
    var unique = new Map();
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item.subjectId) continue;
      var m = (item.title || '').replace(SEASON_SUFFIX, '').match(titleRe);
      if (!m) continue;
      if (!unique.has(item.subjectId)) unique.set(item.subjectId, m[1] || 'Original');
    }
    if (!unique.size) return [];

    var out = [];
    var entries = Array.from(unique.entries());
    for (var e = 0; e < entries.length; e++) {
      var subjectId = entries[e][0], language = entries[e][1];
      try {
        var detailObj = JSON.parse(await _getText(
          'https://h5.aoneroom.com/wefeed-h5-bff/web/post/list/subject?id=' + subjectId));
        var inner = detailObj.data && detailObj.data.items && detailObj.data.items[0];
        var detailPath = inner && inner.subject && inner.subject.detailPath;
        if (!detailPath) continue;

        var params = 'subjectId=' + subjectId;
        if (season != null) params += '&se=' + season + '&ep=' + episode;
        params += '&detailPath=' + detailPath;

        var reqHeaders = Object.assign({}, baseHeaders, {
          Referer: 'https://fmoviesunblocked.net/spa/videoPlayPage/movies/' + detailPath +
                   '?id=' + subjectId + '&type=/movie/detail',
          Origin: 'https://fmoviesunblocked.net'
        });

        var downloadRaw = await _getText(BASE + '/wefeed-h5api-bff/subject/download?' + params, reqHeaders).catch(function () { return '{}'; });
        var playRaw = await _getText(BASE + '/wefeed-h5api-bff/subject/play?' + params, reqHeaders).catch(function () { return '{}'; });
        var downloadData = JSON.parse(downloadRaw).data;
        if (downloadData && downloadData.data) downloadData = downloadData.data;
        var playData = JSON.parse(playRaw).data;
        if (playData && playData.data) playData = playData.data;

        var addedQualities = new Set();
        function addStream(url, resolution, isVip) {
          if (!url || isVip) return;
          var q = parseInt(resolution, 10) || 0;
          if (q && addedQualities.has(q)) return;
          if (q) addedQualities.add(q);
          out.push({
            url: url, quality: q ? q + 'p' : 'Auto',
            label: '[MovieBox ' + language + ']', container: 'unknown',
            headers: { Referer: 'https://fmoviesunblocked.net/', Origin: 'https://fmoviesunblocked.net' },
            kind: 'raw'
          });
        }
        (downloadData && downloadData.downloads || []).forEach(function (d) {
          addStream(d.url, d.resolution, d.vipLocked);
        });
        (playData && playData.streams || []).forEach(function (s) {
          addStream(s.url, s.resolutions || s.resolution, s.vipLocked);
        });
        (playData && playData.dash || []).forEach(function (d) {
          if (d.url && !d.vipLocked) out.push({
            url: d.url, quality: 'Auto',
            label: '[MovieBox Auto ' + language + ' (DASH)]',
            container: 'unknown', headers: {}, kind: 'raw'
          });
        });
        (downloadData && downloadData.captions || []).forEach(function (s) {
          if (s.url && subtitleCb) subtitleCb({ url: s.url, lang: s.lanName || s.lan || 'Unknown' });
        });
      } catch (e) {}
    }
    return out;
  } catch (e) { return []; }
}

async function _invokeShowbox(imdbId, season, episode) {
  var token = _readSetting('showboxToken');
  if (!imdbId || !token) return [];
  var HDR = {
    Accept: 'application/json, text/html, */*',
    'Accept-Language': 'en',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/139.0.0.0'
  };
  try {
    var mediaId = null;
    for (var attempt = 0; attempt < 3 && !mediaId; attempt++) {
      try {
        var searchHtml = await _getText(API.showbox + '/search?keyword=' + imdbId, HDR);
        var hrefMatch = searchHtml.match(
          /class="film-name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"/) ||
          searchHtml.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*film-name[^"]*"/);
        if (!hrefMatch) continue;
        var detailHtml = await _getText(API.showbox + hrefMatch[1], HDR);
        var idMatch = detailHtml.match(/class="heading-name[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/);
        if (idMatch) {
          var parts = idMatch[1].split('/');
          mediaId = parseInt(parts[parts.length - 1], 10);
        }
      } catch (e) {}
    }
    if (!mediaId) return [];

    var type = season != null ? 2 : 1;
    var shareJson = await _getJson(
      API.showbox + '/index/share_link?id=' + mediaId + '&type=' + type, HDR);
    var shareLink = shareJson && shareJson.data && shareJson.data.link;
    if (!shareLink) return [];
    var shareKey = shareLink.split('/').pop();

    var listJson = await _getJson(
      API.febbox + '/file/file_share_list?share_key=' + shareKey, HDR);
    var fileData = listJson && listJson.data;
    if (!fileData || !fileData.file_list) return [];

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
        API.febbox + '/file/file_share_list?share_key=' + shareKey + '&parent_id=' + folder.fid, HDR);
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

    var cookieToken = token.startsWith('ui=') ? token : 'ui=' + token;
    var qualJson = await _getJson(
      API.febbox + '/console/video_quality_list?fid=' + videoFile.fid + '&share_key=' + shareKey,
      Object.assign({}, HDR, { Cookie: cookieToken }));
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
  } catch (e) { return []; }
}

async function _invokeCastle(title, season, episode, subtitleCb) {
  if (!title) return [];
  var headers = {
    'User-Agent': 'okhttp/4.9.3', Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9', Connection: 'Keep-Alive',
    Referer: API.castle + '/'
  };
  var pkg = 'com.external.castle', channel = 'IndiaA', clientType = '1', apiLang = 'en-US';
  try {
    var keyJson = await _getJson(
      API.castle + '/v0.1/system/getSecurityKey/1?channel=' + channel +
      '&clientType=' + clientType + '&lang=' + apiLang, headers);
    var securityKey = keyJson && keyJson.data;
    if (!securityKey) return [];

    var searchEnc = await _getText(
      API.castle + '/film-api/v1.1.0/movie/searchByKeyword?channel=IndiaA&clientType=' +
      clientType + '&keyword=' + encodeURIComponent(title) +
      '&lang=' + apiLang + '&mode=1&packageName=' + pkg + '&page=1&size=30', headers);
    var searchInner;
    try { searchInner = JSON.parse(searchEnc).data || searchEnc; }
    catch (e) { searchInner = searchEnc; }
    var rows = JSON.parse(await decryptCastle(searchInner, securityKey)).rows || [];
    if (!rows.length) return [];

    var movieId = '';
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].title || rows[i].name || '';
      if (t.indexOf(title) >= 0 || title.indexOf(t) >= 0) {
        movieId = rows[i].id || rows[i].redirectId || rows[i].redirectIdStr || '';
        if (movieId) break;
      }
    }
    if (!movieId) movieId = rows[0].id || rows[0].redirectId || rows[0].redirectIdStr;
    if (!movieId) return [];

    var detailsEnc = await _getText(
      API.castle + '/film-api/v1.9.9/movie?channel=' + channel + '&clientType=' + clientType +
      '&lang=' + apiLang + '&movieId=' + movieId + '&packageName=' + pkg, headers);
    var detailsInner;
    try { detailsInner = JSON.parse(detailsEnc).data || detailsEnc; }
    catch (e) { detailsInner = detailsEnc; }
    var details = JSON.parse(await decryptCastle(detailsInner, securityKey));
    var effectiveMovieId = movieId;

    if (season != null && episode != null) {
      var seasons = details.seasons || [];
      for (var s = 0; s < seasons.length; s++) {
        if (seasons[s].number === season && seasons[s].movieId && seasons[s].movieId !== movieId) {
          var dEnc = await _getText(
            API.castle + '/film-api/v1.9.9/movie?channel=' + channel + '&clientType=' + clientType +
            '&lang=' + apiLang + '&movieId=' + seasons[s].movieId + '&packageName=' + pkg, headers);
          var dInner;
          try { dInner = JSON.parse(dEnc).data || dEnc; }
          catch (e) { dInner = dEnc; }
          details = JSON.parse(await decryptCastle(dInner, securityKey));
          effectiveMovieId = seasons[s].movieId;
          break;
        }
      }
    }

    var episodes = details.episodes || [];
    var target = null;
    if (season != null && episode != null) {
      target = episodes.find(function (e) { return e.number === episode; });
    } else if (episodes.length) {
      target = episodes[0];
    }
    if (!target || !target.id) return [];

    var videoEnc = await _fetchText(
      API.castle + '/film-api/v2.0.1/movie/getVideo2?clientType=' + clientType +
      '&packageName=' + pkg + '&channel=' + channel + '&lang=' + apiLang,
      { method: 'POST',
        headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mode: '1', appMarket: 'GuanWang', clientType: clientType, woolUser: 'false',
          apkSignKey: _readSetting('castleKey') || '',
          androidVersion: '13', movieId: effectiveMovieId, episodeId: target.id,
          isNewUser: 'true', resolution: '2', packageName: pkg
        }) });
    var videoInner;
    try { videoInner = JSON.parse(videoEnc).data || videoEnc; }
    catch (e) { videoInner = videoEnc; }
    var videoData = JSON.parse(await decryptCastle(videoInner, securityKey));
    var out = [];
    if (videoData.videoUrl) {
      out.push({
        url: videoData.videoUrl, quality: 'Auto',
        label: '[Castle] Auto', container: 'hls',
        headers: { Referer: API.castle }, kind: 'raw'
      });
    }
    (videoData.subtitles || []).forEach(function (sub) {
      if (sub && sub.url && subtitleCb) {
        subtitleCb({ url: sub.url, lang: sub.abbreviate || sub.title || 'English' });
      }
    });
    return out;
  } catch (e) { return []; }
}

async function _invokePeachify(tmdbId, season, episode) {
  if (!tmdbId) return [];
  var headers = {
    Origin: API.peachifyBase, Referer: API.peachifyBase + '/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137.0.0.0'
  };
  var servers = ['multi', 'hr', 'holly', 'air', 'moviebox'];
  var results = [];
  for (var i = 0; i < servers.length; i++) {
    try {
      var url = season == null
        ? API.peachify + '/' + servers[i] + '/movie/' + tmdbId
        : API.peachify + '/' + servers[i] + '/tv/' + tmdbId + '/' + season + '/' + episode;
      var encrypt = JSON.parse(await _getText(url, headers)).data;
      if (!encrypt) continue;
      var decrypted = await peachifyDecrypt(encrypt);
      if (!decrypted) continue;
      var json = JSON.parse(decrypted);
      var provider = json.providerName || 'Peachify';
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
        results.push({
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
    } catch (e) {}
  }
  return results;
}

async function _invokeVidrock(tmdbId, season, episode) {
  if (!tmdbId) return [];
  var type = season == null ? 'movie' : 'tv';
  var query = season == null ? String(tmdbId) : tmdbId + '_' + season + '_' + episode;
  var headers = { Origin: API.vidrock, Referer: API.vidrock + '/', 'User-Agent': PLAYER_UA };
  try {
    var data = JSON.parse(await _getText(API.vidrock + '/api/' + type + '/' + query + '/', headers));
    var out = [];
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      var encUrl = data[keys[i]] && data[keys[i]].url;
      if (!encUrl || encUrl === 'error' || encUrl === 'null') continue;
      var dec = await decryptVidrockUrl(encUrl);
      if (!dec) continue;
      out.push({
        url: dec, quality: 'Auto',
        label: '[Vidrock ' + keys[i] + ']',
        container: /m3u8/i.test(dec) ? 'hls' : 'unknown',
        headers: headers, kind: 'raw'
      });
    }
    return out;
  } catch (e) { return []; }
}

async function _invokeVidcore(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  var headers = { 'User-Agent': PLAYER_UA, Referer: API.vidcore + '/', 'X-Requested-With': 'XMLHttpRequest' };
  var baseUrl = season == null
    ? API.vidcore + '/movie/' + tmdbId
    : API.vidcore + '/tv/' + tmdbId + '/' + season + '/' + episode;
  try {
    var page = await _getText(baseUrl);
    var encM = page.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    if (!encM) return [];
    var initRaw = await _getText(MULTI_DECRYPT_API + '/enc-vidcore?text=' + encodeURIComponent(encM[1]));
    var init = JSON.parse(initRaw).result;
    if (!init) return [];
    headers['X-CSRF-Token'] = init.token;
    var serversEnc = await _fetchText(init.servers, { method: 'POST', headers: headers });
    var decServersRaw = await _fetchText(MULTI_DECRYPT_API + '/dec-vidcore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: serversEnc })
    });
    var serversList = JSON.parse(decServersRaw).result || [];
    var out = [];
    for (var i = 0; i < serversList.length; i++) {
      try {
        var srv = serversList[i];
        var streamEnc = await _fetchText(init.stream + '/' + srv.data, { method: 'POST', headers: headers });
        var decStreamRaw = await _fetchText(MULTI_DECRYPT_API + '/dec-vidcore', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: streamEnc })
        });
        var decStream = JSON.parse(decStreamRaw).result;
        if (!decStream || !decStream.url) continue;
        out.push({
          url: decStream.url, quality: '1080p',
          label: '[Vidcore ' + srv.name + ']',
          container: /m3u8/i.test(decStream.url) ? 'hls' : 'unknown',
          headers: headers, kind: 'raw'
        });
        (decStream.tracks || []).forEach(function (t) {
          if (t.file && t.label && subtitleCb) subtitleCb({ url: t.file, lang: t.label });
        });
      } catch (e) {}
    }
    return out;
  } catch (e) { return []; }
}

async function _invokeVidup(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  var headers = { 'User-Agent': PLAYER_UA, Referer: API.vidup + '/', 'X-Requested-With': 'XMLHttpRequest' };
  var url = season != null
    ? API.vidup + '/tv/' + tmdbId + '/' + season + '/' + episode
    : API.vidup + '/movie/' + tmdbId;
  try {
    var page = await _getText(url);
    var encM = page.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    if (!encM) return [];
    var parsed = JSON.parse(await _getText(MULTI_DECRYPT_API + '/enc-vidup?text=' + encM[1], headers));
    if (parsed.status !== 200 || !parsed.result) return [];
    var result = parsed.result;
    var postHeaders = Object.assign({}, headers, { 'X-CSRF-Token': result.token });
    var serversEnc = await _fetchText(result.servers, { method: 'POST', headers: postHeaders });
    var decRaw = await _fetchText(MULTI_DECRYPT_API + '/dec-vidup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: serversEnc })
    });
    var servers = (JSON.parse(decRaw).result) || [];
    var out = [];
    for (var i = 0; i < servers.length; i++) {
      if (!servers[i].data) continue;
      try {
        var streamEnc = await _fetchText(result.stream + '/' + servers[i].data, { method: 'POST', headers: postHeaders });
        var finalRaw = await _fetchText(MULTI_DECRYPT_API + '/dec-vidup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: streamEnc })
        });
        var stream = (JSON.parse(finalRaw).result) || null;
        if (!stream || !stream.url) continue;
        out.push({
          url: stream.url, quality: '1080p',
          label: '[Vidup ' + (servers[i].name || '') + ']',
          container: /m3u8/i.test(stream.url) ? 'hls' : 'unknown',
          headers: { Referer: API.vidup + '/' }, kind: 'raw'
        });
        (stream.tracks || []).forEach(function (t) {
          if (t.file && t.label && subtitleCb) subtitleCb({ url: t.file, lang: t.label });
        });
      } catch (e) {}
    }
    return out;
  } catch (e) { return []; }
}

// =============================================================================
//  PROVIDER REGISTRY
// =============================================================================
var PROVIDER_REGISTRY = [
  { key: 'p_castle',     name: 'Castle',     run: function (c) { return _invokeCastle(c.title, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_videasy',    name: 'Videasy',    run: function (c) { return _invokeVideasy(c.title, c.tmdbId, c.imdbId, c.year, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidlink',    name: 'Vidlink',    run: function (c) { return _invokeVidlink(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidcore',    name: 'Vidcore',    run: function (c) { return _invokeVidcore(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidup',      name: 'Vidup',      run: function (c) { return _invokeVidup(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidfastpro', name: 'VidFastPro', run: function (c) { return _invokeVidFastPro(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidrock',    name: 'Vidrock',    run: function (c) { return _invokeVidrock(c.tmdbId, c.season, c.episode); } },
  { key: 'p_peachify',   name: 'Peachify',   run: function (c) { return _invokePeachify(c.tmdbId, c.season, c.episode); } },
  { key: 'p_cinejoy',    name: 'Cinejoy',    run: function (c) { return _invokeCinejoy(c.title, c.imdbId, c.tmdbId, c.year, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_meowtv',     name: 'Meowtv',     run: function (c) { return _invokeMeowtv(c.tmdbId, c.season, c.episode); } },
  { key: 'p_moviebox',   name: 'Moviebox',   run: function (c) { return _invokeMoviebox(c.title, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_showbox',    name: 'Showbox',    run: function (c) { return _invokeShowbox(c.imdbId, c.season, c.episode); } },
  { key: 'p_vaplayer',   name: 'VaPlayer',   run: function (c) { return _invokeVaPlayer(c.imdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_fshare',     name: 'Fshare',     run: function (c) { return c.season == null ? _invokeFshare(c.title, c.imdbId) : Promise.resolve([]); } }
];

// =============================================================================
//  ORCHESTRATION
// =============================================================================
async function getVideoSources(episodeUrl, opts) {
  opts = opts || {};
  var parsed = _parseStreamId(episodeUrl);
  if (!parsed.ids.length) {
    console.warn('CineStream2: no ids parsed from episodeUrl:', episodeUrl);
    return [];
  }

  var cfg = _combinedSettings();
  var subs = [];
  var subtitleCb = function (s) { if (s && s.url) subs.push(s); };

  // Prefer the URL over raw fields in case Zangetsu passed the episode object
  var ctx = {
    title: null,
    imdbId: null, tmdbId: null, year: null,
    season: parsed.season, episode: parsed.episode,
    subtitleCb: subtitleCb
  };

  var parsedObj = null;
  if (typeof episodeUrl === 'string' && episodeUrl.charAt(0) === '{') {
    try { parsedObj = JSON.parse(episodeUrl); } catch (e) {}
  } else if (episodeUrl && typeof episodeUrl === 'object') {
    parsedObj = episodeUrl;
  }
  if (parsedObj) {
    ctx.imdbId = parsedObj.imdbId || parsedObj.imdb_id || null;
    ctx.tmdbId = parsedObj.tmdbId || parsedObj.tmdb_id || parsedObj.moviedb_id || null;
  }

  // Enrich from Cinemeta (title, year, tmdbId fallback)
  if (ctx.imdbId) {
    var meta = await _cinemetaMeta(parsed.type === 'series' ? 'series' : 'movie', ctx.imdbId);
    if (meta) {
      ctx.title = meta.name || (meta.aliases && meta.aliases[0]) || null;
      if (!ctx.tmdbId) ctx.tmdbId = meta.moviedb_id || null;
      ctx.year = _year(meta);
    }
  }

  // Dispatch
  var jobs = [];
  for (var p = 0; p < PROVIDER_REGISTRY.length; p++) {
    (function (provider) {
      jobs.push(Promise.resolve(provider.run(ctx)).catch(function (e) {
        console.warn('provider fail', provider.key, String(e));
        return [];
      }));
    })(PROVIDER_REGISTRY[p]);
  }
  cfg.addons.forEach(function (base) {
    jobs.push(_queryAddon(base, parsed, subtitleCb).catch(function () { return []; }));
  });

  if (cfg.wyzieKey && ctx.imdbId) {
    _invokeWyzieSubs(ctx.imdbId, parsed.season, parsed.episode, subtitleCb);
  }

  var lists = await Promise.all(jobs);
  var seen = new Set();
  var out = [];
  lists.forEach(function (list) {
    (list || []).forEach(function (s) {
      if (!s || !s.url || seen.has(s.url)) return;
      seen.add(s.url);
      out.push(s);
    });
  });

  if (typeof opts.onSubtitle === 'function') {
    var subSeen = new Set();
    subs.forEach(function (s) {
      if (!subSeen.has(s.url)) { subSeen.add(s.url); opts.onSubtitle(s); }
    });
  } else if (typeof opts.subtitleCallback === 'function') {
    var subSeen2 = new Set();
    subs.forEach(function (s) {
      if (!subSeen2.has(s.url)) { subSeen2.add(s.url); opts.subtitleCallback(s); }
    });
  }

  console.log('CineStream2: produced', out.length, 'streams for', ctx.title || ctx.imdbId || ctx.tmdbId);
  return out;
}

function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts)   { return getVideoSources(id, opts); }

// =============================================================================
//  EXPORTS
// =============================================================================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.1',
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
    _itemFromCinemeta: _itemFromCinemeta,
    _itemFromTmdb: _itemFromTmdb,
    _parseAddonUrls: _parseAddonUrls,
    _parseStreamId: _parseStreamId,
    _parseDetailUrl: _parseDetailUrl,
    _episodeUrl: _episodeUrl,
    _tmdbUrl: _tmdbUrl,
    _combinedSettings: _combinedSettings,
    _toZangetsuStream: _toZangetsuStream,
    _invokeCastle: _invokeCastle,
    _invokePeachify: _invokePeachify,
    _invokeVidrock: _invokeVidrock,
    _invokeVidcore: _invokeVidcore,
    _invokeVidup: _invokeVidup,
    _invokeMoviebox: _invokeMoviebox,
    _invokeShowbox: _invokeShowbox,
    decryptVidzeeUrl: decryptVidzeeUrl,
    peachifyDecrypt: peachifyDecrypt,
    decryptVidrockUrl: decryptVidrockUrl,
    decryptCastle: decryptCastle,
    hindmoviezSignHShare: hindmoviezSignHShare,
    generateSignedUrl: generateSignedUrl,
    _md5: _md5
  };
}
