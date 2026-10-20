// =============================================================================
//  cinestream2.js — CineStream2 for Zangetsu (QuickJS-NG)
//  v1.0.5 — SETTINGS + META + SHOWBOX FIX
//    • _readSetting: namespaced OR flat __settings
//    • _resolveMeta: per-job timeouts; always returns within budget
//    • Provider timeout applied only to run() (not meta wait)
//    • Showbox: 2 retries, 2s/step, 4.5s cap, verbose step logs
//    • needs[] declarative — skips providers that can never succeed
// =============================================================================

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'cinestream2';

var CINEMETA          = 'https://v3-cinemeta.strem.io';
var KITSU             = 'https://anime-kitsu.strem.fun';
var HAGLUND           = 'https://arm.haglund.dev/api/v2';
var TMDB_API          = 'https://api.themoviedb.org/3';
var TMDB_IMG          = 'https://image.tmdb.org/t/p';
var IMG_PROXY         = 'https://wsrv.nl/?url=';
var AIO_META_PRIMARY  = 'https://aiometadata.elfhosted.com/stremio/9197a4a9-2f5b-4911-845e-8704c520bdf7/meta';
var AIO_META_FALLBACK = 'https://94c8cb9f702d-tmdb-addon.baby-beamup.club/meta';
var MULTI_DECRYPT_API = 'https://enc-dec.app/api';
var WYZIE_SUBS_API    = 'https://sub.wyzie.io';
var PLAYER_UA         = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36';
var SHOWBOX_UA        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

var META_TIMEOUT     = 2500;
var GLOBAL_TIMEOUT   = 7000;

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
  return { name: 'CineStream2', lang: 'en',
    baseUrl: 'https://www.themoviedb.org',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=strem.io',
    type: 'movie', version: '1.0.5' };
}
function getSettings() {
  return [
    { key: 'tmdbApiKey', label: 'TMDB API Key (optional)',
      description: 'Personal TMDB v3 key. Leave blank to use the app default.',
      type: 'text', default: '' },
    { key: 'addonUrls', label: 'Stremio Add-on URLs',
      description: 'Comma / newline separated manifest URLs.',
      type: 'text', default: '' },
    { key: 'wyzieSubsKey', label: 'Wyzie Subs API Key',
      description: 'Optional.', type: 'text', default: '' },
    { key: 'showboxToken', label: 'Showbox (Febbox) UI Token',
      description: 'REQUIRED for Showbox. Cookie "ui" from febbox.com after login.',
      type: 'text', default: '' },
    { key: 'allowDownloadLinks', label: 'Show download-only links',
      description: 'Include sources labelled "Download" and googleusercontent links.',
      type: 'enum', default: 'false',
      options: [{ value: 'false', label: 'Off (recommended)' }, { value: 'true', label: 'On' }] },
    { key: 'maxStreamsPerAddon', label: 'Max streams per add-on',
      description: 'Cap per add-on.',
      type: 'enum', default: '25',
      options: [{ value: '10', label: '10' }, { value: '25', label: '25' },
                { value: '50', label: '50' }, { value: '100', label: '100' }] }
  ];
}

// =============================================================================
//  ★ SETTINGS — namespaced AND flat fallback ★
// =============================================================================
function _readSetting(key) {
  try {
    if (typeof __settings === 'undefined' || !__settings) return null;
    if (__settings[SOURCE_ID] && __settings[SOURCE_ID][key] != null) {
      return __settings[SOURCE_ID][key];
    }
    if (__settings[key] != null) return __settings[key];
    return null;
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
//  TIMEOUT / BYTES / CRYPTO
// =============================================================================
function withTimeout(promise, ms, fallback) {
  var fb = fallback === undefined ? [] : fallback;
  return Promise.race([
    Promise.resolve(promise),
    new Promise(function (resolve) { setTimeout(function () { resolve(fb); }, ms); })
  ]);
}
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
  return Array.from(new Uint8Array(b)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
}
function _b64urlToBytes(s) {
  var v = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (v.length % 4) v += '=';
  return _b64ToBytes(v);
}
function _bytesToB64url(b) { return _bytesToB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
async function _importAesCbc(rawKey) { return await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CBC' }, false, ['decrypt', 'encrypt']); }
async function _importAesGcm(rawKey) { return await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt', 'encrypt']); }
async function _aesCbcDecrypt(rawKey, iv, ct) {
  var k = await _importAesCbc(rawKey);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: iv }, k, ct));
}
async function _aesGcmDecrypt(rawKey, nonce, ct, tagBits) {
  var k = await _importAesGcm(rawKey);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: tagBits || 128 }, k, ct));
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
  function F(x,y,z){return (x&y)|(~x&z)} function G(x,y,z){return (x&z)|(y&~z)}
  function H(x,y,z){return x^y^z} function I(x,y,z){return y^(x|~z)}
  function rotl(x,c){return (x<<c)|(x>>>(32-c))} function add(a,b){return (a+b)>>>0}
  var S=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
         4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  var K=[]; for(var i=0;i<64;i++) K[i]=(Math.abs(Math.sin(i+1))*0x100000000)>>>0;
  var bytes=_strToBytes(str); var bitLen=bytes.length*8;
  var padded=new Uint8Array(((bytes.length+8)>>>6)*64+64);
  padded.set(bytes); padded[bytes.length]=0x80;
  var dv=new DataView(padded.buffer);
  dv.setUint32(padded.length-8,bitLen>>>0,true);
  dv.setUint32(padded.length-4,Math.floor(bitLen/0x100000000),true);
  var a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
  for(var off=0;off<padded.length;off+=64){
    var M=[]; for(var j=0;j<16;j++) M[j]=dv.getUint32(off+j*4,true);
    var A=a0,B=b0,C=c0,D=d0;
    for(var k=0;k<64;k++){
      var Fn,g;
      if(k<16){Fn=F(B,C,D);g=k}
      else if(k<32){Fn=G(B,C,D);g=(5*k+1)%16}
      else if(k<48){Fn=H(B,C,D);g=(3*k+5)%16}
      else{Fn=I(B,C,D);g=(7*k)%16}
      var tmp=D;D=C;C=B;
      B=add(B,rotl(add(add(A,Fn),add(K[k],M[g])),S[k])); A=tmp;
    }
    a0=add(a0,A);b0=add(b0,B);c0=add(c0,C);d0=add(d0,D);
  }
  var out=new DataView(new ArrayBuffer(16));
  out.setUint32(0,a0,true);out.setUint32(4,b0,true);
  out.setUint32(8,c0,true);out.setUint32(12,d0,true);
  return _bytesToHex(out.buffer);
}

// =============================================================================
//  NETWORK
// =============================================================================
function _ensureHeaders(headers) {
  headers = headers || {};
  var hasAccept = false, hasUA = false;
  for (var k in headers) {
    var lk = k.toLowerCase();
    if (lk === 'accept') hasAccept = true;
    if (lk === 'user-agent') hasUA = true;
  }
  if (!hasAccept) headers['Accept'] = 'application/json, text/html, */*';
  if (!hasUA) headers['User-Agent'] = PLAYER_UA;
  return headers;
}
function _fetch(url, opts) {
  opts = opts || {};
  var headers = _ensureHeaders(Object.assign({}, opts.headers || {}));
  return fetch(url, {
    method: opts.method || 'GET',
    headers: headers,
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
  var headers = _ensureHeaders(Object.assign({}, opts.headers || {}));
  return fetch(url, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body,
    timeoutMs: opts.timeoutMs || 8000
  }).then(function (r) {
    var body = r && r.body != null ? r.body : '';
    return typeof body === 'string' ? body : JSON.stringify(body);
  });
}
function _getJson(url, headers, timeoutMs) {
  return _fetch(url, { headers: headers || {}, timeoutMs: timeoutMs || 8000 });
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
  return 'https://api.themoviedb.org./3' + path +
    (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(cfg.tmdbKey);
}
function _tmdbJson(path) {
  var headers = { Accept: 'application/json' };
  if (_combinedSettings().tmdbKey) headers.Host = 'api.themoviedb.org';
  return _fetch(_tmdbPath(path), { headers: headers, timeoutMs: 6000 })
    .catch(function (e) { console.warn('TMDB fail', path, String(e)); return null; });
}
function _tmdbImage(path, size) { return path ? TMDB_IMG + '/' + (size || 'w500') + path : null; }
function _tmdbFind(imdbId) {
  return _tmdbJson('/find/' + imdbId + '?external_source=imdb_id').then(function (json) {
    if (!json) return null;
    if (json.movie_results && json.movie_results.length) return json.movie_results[0].id;
    if (json.tv_results && json.tv_results.length) return json.tv_results[0].id;
    return null;
  }).catch(function () { return null; });
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
//  ★ META RESOLVER — per-job timeouts, always returns within budget ★
// =============================================================================
async function _resolveMeta(imdbId, tmdbId, type) {
  var result = { title: null, year: null, tmdbId: tmdbId || null };
  if (!imdbId && !result.tmdbId) {
    console.log('CineStream2 meta: nothing to resolve');
    return result;
  }
  var start = Date.now();

  var jobs = [];
  if (imdbId) {
    jobs.push(withTimeout(_cinemetaMeta(type === 'tv' ? 'series' : 'movie', imdbId), 1500, null));
    if (!result.tmdbId) {
      jobs.push(withTimeout(_tmdbFind(imdbId), 800, null));
      jobs.push(withTimeout(_externalIds('imdb', imdbId), 800, null));
    }
  }
  var r = await Promise.all(jobs);

  var cmeta   = imdbId ? r[0] : null;
  var findId  = (imdbId && !tmdbId) ? r[1] : null;
  var hag     = (imdbId && !tmdbId) ? r[2] : null;

  if (cmeta) {
    result.title = cmeta.name || (cmeta.aliases && cmeta.aliases[0]) || null;
    result.year  = _year(cmeta);
    if (!result.tmdbId && cmeta.moviedb_id) result.tmdbId = cmeta.moviedb_id;
  }
  if (!result.tmdbId && findId) result.tmdbId = findId;
  if (!result.tmdbId && hag && hag.themoviedb) result.tmdbId = hag.themoviedb;

  if (!result.title && result.tmdbId) {
    var info = await withTimeout(_tmdbJson('/' + type + '/' + result.tmdbId), 800, null);
    if (info) {
      result.title = info.title || info.name || null;
      if (!result.year) result.year = (info.release_date || info.first_air_date || '').slice(0, 4) || null;
    }
  }

  console.log('CineStream2 meta (' + (Date.now() - start) + 'ms): ' + JSON.stringify(result));
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
//  CATALOG
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
    cover: m.poster || null, banner: m.background || null,
    type: 'movie', sourceId: SOURCE_ID, imdbId: m.id, tmdbIsTv: isTv
  };
  if (m.moviedb_id) item.tmdbId = m.moviedb_id;
  if (m.imdbRating != null && isFinite(Number(m.imdbRating))) item.score = Math.round(Number(m.imdbRating) * 10);
  return item;
}
function _itemFromTmdb(rec, forcedType) {
  if (!rec || rec.id == null || rec.media_type === 'person') return null;
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
    type: 'movie', sourceId: SOURCE_ID, tmdbId: rec.id, tmdbIsTv: isTv,
    score: rec.vote_average != null ? Math.round(Number(rec.vote_average) * 10) : undefined
  };
}
function getHome(opts) {
  return Promise.all([
    _fetch(CINEMETA + '/catalog/movie/top.json', { timeoutMs: 6000 }).catch(function () { return null; }),
    _fetch(CINEMETA + '/catalog/series/top.json', { timeoutMs: 6000 }).catch(function () { return null; }),
    _fetch(KITSU + '/catalog/anime/kitsu-anime-trending.json', { timeoutMs: 6000 }).catch(function () { return null; }),
    _tmdbJson('/trending/all/week')
  ]).then(function (rows) {
    var lists = [];
    function addRow(t, l) { if (l && l.length) lists.push({ title: t, items: l }); }
    addRow('Top Movies',       (rows[0] && rows[0].metas || []).map(_itemFromCinemeta).filter(Boolean));
    addRow('Top Series',       (rows[1] && rows[1].metas || []).map(_itemFromCinemeta).filter(Boolean));
    addRow('Trending Anime',   (rows[2] && rows[2].metas || []).map(_itemFromCinemeta).filter(Boolean));
    addRow('Trending on TMDB', (rows[3] && rows[3].results || []).map(function (r) { return _itemFromTmdb(r, null); }).filter(Boolean));
    return lists;
  });
}
function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = []; rows.forEach(function (r) { r.items.forEach(function (i) { out.push(i); }); }); return out;
  });
}
function search(query, page, opts) {
  var q = _trim(query); if (!q) return Promise.resolve([]);
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
      if (seen[k]) return; seen[k] = true; out.push(item);
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
  var s = String(value || ''); if (!s) return null;
  var m = s.match(/^tmdb:\/\/(movie|tv|series)\/([^\/?#]+)/i);
  if (m) {
    var kind = m[1].toLowerCase() === 'movie' ? 'movie' : 'tv';
    var id = decodeURIComponent(m[2]);
    if (/^tt\d+$/.test(id)) return { kind: kind === 'movie' ? 'movie' : 'series', id: id };
    if (/^\d+$/.test(id)) return { kind: 'tmdb', type: kind, id: id };
  }
  m = s.match(/^cinestream:\/\/(movie|series|kitsu)\/(.+)$/i);
  if (m) return { kind: m[1].toLowerCase(), id: decodeURIComponent(m[2]) };
  m = s.match(/^cinestream:\/\/tmdb\/(movie|tv)\/(\d+)/i);
  if (m) return { kind: 'tmdb', type: m[1].toLowerCase(), id: m[2] };
  m = s.match(/^(tt\d+)/); if (m) return { kind: 'movie', id: m[1] };
  return null;
}
function _episodeUrl(type, imdbId, tmdbId, season, episode) {
  var kind = type === 'tv' || type === 'series' ? 'series' : 'movie';
  var payload = {
    id:      imdbId || (tmdbId ? 'tmdb:' + tmdbId : ''),
    videoId: imdbId || (tmdbId ? 'tmdb:' + tmdbId : ''),
    imdbId:  imdbId || undefined,
    tmdbId:  tmdbId || undefined,
    type:    kind,
    season:  season || 0,
    episode: episode || 0
  };
  if (tmdbId) payload.tmdbIsTv = kind === 'series';
  return JSON.stringify(payload);
}
function _statusFromCinemeta(s) {
  var v = String(s || '').toLowerCase();
  if (/returning|production|planned/.test(v)) return 'ongoing';
  if (/ended|released/.test(v)) return 'completed';
  if (/cancel/.test(v)) return 'cancelled';
  return 'unknown';
}
function getDetail(url, opts) {
  var parsed = _parseDetailUrl(url); if (!parsed) return Promise.resolve(null);
  if (parsed.kind === 'movie' || parsed.kind === 'series') {
    var cmType = parsed.kind === 'series' ? 'series' : 'movie';
    return Promise.all([_cinemetaMeta(cmType, parsed.id), _enrichFromAioMetadata(cmType, parsed.id)])
      .then(function (rs) { if (!rs[0]) return null; return _buildFromCinemeta(rs[0], parsed, rs[1], url); });
  }
  if (parsed.kind === 'tmdb') {
    return _tmdbJson('/' + parsed.type + '/' + parsed.id + '?append_to_response=external_ids,credits,videos')
      .then(function (info) { if (!info || info.id == null) return null; return _buildFromTmdb(info, parsed, url); });
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
          return { id: String(v.season) + 'x' + String(v.episode),
            title: 'S' + _pad(v.season) + ' E' + _pad(v.episode) + ' - ' + (v.name || v.title || ''),
            number: v.episode, season: v.season,
            url: _episodeUrl('series', imdbId, tmdbId, v.season, v.episode),
            date: v.firstAired || v.released || null, thumbnail: v.thumbnail || null };
        })
    : [{ id: 'movie', title: title, number: 1, url: _episodeUrl('movie', imdbId, tmdbId, 0, 0) }];

  var result = {
    id: sourceUrl, url: sourceUrl, title: title,
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
      id: sourceUrl, url: sourceUrl, title: title,
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
    (function (seasonNo) { jobs.push(_tmdbJson('/tv/' + parsed.id + '/season/' + seasonNo)); })(s);
  }
  return Promise.all(jobs).then(function (seasonData) {
    seasonData.sort(function (a, b) { return (a && a.season_number || 0) - (b && b.season_number || 0); });
    seasonData.forEach(function (sd) {
      if (!sd || !sd.episodes) return;
      sd.episodes.forEach(function (ep) {
        if (ep.episode_number == null) return;
        episodes.push({ id: String(sd.season_number) + 'x' + String(ep.episode_number),
          title: 'S' + _pad(sd.season_number) + ' E' + _pad(ep.episode_number) + ' - ' + (ep.name || ''),
          number: ep.episode_number, season: sd.season_number,
          url: _episodeUrl('series', imdbId, parsed.id, sd.season_number, ep.episode_number),
          date: ep.air_date || null,
          thumbnail: ep.still_path ? TMDB_IMG + '/w300' + ep.still_path : null });
      });
    });
    return finalize();
  });
}
function _buildFromKitsu(meta, parsed, sourceUrl) {
  var episodes = (meta.videos || []).map(function (v) {
    return { id: String(v.season) + 'x' + String(v.episode),
      title: 'S' + _pad(v.season) + ' E' + _pad(v.episode) + ' - ' + (v.title || ''),
      number: v.episode, season: v.season,
      url: _episodeUrl('series', null, meta.moviedb_id, v.season, v.episode),
      date: v.firstAired || null, thumbnail: v.thumbnail || null };
  });
  return { id: sourceUrl, url: sourceUrl,
    title: (meta.aliases && meta.aliases[0]) || meta.name || 'Untitled',
    cover: meta.poster || null, banner: meta.background || null,
    description: meta.description || '',
    status: _statusFromCinemeta(meta.status),
    genres: meta.genres || meta.genre || [], studios: [], type: 'movie', sourceId: SOURCE_ID,
    year: _year(meta),
    imdbId: null, tmdbId: meta.moviedb_id || null, tmdbIsTv: true,
    episodes: episodes, subCount: episodes.length, dubCount: 0 };
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d && Array.isArray(d.episodes) ? d.episodes : []; });
}

// =============================================================================
//  ADD-ONS
// =============================================================================
function _parseAddonUrls(raw) {
  var parts = String(raw || '').split(/[,;\r\n]+/);
  var out = [], seen = {};
  for (var i = 0; i < parts.length; i++) {
    var v = _trim(parts[i]); if (!v) continue;
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
  var v = String(base || ''); var marker = v.indexOf('::q::');
  if (marker < 0) return { root: v, query: '' };
  return { root: v.substring(0, marker), query: v.substring(marker + 5) };
}
function _manifestUrl(base) { var p = _addonParts(base); return p.root + '/manifest.json' + (p.query ? '?' + p.query : ''); }
function _streamEndpoint(base, type, id) {
  var p = _addonParts(base);
  return p.root + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json' + (p.query ? '?' + p.query : '');
}
function _subtitleEndpoint(base, type, id) {
  var p = _addonParts(base);
  return p.root + '/subtitles/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json' + (p.query ? '?' + p.query : '');
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
    if (type === 'series' && season > 0 && episode > 0) add('tmdb:series:' + String(tmdb) + ':' + season + ':' + episode);
  }
  return { ids: ids, type: type, season: season, episode: episode };
}
function _toZangetsuStream(raw, sourceName, allowDownload) {
  if (!raw || typeof raw !== 'object') return null;
  var url = typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url) ? raw.url : '';
  if (!url) return null;
  if (/video-downloads\.googleusercontent/i.test(url) && !allowDownload) return null;
  if (/Instant Download/i.test(raw.name || '') && !allowDownload) return null;
  var text = String(raw.name || '') + ' ' + String(raw.title || '') + ' ' + String(raw.description || '');
  var qm = text.match(/(2160p|4k|1440p|1080p|720p|480p|360p)/i);
  var quality = qm ? (qm[1].toLowerCase() === '4k' ? '2160p' : qm[1].toLowerCase()) : 'Auto';
  var container = /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : /\.(mp4|m4v|mov|webm)(?:[?#]|$)/i.test(url) ? 'mp4' : 'unknown';
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
  return { url: url, quality: quality, label: labelParts.join(' · ').slice(0, 300),
    container: container, headers: headers, kind: 'raw' };
}
function _magnetFromStream(stream) {
  var ih = stream.infoHash; if (!ih) return null;
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
    var hasStream = !Array.isArray(resources) || resources.some(function (r) { return r === 'stream' || (r && r.name === 'stream'); });
    var jobs = [];
    if (hasStream) {
      parsed.ids.forEach(function (id) {
        jobs.push(_fetch(_streamEndpoint(base, parsed.type, id), { timeoutMs: 6000 }).then(function (data) {
          var streams = data && Array.isArray(data.streams) ? data.streams : [];
          var out = [];
          streams.forEach(function (s) {
            if (s && s.infoHash && !s.url) {
              var mag = _magnetFromStream(s);
              if (mag) out.push({ url: mag, quality: 'Auto',
                label: '[magnet] ' + (s.title || s.name || '').slice(0, 200),
                container: 'magnet', headers: {}, kind: 'magnet' });
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
      var hasSubs = !Array.isArray(resources) || resources.some(function (r) { return r === 'subtitles' || (r && r.name === 'subtitles'); });
      if (hasSubs) {
        jobs.push(_fetch(_subtitleEndpoint(base, parsed.type, parsed.ids[0]), { timeoutMs: 6000 }).then(function (data) {
          var subs = data && Array.isArray(data.subtitles) ? data.subtitles : [];
          subs.forEach(function (s) { if (s && s.url) subtitleCb({ url: s.url, lang: s.lang || s.lang_code || 'Unknown' }); });
          return [];
        }).catch(function () { return []; }));
      }
    }
    return Promise.all(jobs).then(function (lists) {
      var out = []; lists.forEach(function (l) { out = out.concat(l); });
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
    list.forEach(function (s) { if (s && s.url) subtitleCb({ url: s.url, lang: s.display || s.language || 'Unknown' }); });
  }).catch(function (e) { console.warn('wyzie fail', String(e)); });
}

// =============================================================================
//  PROVIDERS
// =============================================================================
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
      out.push({ url: u, quality: 'Auto', label: '[VaPlayer]',
        container: /\.m3u8/i.test(u) ? 'hls' : 'unknown', headers: { Referer: referer }, kind: 'raw' });
    });
    if (subtitleCb && res && res.default_subs) {
      res.default_subs.forEach(function (s) { if (s && s.url) subtitleCb({ url: s.url, lang: s.lang || s.code || 'Unknown' }); });
    }
    return out;
  } catch (e) { console.warn('VaPlayer fail', String(e)); return []; }
}
async function _invokeVidlink(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  try {
    var parsed = JSON.parse(await _getText(MULTI_DECRYPT_API + '/enc-vidlink?text=' + tmdbId, {}, 5000));
    var payload = parsed && parsed.result; if (!payload) return [];
    var headers = { 'User-Agent': PLAYER_UA, Referer: API.vidlink + '/', Origin: API.vidlink };
    var epUrl = season == null ? API.vidlink + '/api/b/movie/' + payload
                               : API.vidlink + '/api/b/tv/' + payload + '/' + season + '/' + episode;
    var stream = JSON.parse(await _getText(epUrl, headers, 5000)).stream;
    if (!stream) return [];
    var out = [];
    Object.keys(stream.qualities || {}).forEach(function (k) {
      var q = stream.qualities[k]; if (!q || !q.url) return;
      out.push({ url: q.url,
        quality: k === '1080' ? '1080p' : k === '720' ? '720p' : k === '480' ? '480p' : k === '360' ? '360p' : 'Auto',
        label: '[VidLink] ' + k,
        container: q.type === 'm3u8' || /\.m3u8/i.test(q.url) ? 'hls' : 'unknown',
        headers: q.headers || {}, kind: 'raw' });
    });
    if (subtitleCb) (stream.captions || []).forEach(function (c) { if (c && c.url && c.language) subtitleCb({ url: c.url, lang: c.language }); });
    return out;
  } catch (e) { console.warn('Vidlink fail', String(e)); return []; }
}
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
      var dec = await decryptVidrockUrl(encUrl); if (!dec) return null;
      return { url: dec, quality: 'Auto', label: '[Vidrock ' + key + ']',
        container: /m3u8/i.test(dec) ? 'hls' : 'unknown', headers: headers, kind: 'raw' };
    }));
    return decrypted.filter(Boolean);
  } catch (e) { console.warn('Vidrock fail', String(e)); return []; }
}
async function _invokePeachify(tmdbId, season, episode) {
  if (!tmdbId) return [];
  var headers = { Origin: API.peachifyBase, Referer: API.peachifyBase + '/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/137.0.0.0' };
  var servers = ['multi', 'hr', 'holly', 'air', 'moviebox'];
  var serverResults = await Promise.all(servers.map(async function (server) {
    try {
      var url = season == null ? API.peachify + '/' + server + '/movie/' + tmdbId
                                : API.peachify + '/' + server + '/tv/' + tmdbId + '/' + season + '/' + episode;
      var encrypt = JSON.parse(await _getText(url, headers, 5000)).data; if (!encrypt) return [];
      var decrypted = await peachifyDecrypt(encrypt); if (!decrypted) return [];
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
            var h = u.searchParams.get('headers'); if (h) realHeaders = JSON.parse(h);
          } catch (e) {}
        }
        out.push({ url: finalUrl,
          quality: src.quality ? src.quality + 'p' : 'Auto',
          label: '[Peachify ' + provider + ']' + (src.dub ? ' · ' + src.dub : ''),
          container: src.type === 'hls' ? 'hls' : 'unknown',
          headers: { Origin: realHeaders.origin || API.peachifyBase,
                     Referer: realHeaders.referer || API.peachifyBase + '/',
                     'User-Agent': realHeaders['user-agent'] || headers['User-Agent'] },
          kind: 'raw' });
      });
      return out;
    } catch (e) { return []; }
  }));
  var out = []; serverResults.forEach(function (r) { out = out.concat(r); }); return out;
}
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
      var r = dec && dec.result; if (!r || !r.url) return [];
      return [{ url: r.url, quality: '1080p',
        label: '[MeowTV ' + server + '] ' + (r.language || ''),
        container: /\.m3u8/i.test(r.url) ? 'hls' : 'unknown', headers: headers, kind: 'raw' }];
    } catch (e) { return []; }
  }));
  var out = []; serverResults.forEach(function (r) { out = out.concat(r); }); return out;
}
async function _invokeVidFastPro(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  var base = API.vidfast;
  var url = season == null ? base + '/movie/' + tmdbId + '/' : base + '/tv/' + tmdbId + '/' + season + '/' + episode + '/';
  var headers = { 'User-Agent': PLAYER_UA, Referer: base + '/' };
  try {
    var html = await _getText(url, headers, 5000);
    var m = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/); if (!m) return [];
    var parsed = JSON.parse(await _getText(MULTI_DECRYPT_API + '/enc-vidfast?text=' + encodeURIComponent(m[1]), {}, 5000));
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
        var streamEnc = await _fetchText(result.stream + '/' + srv.data, { method: 'POST', headers: postHeaders, timeoutMs: 5000 });
        var final = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-vidfast', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: streamEnc }), timeoutMs: 5000
        }));
        var r = final && final.result; if (!r || !r.url) return [];
        if (subtitleCb && r.tracks) r.tracks.forEach(function (t) { if (t.file && t.label) subtitleCb({ url: t.file, lang: t.label }); });
        var is4k = r.is4kAvailable || /4K/i.test(srv.description || '');
        return [{ url: r.url, quality: is4k ? '2160p' : '1080p',
          label: '[VidFastPro ' + (srv.name || '') + ']',
          container: /\.m3u8/i.test(r.url) ? 'hls' : 'unknown', headers: postHeaders, kind: 'raw' }];
      } catch (e) { return []; }
    }));
    var out = []; serverResults.forEach(function (r) { out = out.concat(r); }); return out;
  } catch (e) { console.warn('VidFastPro fail', String(e)); return []; }
}
async function _invokeVidcore(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  var headers = { 'User-Agent': PLAYER_UA, Referer: API.vidcore + '/', 'X-Requested-With': 'XMLHttpRequest' };
  var baseUrl = season == null ? API.vidcore + '/movie/' + tmdbId : API.vidcore + '/tv/' + tmdbId + '/' + season + '/' + episode;
  try {
    var encM = (await _getText(baseUrl, {}, 5000)).match(/\\"(?:en|token)\\":\\"(.*?)\\"/); if (!encM) return [];
    var init = JSON.parse(await _getText(MULTI_DECRYPT_API + '/enc-vidcore?text=' + encodeURIComponent(encM[1]), {}, 5000)).result;
    if (!init) return [];
    headers['X-CSRF-Token'] = init.token;
    var serversEnc = await _fetchText(init.servers, { method: 'POST', headers: headers, timeoutMs: 5000 });
    var serversList = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-vidcore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: serversEnc }), timeoutMs: 5000
    })).result || [];
    var serverResults = await Promise.all(serversList.map(async function (srv) {
      try {
        var streamEnc = await _fetchText(init.stream + '/' + srv.data, { method: 'POST', headers: headers, timeoutMs: 5000 });
        var decStream = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-vidcore', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: streamEnc }), timeoutMs: 5000
        })).result;
        if (!decStream || !decStream.url) return [];
        (decStream.tracks || []).forEach(function (t) { if (t.file && t.label && subtitleCb) subtitleCb({ url: t.file, lang: t.label }); });
        return [{ url: decStream.url, quality: '1080p', label: '[Vidcore ' + srv.name + ']',
          container: /m3u8/i.test(decStream.url) ? 'hls' : 'unknown', headers: headers, kind: 'raw' }];
      } catch (e) { return []; }
    }));
    var out = []; serverResults.forEach(function (r) { out = out.concat(r); }); return out;
  } catch (e) { console.warn('Vidcore fail', String(e)); return []; }
}
async function _invokeVidup(tmdbId, season, episode, subtitleCb) {
  if (!tmdbId) return [];
  var headers = { 'User-Agent': PLAYER_UA, Referer: API.vidup + '/', 'X-Requested-With': 'XMLHttpRequest' };
  var url = season != null ? API.vidup + '/tv/' + tmdbId + '/' + season + '/' + episode : API.vidup + '/movie/' + tmdbId;
  try {
    var encM = (await _getText(url, {}, 5000)).match(/\\"(?:en|token)\\":\\"(.*?)\\"/); if (!encM) return [];
    var parsed = JSON.parse(await _getText(MULTI_DECRYPT_API + '/enc-vidup?text=' + encM[1], headers, 5000));
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
        var streamEnc = await _fetchText(result.stream + '/' + srv.data, { method: 'POST', headers: postHeaders, timeoutMs: 5000 });
        var stream = JSON.parse(await _fetchText(MULTI_DECRYPT_API + '/dec-vidup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: streamEnc }), timeoutMs: 5000
        })).result;
        if (!stream || !stream.url) return [];
        (stream.tracks || []).forEach(function (t) { if (t.file && t.label && subtitleCb) subtitleCb({ url: t.file, lang: t.label }); });
        return [{ url: stream.url, quality: '1080p', label: '[Vidup ' + (srv.name || '') + ']',
          container: /m3u8/i.test(stream.url) ? 'hls' : 'unknown',
          headers: { Referer: API.vidup + '/' }, kind: 'raw' }];
      } catch (e) { return []; }
    }));
    var out = []; serverResults.forEach(function (r) { out = out.concat(r); }); return out;
  } catch (e) { console.warn('Vidup fail', String(e)); return []; }
}
async function _invokeFshare(title, imdbId) {
  if (!title) return [];
  var slug = (title + ' episode 1 ' + (imdbId || '')).toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
  var url = API.fshare + '/w/' + slug;
  try {
    var html = await _getText(url, {}, 5000);
    var tokMatch = html.match(/Movie\.setSource\('([^']+)'/); if (!tokMatch) return [];
    var trailer = (html.match(/id=["']trailer["'][^>]+value=["']([^"']+)["']/i) || [])[1] || '';
    var res = JSON.parse(await _getText(API.fshare + '/api/file/' + tokMatch[1] + '/source?trailer=' + encodeURIComponent(trailer) + '&type=watch', {}, 5000));
    var file = res && res.data && res.data.file; if (!file) return [];
    var sources = (file.sources || []).concat((file.alternatives || []).reduce(function (a, b) { return a.concat(b); }, []));
    var out = [], seen = {};
    sources.forEach(function (s) {
      if (!s || !s.src || seen[s.id]) return;
      seen[s.id] = true;
      out.push({ url: API.fshare + s.src,
        quality: s.quality ? s.quality + 'p' : 'Auto', label: '[Fshare]', container: 'mp4',
        headers: { Referer: url, 'User-Agent': PLAYER_UA }, kind: 'raw' });
    });
    return out;
  } catch (e) { console.warn('Fshare fail', String(e)); return []; }
}
async function _invokeVideasy(title, tmdbId, imdbId, year, season, episode, subtitleCb) {
  if (!title || !tmdbId) return [];
  var servers = ['myflixerzupcloud','downloader2','m4uhd','hdmovie','cdn','superflix','lamovie','jett','tejo','neon2','ym'];
  var encTitle = encodeURIComponent(encodeURIComponent(title));
  var headers = { Accept: '*/*', Referer: 'https://player.videasy.to/', Origin: 'https://player.videasy.to' };
  var seed;
  try { seed = (await _getJson(API.videasy + '/seed?mediaId=' + tmdbId, headers, 5000)).seed; } catch (e) { return []; }
  if (!seed) return [];
  var serverResults = await Promise.all(servers.map(async function (server) {
    try {
      var url = season == null
        ? API.videasy + '/' + server + '/sources-with-title?title=' + encTitle + '&mediaType=movie&year=' + (year || '') + '&tmdbId=' + tmdbId + '&imdbId=' + (imdbId || '') + '&enc=2&seed=' + encodeURIComponent(seed)
        : API.videasy + '/' + server + '/sources-with-title?title=' + encTitle + '&mediaType=tv&year=' + (year || '') + '&tmdbId=' + tmdbId + '&episodeId=' + episode + '&seasonId=' + season + '&imdbId=' + (imdbId || '') + '&enc=2&seed=' + encodeURIComponent(seed);
      var encText = await _getText(url, headers, 5000);
      var result = (await _fetch(MULTI_DECRYPT_API + '/dec-videasy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: encText, id: tmdbId, seed: seed }), timeoutMs: 5000
      })).result;
      if (!result) return [];
      var out = [];
      (result.sources || []).forEach(function (s) {
        if (!s || !s.url) return;
        out.push({ url: s.url, quality: s.quality || 'Auto',
          label: '[Videasy ' + server + '] ' + (s.quality || ''),
          container: /\.m3u8/i.test(s.url) ? 'hls' : /\.(mp4|mkv)/i.test(s.url) ? 'mp4' : 'unknown',
          headers: headers, kind: 'raw' });
      });
      if (subtitleCb) (result.subtitles || []).forEach(function (sub) { if (sub && sub.url) subtitleCb({ url: sub.url, lang: sub.language || 'Unknown' }); });
      return out;
    } catch (e) { return []; }
  }));
  var out = []; serverResults.forEach(function (r) { out = out.concat(r); }); return out;
}
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
        var targetUrl = API.cinejoy + '/?title=' + encodedTitle + '&type=' + type + '&year=' + (year || '') + '&imdb=' + (imdbId || '') + '&tmdb=' + (tmdbId || '') + '&server=' + server + (isSeries ? '&season=' + season + '&episode=' + episode : '');
        var encRes = JSON.parse(await _getText(MULTI_DECRYPT_API + '/enc-cinejoy?url=' + encodeURIComponent(targetUrl), {}, 5000));
        if (!encRes || encRes.status !== 200 || !encRes.result || !encRes.result.data) return [];
        var decoded = _b64urlToBytes(encRes.result.data); if (!decoded) return [];
        var resp = await fetch(API.cinejoy + '/g', { method: 'POST', headers: headers, body: decoded, timeoutMs: 5000 });
        var buf = await Promise.resolve(resp && resp.arrayBuffer ? resp.arrayBuffer() : null); if (!buf) return [];
        var b64 = _bytesToB64url(new Uint8Array(buf));
        var decText = await _fetchText(MULTI_DECRYPT_API + '/dec-cinejoy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: b64, state: encRes.result.state }), timeoutMs: 5000
        });
        var decResult = JSON.parse(decText).result; if (!decResult) return [];
        var data = decResult.data; if (!data || data.error) return [];
        var out = [];
        (data.stream || []).forEach(function (st) {
          if (st.type === 'hls' && st.playlist) {
            out.push({ url: st.playlist, quality: '1080p',
              label: '[Cinejoy ' + server + ']', container: 'hls', headers: headers, kind: 'raw' });
          } else if (st.type === 'file' && st.qualities) {
            Object.keys(st.qualities).forEach(function (qk) {
              var q = st.qualities[qk]; if (!q || !q.url || !/^https:/.test(q.url)) return;
              out.push({ url: q.url,
                quality: qk === '4k' ? '2160p' : qk === '1080' ? '1080p' : qk === '720' ? '720p' : qk === '480' ? '480p' : 'Auto',
                label: '[Cinejoy ' + server + ' ' + qk + ']',
                container: /\.m3u8/i.test(q.url) ? 'hls' : 'unknown', headers: headers, kind: 'raw' });
            });
          }
          if (subtitleCb && st.captions) st.captions.forEach(function (c) { if (c && c.url) subtitleCb({ url: c.url, lang: c.language || c.id || 'Unknown' }); });
        });
        return out;
      } catch (e) { return []; }
    }));
    var out = []; serverResults.forEach(function (r) { out = out.concat(r); }); return out;
  } catch (e) { console.warn('Cinejoy fail', String(e)); return []; }
}

// =============================================================================
//  ★ SHOWBOX — retry + verbose logging + proper timeout ★
// =============================================================================
async function _invokeShowbox(imdbId, season, episode) {
  var token = _readSetting('showboxToken');
  if (!token) {
    console.log('CineStream2 Showbox: SKIP — no showboxToken set');
    return [];
  }
  if (!imdbId) {
    console.log('CineStream2 Showbox: SKIP — no imdbId');
    return [];
  }
  console.log('CineStream2 Showbox: token=' + token.length + 'chars, imdbId=' + imdbId);
  var HDR = {
    Accept: 'application/json, text/html, */*',
    'Accept-Language': 'en',
    'User-Agent': SHOWBOX_UA
  };
  var STEP = 2000;
  try {
    // STEP 1: Search (2 attempts)
    var hrefMatch = null;
    for (var attempt = 1; attempt <= 2 && !hrefMatch; attempt++) {
      try {
        var searchHtml = await _getText(API.showbox + '/search?keyword=' + imdbId, HDR, STEP);
        console.log('CineStream2 Showbox: search attempt ' + attempt + ' got ' + (searchHtml ? searchHtml.length : 0) + ' chars');
        hrefMatch = searchHtml.match(/class="film-name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"/) ||
                    searchHtml.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*film-name[^"]*"/);
      } catch (e) {
        console.log('CineStream2 Showbox: search attempt ' + attempt + ' failed: ' + String(e));
      }
    }
    if (!hrefMatch) {
      console.log('CineStream2 Showbox: no film-name match — search returned nothing');
      return [];
    }
    console.log('CineStream2 Showbox: detail path = ' + hrefMatch[1]);

    // STEP 2: Detail page
    var detailUrl = hrefMatch[1].startsWith('http') ? hrefMatch[1] : API.showbox + hrefMatch[1];
    var detailHtml = await _getText(detailUrl, HDR, STEP);
    var idMatch = detailHtml.match(/class="heading-name[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/);
    if (!idMatch) { console.log('CineStream2 Showbox: no heading-name on detail'); return []; }
    var parts = idMatch[1].split('/');
    var mediaId = parseInt(parts[parts.length - 1], 10);
    if (!mediaId) { console.log('CineStream2 Showbox: mediaId parse failed from ' + idMatch[1]); return []; }
    console.log('CineStream2 Showbox: mediaId = ' + mediaId);

    // STEP 3: Share key
    var type = season != null ? 2 : 1;
    var shareJson = await _getJson(API.showbox + '/index/share_link?id=' + mediaId + '&type=' + type, HDR, STEP);
    var shareLink = shareJson && shareJson.data && shareJson.data.link;
    if (!shareLink) { console.log('CineStream2 Showbox: no share_link: ' + JSON.stringify(shareJson).slice(0, 200)); return []; }
    var shareKey = shareLink.split('/').pop();
    console.log('CineStream2 Showbox: shareKey = ' + shareKey);

    // STEP 4: File list
    var listJson = await _getJson(API.febbox + '/file/file_share_list?share_key=' + shareKey, HDR, STEP);
    var fileData = listJson && listJson.data;
    if (!fileData || !fileData.file_list) {
      console.log('CineStream2 Showbox: file_share_list empty: ' + JSON.stringify(listJson).slice(0, 200));
      return [];
    }
    console.log('CineStream2 Showbox: file_list count = ' + fileData.file_list.length);

    // STEP 5: Find video file
    var videoFile;
    if (season != null && episode != null) {
      var folder = fileData.file_list.find(function (f) {
        return f.is_dir && ((f.file_name || '').toLowerCase().indexOf('season ' + season) >= 0 ||
                            (f.file_name || '').toLowerCase().indexOf('s' + String(season).padStart(2, '0')) >= 0);
      }) || fileData.file_list.find(function (f) { return f.is_dir; });
      if (!folder) { console.log('CineStream2 Showbox: no season folder'); return []; }
      var epJson = await _getJson(API.febbox + '/file/file_share_list?share_key=' + shareKey + '&parent_id=' + folder.fid, HDR, STEP);
      var epList = (epJson && epJson.data && epJson.data.file_list) || [];
      var pad = String(episode).padStart(2, '0');
      videoFile = epList.find(function (f) {
        if (f.is_dir) return false;
        var name = (f.file_name || '').toLowerCase();
        return name.indexOf('e' + pad) >= 0 || name.indexOf('ep' + pad) >= 0 || name.indexOf('episode ' + episode) >= 0;
      });
    } else {
      videoFile = fileData.file_list.find(function (f) { return !f.is_dir; });
    }
    if (!videoFile) { console.log('CineStream2 Showbox: no video file found'); return []; }
    console.log('CineStream2 Showbox: videoFile fid = ' + videoFile.fid);

    // STEP 6: Quality list
    var cookieToken = token.startsWith('ui=') ? token : 'ui=' + token;
    var qualJson = await _getJson(API.febbox + '/console/video_quality_list?fid=' + videoFile.fid + '&share_key=' + shareKey,
      Object.assign({}, HDR, { Cookie: cookieToken }), STEP);
    var qualHtml = qualJson && qualJson.html;
    if (!qualHtml) {
      console.log('CineStream2 Showbox: quality list empty — TOKEN LIKELY INVALID. Response: ' + JSON.stringify(qualJson).slice(0, 300));
      return [];
    }

    var VIDEO_HEADERS = {
      Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.8',
      Connection: 'keep-alive', Range: 'bytes=0-',
      Referer: API.febbox + '/',
      'User-Agent': SHOWBOX_UA
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
      out.push({ url: u.replace(/\\\//g, '/'),
        quality: isOrg ? '2160p' : (q.match(/\d{3,4}/) || ['Auto'])[0] + 'p',
        label: '[ShowBox' + (isOrg ? ' ORG' : '') + ']',
        container: /\.m3u8/.test(u) ? 'hls' : 'unknown',
        headers: VIDEO_HEADERS, kind: 'raw' });
    }
    console.log('CineStream2 Showbox: extracted ' + out.length + ' qualities');
    return out;
  } catch (e) {
    console.log('CineStream2 Showbox: EXCEPTION ' + String(e));
    return [];
  }
}

// =============================================================================
//  ★ REGISTRY — needs[] declares required ctx fields ★
// =============================================================================
var PROVIDER_REGISTRY = [
  { key: 'p_vaplayer',   name: 'VaPlayer',   needs: ['imdb'],        timeoutMs: 1500,
    run: function (c) { return _invokeVaPlayer(c.imdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_showbox',    name: 'Showbox',    needs: ['imdb'],        timeoutMs: 4500,
    run: function (c) { return _invokeShowbox(c.imdbId, c.season, c.episode); } },
  { key: 'p_vidlink',    name: 'Vidlink',    needs: ['tmdb'],        timeoutMs: 2500,
    run: function (c) { return _invokeVidlink(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidrock',    name: 'Vidrock',    needs: ['tmdb'],        timeoutMs: 2500,
    run: function (c) { return _invokeVidrock(c.tmdbId, c.season, c.episode); } },
  { key: 'p_peachify',   name: 'Peachify',   needs: ['tmdb'],        timeoutMs: 2500,
    run: function (c) { return _invokePeachify(c.tmdbId, c.season, c.episode); } },
  { key: 'p_meowtv',     name: 'Meowtv',     needs: ['tmdb'],        timeoutMs: 2500,
    run: function (c) { return _invokeMeowtv(c.tmdbId, c.season, c.episode); } },
  { key: 'p_vidfastpro', name: 'VidFastPro', needs: ['tmdb'],        timeoutMs: 3000,
    run: function (c) { return _invokeVidFastPro(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidcore',    name: 'Vidcore',    needs: ['tmdb'],        timeoutMs: 3000,
    run: function (c) { return _invokeVidcore(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_vidup',      name: 'Vidup',      needs: ['tmdb'],        timeoutMs: 3000,
    run: function (c) { return _invokeVidup(c.tmdbId, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_fshare',     name: 'Fshare',     needs: ['title'],       timeoutMs: 2500,
    run: function (c) { return c.season == null ? _invokeFshare(c.title, c.imdbId) : Promise.resolve([]); } },
  { key: 'p_videasy',    name: 'Videasy',    needs: ['title', 'tmdb'], timeoutMs: 3000,
    run: function (c) { return _invokeVideasy(c.title, c.tmdbId, c.imdbId, c.year, c.season, c.episode, c.subtitleCb); } },
  { key: 'p_cinejoy',    name: 'Cinejoy',    needs: ['title'],       timeoutMs: 3000,
    run: function (c) { return _invokeCinejoy(c.title, c.imdbId, c.tmdbId, c.year, c.season, c.episode, c.subtitleCb); } }
];

// =============================================================================
//  ★ ORCHESTRATION — dynamic start + per-provider timeout AFTER meta ★
// =============================================================================
async function getVideoSources(episodeUrl, opts) {
  opts = opts || {};
  var parsed = _parseStreamId(episodeUrl);
  if (!parsed.ids.length) { console.warn('CineStream2: no ids parsed'); return []; }

  var cfg = _combinedSettings();
  var subs = [];
  var subtitleCb = function (s) { if (s && s.url) subs.push(s); };

  var parsedObj = null;
  if (typeof episodeUrl === 'string' && episodeUrl.charAt(0) === '{') {
    try { parsedObj = JSON.parse(episodeUrl); } catch (e) {}
  } else if (episodeUrl && typeof episodeUrl === 'object') parsedObj = episodeUrl;
  var imdbId = (parsedObj && (parsedObj.imdbId || parsedObj.imdb_id)) || null;
  var tmdbId = (parsedObj && (parsedObj.tmdbId || parsedObj.tmdb_id || parsedObj.moviedb_id)) || null;
  if (!imdbId) {
    for (var i = 0; i < parsed.ids.length; i++) {
      if (/^tt\d+/.test(parsed.ids[i])) { imdbId = parsed.ids[i]; break; }
    }
  }

  console.log('CineStream2 BOOT: imdbId=' + imdbId + ' tmdbId=' + tmdbId + ' type=' + parsed.type +
              ' showboxToken=' + (cfg.showboxToken ? 'SET' : 'MISSING') +
              ' addons=' + cfg.addons.length);

  var metaPromise = withTimeout(
    _resolveMeta(imdbId, tmdbId, parsed.type === 'series' ? 'tv' : 'movie'),
    META_TIMEOUT,
    { title: null, year: null, tmdbId: tmdbId || null }
  ).catch(function (e) { console.warn('meta fallback', String(e)); return { title: null, year: null, tmdbId: tmdbId || null }; });

  var ctx = { imdbId: imdbId, tmdbId: tmdbId, title: null, year: null,
              season: parsed.season, episode: parsed.episode, subtitleCb: subtitleCb };

  function canRunNow(provider) {
    var needs = provider.needs || [];
    for (var i = 0; i < needs.length; i++) {
      var n = needs[i];
      if (n === 'imdb' && !ctx.imdbId) return false;
      if (n === 'tmdb' && !ctx.tmdbId) return false;
      if (n === 'title' && !ctx.title) return false;
    }
    return true;
  }

  var jobPromises = [];
  for (var p = 0; p < PROVIDER_REGISTRY.length; p++) {
    (function (provider) {
      var timeoutMs = provider.timeoutMs || 2500;
      var promise;
      var startTime = Date.now();
      if (canRunNow(provider)) {
        console.log('CineStream2: ' + provider.name + ' START NOW');
        promise = withTimeout(Promise.resolve(provider.run(ctx)), timeoutMs, []);
      } else {
        console.log('CineStream2: ' + provider.name + ' WAIT FOR META');
        promise = metaPromise.then(function (meta) {
          if (meta) {
            if (meta.title && !ctx.title) ctx.title = meta.title;
            if (meta.year && !ctx.year) ctx.year = meta.year;
            if (!ctx.tmdbId && meta.tmdbId) ctx.tmdbId = meta.tmdbId;
          }
          if (!canRunNow(provider)) {
            console.log('CineStream2: ' + provider.name + ' SKIP — needs still unmet after meta');
            return [];
          }
          return withTimeout(Promise.resolve(provider.run(ctx)), timeoutMs, []);
        });
      }
      jobPromises.push(
        promise.then(function (result) {
          var n = result ? result.length : 0;
          console.log('CineStream2: ' + provider.name + ' → ' + n + ' streams (' + (Date.now() - startTime) + 'ms)');
          return result || [];
        }).catch(function (e) {
          console.log('CineStream2: ' + provider.name + ' THREW ' + String(e));
          return [];
        })
      );
    })(PROVIDER_REGISTRY[p]);
  }

  cfg.addons.forEach(function (base) {
    jobPromises.push(
      withTimeout(_queryAddon(base, parsed, subtitleCb), 2200).catch(function () { return []; })
    );
  });

  if (cfg.wyzieKey && imdbId) _invokeWyzieSubs(imdbId, parsed.season, parsed.episode, subtitleCb);

  var lists = await Promise.all(jobPromises);

  var seen = new Set(), out = [];
  for (var l = 0; l < lists.length; l++) {
    var list = lists[l] || [];
    for (var s = 0; s < list.length; s++) {
      var stream = list[s];
      if (stream && stream.url && !seen.has(stream.url)) { seen.add(stream.url); out.push(stream); }
    }
  }

  var cb = opts.onSubtitle || opts.subtitleCallback;
  if (typeof cb === 'function') {
    var subSeen = new Set();
    subs.forEach(function (s) { if (!subSeen.has(s.url)) { subSeen.add(s.url); cb(s); } });
  }

  console.log('CineStream2 DONE: ' + out.length + ' streams | title=' + (ctx.title || '?') +
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
    version: '1.0.5',
    getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    withTimeout: withTimeout,
    _readSetting: _readSetting, _combinedSettings: _combinedSettings,
    _resolveMeta: _resolveMeta, _tmdbFind: _tmdbFind,
    _itemFromCinemeta: _itemFromCinemeta, _itemFromTmdb: _itemFromTmdb,
    _parseAddonUrls: _parseAddonUrls, _parseStreamId: _parseStreamId,
    _parseDetailUrl: _parseDetailUrl, _episodeUrl: _episodeUrl, _tmdbUrl: _tmdbUrl,
    _toZangetsuStream: _toZangetsuStream,
    _fetch: _fetch, _fetchText: _fetchText, _getText: _getText,
    _invokeVaPlayer: _invokeVaPlayer, _invokeShowbox: _invokeShowbox,
    _invokeVidlink: _invokeVidlink, _invokeVidrock: _invokeVidrock,
    _invokePeachify: _invokePeachify, _invokeMeowtv: _invokeMeowtv,
    _invokeVidFastPro: _invokeVidFastPro, _invokeVidcore: _invokeVidcore,
    _invokeVidup: _invokeVidup, _invokeFshare: _invokeFshare,
    _invokeVideasy: _invokeVideasy, _invokeCinejoy: _invokeCinejoy,
    peachifyDecrypt: peachifyDecrypt, decryptVidrockUrl: decryptVidrockUrl, _md5: _md5
  };
}
