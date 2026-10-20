// cinestream2.js — CineStream2 for Zangetsu v2.3.0
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'cinestream2';

// ── Polyfills ────────────────────────────────────────────────
var _b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
var _btoa = (typeof btoa !== 'undefined') ? btoa : function(input) {
  var str = String(input), output = '';
  for (var block, charCode, idx = 0, map = _b64chars; str.charAt(idx | 0) || (map = '=', idx % 1); output += map.charAt(63 & block >> 8 - idx % 1 * 8)) {
    charCode = str.charCodeAt(idx += 3 / 4);
    if (charCode > 0xFF) throw new Error("btoa failed");
    block = block << 8 | charCode;
  }
  return output;
};
var _atob = (typeof atob !== 'undefined') ? atob : function(input) {
  var str = String(input).replace(/=+$/, '');
  if (str.length % 4 == 1) throw new Error("atob failed");
  for (var bc = 0, bs, buffer, idx = 0, output = ''; buffer = str.charAt(idx++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
    buffer = _b64chars.indexOf(buffer);
  }
  return output;
};

// ── Endpoints ────────────────────────────────────────────────
var CINEMETA = "https://v3-cinemeta.strem.io";
var KITSU_API = "https://anime-kitsu.strem.fun";
var HAGLUND_API = "https://arm.haglund.dev/api/v2";
var TMDB_API = "https://api.themoviedb.org/3";
var TMDB_FALLBACK_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
var TMDB_IMG = "https://image.tmdb.org/t/p";
var VA_PLAYER = "https://streamdata.vaplayer.ru";
var VIDROCK = "https://vidrock.to";
var VIDZEE = "https://player.vidzee.wtf";
var MULTI_DECRYPT = "https://enc-dec.app/api";
var SHOWBOX = "https://showbox.media";
var FEBBOX = "https://www.febbox.com";
var VIDFAST = "https://vidfast.vc";
var HEXA = "https://theemoviedb.hexa.su";
var ANIKOTO_SITE = 'https://anikototv.to';
var ANIKOTO_API = 'https://anikotoapi.site';
var ANIKOTO_MAPPER = 'https://mapper.nekostream.site/api/mal/';
var ANIKOTO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
var RA_SITE = 'https://www.rareanimes.mov';
var RA_SB = 'https://codedew.com/streambeta/';
var RA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
var RA_FAMILY_RE = /(^|\.)(codedew\.com|hubcloud\.[a-z]+|dlbeta\.[a-z]+|streambeta\.[a-z]+)$/i;
var RA_REL_PATH_RE = /streambeta|zipper|multiquality|hubcloud|dlbeta|filepress/i;
var RA_REL_LABEL_RE = /watch\s*now|stream|play|hubcloud|multiquality|download/i;
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// ── Info / Settings ──────────────────────────────────────────
function getInfo() {
  return { name: 'CineStream2', lang: 'en', baseUrl: 'https://www.themoviedb.org',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=strem.io', type: 'movie', version: '2.3.0' };
}
function getSettings() {
  return [
    { key: 'tmdbApiKey', label: 'TMDB API Key (optional)', description: 'Built-in public key used when empty.', type: 'text', default: '' },
    { key: 'showboxToken', label: 'Showbox (Febbox) UI Token', description: 'Required for Showbox.', type: 'text', default: '' },
    { key: 'enableVaPlayer', label: 'Enable VaPlayer', type: 'bool', default: true },
    { key: 'enableVidrock', label: 'Enable Vidrock', type: 'bool', default: true },
    { key: 'enableVidzee', label: 'Enable Vidzee', type: 'bool', default: true },
    { key: 'enableShowbox', label: 'Enable Showbox', type: 'bool', default: false },
    { key: 'enableVidfast', label: 'Enable Vidfast', type: 'bool', default: true },
    { key: 'enableHexa', label: 'Enable Hexa', type: 'bool', default: true },
    { key: 'enableAnikoto', label: 'Enable Anikoto', type: 'bool', default: true },
    { key: 'enableRareAnimes', label: 'Enable RareAnimes', type: 'bool', default: true },
    { key: 'debug', label: 'Debug logging', type: 'bool', default: false }
  ];
}

// ── Utilities ────────────────────────────────────────────────
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
function withTimeout(promise, ms, fallback, label) {
  var settled = false;
  return Promise.race([
    Promise.resolve(promise).then(function (v) { settled = true; return v; }, function (e) { settled = true; throw e; }),
    new Promise(function (resolve) {
      setTimeout(function () {
        if (!settled) {
          if (label) console.log("CineStream2: " + label + " timed out (" + ms + "ms)");
          resolve(fallback === undefined ? [] : fallback);
        }
      }, ms);
    })
  ]);
}
function fixUrl(url, base) {
  if (!url) return "";
  url = String(url).trim();
  if (/^https?:\/\//.test(url)) return url;
  if (url.indexOf("//") === 0) return "https:" + url;
  if (base) {
    if (url.charAt(0) === '/') {
      var d = base.split("/");
      if (d.length > 2) return d[0] + "//" + d[2] + url;
    }
    return base + (base.endsWith("/") ? "" : "/") + url;
  }
  return "https://" + url;
}
async function fetchText(url, opts) {
  opts = opts || {};
  var h = Object.assign({ "User-Agent": USER_AGENT }, opts.headers || {});
  try {
    var r = await fetch(url, { method: opts.method || "GET", headers: h, body: opts.body, timeoutMs: opts.timeoutMs || 7000 });
    if (!r) throw new Error("Empty");
    var t = r.body;
    return typeof t !== "string" ? JSON.stringify(t) : t;
  } catch (e) { return ""; }
}
async function fetchJson(url, opts) {
  var t = await fetchText(url, opts);
  try { return JSON.parse(t); } catch (e) { return null; }
}
function base64ToBytes(b64) {
  try {
    var s = _atob(b64), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  } catch (e) { return new Uint8Array(0); }
}
function base64UrlToBytes(s) {
  var v = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (v.length % 4) v += '=';
  return base64ToBytes(v);
}
function bytesToBase64Url(b) {
  var s = '';
  for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return _btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function slugify(t) {
  if (!t) return "";
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function htmlText(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

// ── Pure-JS AES ──────────────────────────────────────────────
function _arr(x) { var a = []; for (var i = 0; i < x.length; i++) a.push(x[i] & 0xff); return a; }
var _SBOX = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
var _ISBOX = [0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];
function _xtime(a) { a <<= 1; if (a & 0x100) a ^= 0x11b; return a & 0xff; }
function _gmul(a, b) { var p = 0; for (var i = 0; i < 8; i++) { if (b & 1) p ^= a; var hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1; } return p & 0xff; }
function _keyExp(key) {
  var Nk = key.length / 4, Nr = Nk + 6, w = [], i;
  for (i = 0; i < Nk; i++) w.push([key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]]);
  var rcon = 1;
  for (i = Nk; i < 4 * (Nr + 1); i++) {
    var t = w[i-1].slice();
    if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]]; t = [_SBOX[t[0]], _SBOX[t[1]], _SBOX[t[2]], _SBOX[t[3]]]; t[0] ^= rcon; rcon = _xtime(rcon); }
    else if (Nk > 6 && i % Nk === 4) { t = [_SBOX[t[0]], _SBOX[t[1]], _SBOX[t[2]], _SBOX[t[3]]]; }
    w.push([w[i-Nk][0]^t[0], w[i-Nk][1]^t[1], w[i-Nk][2]^t[2], w[i-Nk][3]^t[3]]);
  }
  return { w: w, Nr: Nr };
}
function _invCipher(inb, ks) {
  var w = ks.w, Nr = ks.Nr, s = [[],[],[],[]], r, c, i;
  for (i = 0; i < 16; i++) s[i%4][(i/4)|0] = inb[i];
  function ark(round) { for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) s[r][c] ^= w[round*4+c][r]; }
  function isub() { for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) s[r][c] = _ISBOX[s[r][c]]; }
  function ishift() { for (r = 1; r < 4; r++) { var row = s[r].slice(); for (c = 0; c < 4; c++) s[r][c] = row[(c-r+4)%4]; } }
  function imix() { for (c = 0; c < 4; c++) { var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
    s[0][c]=_gmul(a0,14)^_gmul(a1,11)^_gmul(a2,13)^_gmul(a3,9);
    s[1][c]=_gmul(a0,9)^_gmul(a1,14)^_gmul(a2,11)^_gmul(a3,13);
    s[2][c]=_gmul(a0,13)^_gmul(a1,9)^_gmul(a2,14)^_gmul(a3,11);
    s[3][c]=_gmul(a0,11)^_gmul(a1,13)^_gmul(a2,9)^_gmul(a3,14); } }
  ark(Nr);
  for (var round = Nr-1; round >= 1; round--) { ishift(); isub(); ark(round); imix(); }
  ishift(); isub(); ark(0);
  var out = []; for (i = 0; i < 16; i++) out[i] = s[i%4][(i/4)|0]; return out;
}
function _aesCbcDecrypt(ct, key, iv) {
  var ks = _keyExp(key), out = [], prev = iv.slice(), off, i;
  for (off = 0; off + 16 <= ct.length; off += 16) {
    var block = ct.slice(off, off + 16), dec = _invCipher(block, ks);
    for (i = 0; i < 16; i++) out.push(dec[i] ^ prev[i]);
    prev = block;
  }
  var pad = out[out.length - 1];
  if (pad > 0 && pad <= 16) out = out.slice(0, out.length - pad);
  return out;
}
function _padBytes(s, n) {
  var out = [], i;
  for (i = 0; i < n; i++) out[i] = 0;
  var b = String(s || '');
  for (i = 0; i < b.length && i < n; i++) out[i] = b.charCodeAt(i) & 0xff;
  return out;
}
function _bytesToStr(b) {
  var s = '', i = 0;
  while (i < b.length) {
    var c = b[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xE0) s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else if (c < 0xF0) s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
    else { var cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f); cp -= 0x10000; s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
  }
  return s;
}
function _cipher(inb, ks) {
  var w = ks.w, Nr = ks.Nr, s = [[],[],[],[]], r, c, i;
  for (i = 0; i < 16; i++) s[i%4][(i/4)|0] = inb[i];
  function ark(round) { for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) s[r][c] ^= w[round*4+c][r]; }
  function sub() { for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) s[r][c] = _SBOX[s[r][c]]; }
  function shift() { for (r = 1; r < 4; r++) { var row = s[r].slice(); for (c = 0; c < 4; c++) s[r][c] = row[(c+r)%4]; } }
  function mix() { for (c = 0; c < 4; c++) { var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
    s[0][c]=_gmul(a0,2)^_gmul(a1,3)^a2^a3;
    s[1][c]=a0^_gmul(a1,2)^_gmul(a2,3)^a3;
    s[2][c]=a0^a1^_gmul(a2,2)^_gmul(a3,3);
    s[3][c]=_gmul(a0,3)^a1^a2^_gmul(a3,2); } }
  ark(0);
  for (var round = 1; round < Nr; round++) { sub(); shift(); mix(); ark(round); }
  sub(); shift(); ark(Nr);
  var out = []; for (i = 0; i < 16; i++) out[i] = s[i%4][(i/4)|0]; return out;
}
function _gmul128(x, y) {
  var z = [], v = y.slice(), i, j, k;
  for (i = 0; i < 16; i++) z.push(0);
  for (i = 0; i < 16; i++) for (j = 7; j >= 0; j--) {
    if ((x[i] >> j) & 1) for (k = 0; k < 16; k++) z[k] ^= v[k];
    var lsb = v[15] & 1;
    for (k = 15; k > 0; k--) v[k] = ((v[k] >>> 1) | ((v[k-1] & 1) << 7)) & 0xff;
    v[0] = (v[0] >>> 1) & 0x7f;
    if (lsb) v[0] ^= 0xe1;
  }
  return z;
}
function _ghash(h, data) {
  var y = [], i, off;
  for (i = 0; i < 16; i++) y.push(0);
  for (off = 0; off + 16 <= data.length; off += 16) {
    for (i = 0; i < 16; i++) y[i] ^= data[off+i];
    y = _gmul128(y, h);
  }
  return y;
}
function _aesGcmDecrypt(data, key) {
  if (!data || data.length < 28) return null;
  var ks = _keyExp(key), i, off;
  var nonce = data.slice(0, 12), tag = data.slice(data.length - 16), ct = data.slice(12, data.length - 16);
  var H = _cipher([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], ks);
  var J0 = nonce.concat([0, 0, 0, 1]);
  var gdata = ct.slice();
  while (gdata.length % 16) gdata.push(0);
  var bitLen = ct.length * 8;
  gdata = gdata.concat([0,0,0,0,0,0,0,0,0,0,0,0,(bitLen>>>24)&0xff,(bitLen>>>16)&0xff,(bitLen>>>8)&0xff,bitLen&0xff]);
  var S = _ghash(H, gdata);
  var EJ0 = _cipher(J0, ks);
  for (i = 0; i < 16; i++) if ((S[i] ^ EJ0[i]) !== tag[i]) return null;
  var out = [], ctr = J0.slice();
  for (off = 0; off < ct.length; off += 16) {
    var n = ((ctr[12] << 24) | (ctr[13] << 16) | (ctr[14] << 8) | ctr[15]) + 1;
    ctr[12] = (n >>> 24) & 0xff; ctr[13] = (n >>> 16) & 0xff; ctr[14] = (n >>> 8) & 0xff; ctr[15] = n & 0xff;
    var stream = _cipher(ctr, ks), take = Math.min(16, ct.length - off);
    for (var j = 0; j < take; j++) out.push(ct[off+j] ^ stream[j]);
  }
  return out;
}
function decryptVidzeeUrl(enc, secret) {
  try {
    var d = _atob(enc), p = d.split(":");
    if (p.length < 2) return null;
    var iv = _arr(base64ToBytes(p[0])), ct = _arr(base64ToBytes(p[1]));
    if (!ct.length) return null;
    return _bytesToStr(_aesCbcDecrypt(ct, _padBytes(secret, 32), iv));
  } catch (e) { return null; }
}
function decryptVidrockUrl(payload) {
  try {
    var kHex = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f", kb = [];
    for (var i = 0; i + 1 < kHex.length; i += 2) kb.push(parseInt(kHex.substr(i, 2), 16));
    var b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var pt = _aesGcmDecrypt(_arr(base64ToBytes(b64)), kb);
    return pt ? _bytesToStr(pt) : null;
  } catch (e) { return null; }
}

// ── Catalog & Detail ────────────────────────────────────────
function _year(r) { return String(r.release_date || r.first_air_date || r.releaseInfo || r.year || '').slice(0, 4) || null; }
function _itemFromKitsu(m) {
  if (!m || !m.id) return null;
  var url = 'tmdb://anime/' + m.id.replace("kitsu:", "kitsu-");
  var t = (m.aliases && m.aliases.length && m.aliases[0]) || m.name || '';
  if (!t) return null;
  return { id: url, url: url, title: t, cover: m.poster || null, banner: m.background || null, type: 'movie', sourceId: SOURCE_ID, kitsuId: m.id.replace("kitsu:", "") };
}
function _itemFromCinemeta(m) {
  if (!m || !m.id) return null;
  var isTv = m.type === 'series', url = 'tmdb://' + (isTv ? 'tv' : 'movie') + '/' + m.id;
  var t = (m.aliases && m.aliases.length && m.aliases[0]) || m.name || '';
  if (!t) return null;
  var it = { id: url, url: url, title: _year(m) ? t + ' (' + _year(m) + ')' : t, cover: m.poster || null, banner: m.background || null, type: 'movie', sourceId: SOURCE_ID, imdbId: m.id, tmdbIsTv: isTv };
  if (m.moviedb_id) it.tmdbId = m.moviedb_id;
  if (m.imdbRating) it.score = Math.round(Number(m.imdbRating) * 10);
  return it;
}
async function getHome(opts) {
  var rows = await Promise.all([
    fetchText(CINEMETA + "/catalog/movie/top.json"),
    fetchText(CINEMETA + "/catalog/series/top.json"),
    fetchText(KITSU_API + "/catalog/anime/kitsu-anime-trending.json")
  ]);
  var out = [];
  if (rows[0]) { try { var j = JSON.parse(rows[0]); if (j.metas) out.push({ title: 'Top Movies', items: j.metas.map(_itemFromCinemeta).filter(Boolean) }); } catch (e) {} }
  if (rows[1]) { try { var j = JSON.parse(rows[1]); if (j.metas) out.push({ title: 'Top Series', items: j.metas.map(_itemFromCinemeta).filter(Boolean) }); } catch (e) {} }
  if (rows[2]) { try { var j = JSON.parse(rows[2]); if (j.metas) out.push({ title: 'Trending Anime', items: j.metas.map(_itemFromKitsu).filter(Boolean) }); } catch (e) {} }
  return out;
}
async function popular(opts) {
  var rows = await getHome(opts), out = [];
  rows.forEach(function (r) { r.items.forEach(function (i) { out.push(i); }); });
  return out;
}
async function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return [];
  var rows = await Promise.all([
    fetchText(CINEMETA + '/catalog/movie/top/search=' + encodeURIComponent(q) + '.json'),
    fetchText(CINEMETA + '/catalog/series/top/search=' + encodeURIComponent(q) + '.json'),
    fetchText(KITSU_API + '/catalog/anime/kitsu-anime-trending/search=' + encodeURIComponent(q) + '.json')
  ]);
  var out = [];
  if (rows[0]) { try { var j = JSON.parse(rows[0]); if (j.metas) j.metas.forEach(function (m) { var i = _itemFromCinemeta(m); if (i) out.push(i); }); } catch (e) {} }
  if (rows[1]) { try { var j = JSON.parse(rows[1]); if (j.metas) j.metas.forEach(function (m) { var i = _itemFromCinemeta(m); if (i) out.push(i); }); } catch (e) {} }
  if (rows[2]) { try { var j = JSON.parse(rows[2]); if (j.metas) j.metas.forEach(function (m) { var i = _itemFromKitsu(m); if (i) out.push(i); }); } catch (e) {} }
  return out;
}
function _parseDetailUrl(v) {
  var s = String(v || '');
  if (!s) return null;
  var m = s.match(/^tmdb:\/\/anime\/kitsu-(\d+)/i);
  if (m) return { kind: 'kitsu', id: m[1] };
  m = s.match(/^tmdb:\/\/(movie|tv|series)\/([^\/?#]+)/i);
  if (m) {
    var kind = m[1].toLowerCase() === 'movie' ? 'movie' : 'tv', id = decodeURIComponent(m[2]);
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
  var p = _parseDetailUrl(url);
  if (!p) return null;
  if (p.kind === 'kitsu') {
    var res = await fetchText(KITSU_API + '/meta/series/kitsu%3A' + p.id + '.json');
    if (!res) return null;
    var meta; try { meta = JSON.parse(res).meta; } catch (e) { return null; }
    if (!meta) return null;
    var hg = {}; try { hg = JSON.parse(await fetchText(HAGLUND_API + '/ids?source=kitsu&id=' + p.id)) || {}; } catch (e) {}
    var imdbId = hg.imdb || null, tmdbId = hg.themoviedb || null, anilistId = hg.anilist || null, malId = hg.myanimelist || null;
    var title = (meta.aliases && meta.aliases[0]) || meta.name || 'Untitled';
    var eps = (meta.videos || []).map(function (v) {
      return { id: String(v.season) + 'x' + String(v.episode), title: 'S' + String(v.season).padStart(2, '0') + 'E' + String(v.episode).padStart(2, '0') + ' - ' + (v.title || ''), number: v.episode, season: v.season, url: _episodeUrl(imdbId, tmdbId, v.season, v.episode, p.id, anilistId, malId), date: v.firstAired || null, thumbnail: v.thumbnail || null };
    });
    return { id: url, url: url, title: title, cover: meta.poster || null, banner: meta.background || null, description: meta.description || '', status: 'unknown', genres: meta.genres || [], studios: [], type: 'movie', sourceId: SOURCE_ID, year: _year(meta), imdbId: imdbId, tmdbId: tmdbId, kitsuId: p.id, anilistId: anilistId, malId: malId, tmdbIsTv: true, episodes: eps, subCount: eps.length, dubCount: 0 };
  }
  if (p.kind === 'movie' || p.kind === 'series') {
    var res = await fetchText(CINEMETA + '/meta/' + (p.kind === 'series' ? 'series' : 'movie') + '/' + p.id + '.json');
    if (!res) return null;
    var meta; try { meta = JSON.parse(res).meta; } catch (e) { return null; }
    if (!meta) return null;
    var isTv = p.kind === 'series', title = (meta.aliases && meta.aliases[0]) || meta.name || 'Untitled', imdbId = meta.imdb_id || p.id, tmdbId = meta.moviedb_id || null;
    var eps = isTv ? (meta.videos || []).filter(function (v) { return v.season !== 0; }).sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); }).map(function (v) {
      return { id: String(v.season) + 'x' + String(v.episode), title: 'S' + String(v.season).padStart(2, '0') + 'E' + String(v.episode).padStart(2, '0') + ' - ' + (v.name || ''), number: v.episode, season: v.season, url: _episodeUrl(imdbId, tmdbId, v.season, v.episode), date: v.firstAired || null, thumbnail: v.thumbnail || null };
    }) : [{ id: 'movie', title: title, number: 1, url: _episodeUrl(imdbId, tmdbId, 0, 0) }];
    return { id: url, url: url, title: title, cover: meta.poster || null, banner: meta.background || null, description: meta.description || '', status: 'unknown', genres: meta.genre || [], studios: [], type: 'movie', sourceId: SOURCE_ID, year: _year(meta), imdbId: imdbId, tmdbId: tmdbId, tmdbIsTv: isTv, episodes: eps, subCount: eps.length, dubCount: 0 };
  }
  if (p.kind === 'tmdb') {
    var key = _readSetting('tmdbApiKey') || TMDB_FALLBACK_KEY;
    var info = await fetchJson(TMDB_API + '/' + p.type + '/' + p.id + '?api_key=' + key + '&append_to_response=external_ids');
    if (!info || info.status_code) return null;
    var isTv = p.type === 'tv', title = info.title || info.name || 'Untitled', imdbId = info.external_ids ? info.external_ids.imdb_id : null;
    var eps = [];
    if (isTv && info.seasons) {
      for (var i = 0; i < info.seasons.length; i++) {
        var s = info.seasons[i]; if (s.season_number === 0) continue;
        var epData = await fetchJson(TMDB_API + '/tv/' + p.id + '/season/' + s.season_number + '?api_key=' + key);
        if (epData && epData.episodes) epData.episodes.forEach(function (ep) {
          eps.push({ id: String(ep.season_number) + 'x' + String(ep.episode_number), title: 'S' + String(ep.season_number).padStart(2, '0') + 'E' + String(ep.episode_number).padStart(2, '0') + ' - ' + (ep.name || ''), number: ep.episode_number, season: ep.season_number, url: _episodeUrl(imdbId, p.id, ep.season_number, ep.episode_number), date: ep.air_date || null, thumbnail: ep.still_path ? TMDB_IMG + '/w300' + ep.still_path : null });
        });
      }
    } else if (!isTv) {
      eps = [{ id: 'movie', title: title, number: 1, url: _episodeUrl(imdbId, p.id, 0, 0) }];
    }
    return { id: url, url: url, title: title, cover: info.poster_path ? TMDB_IMG + '/w500' + info.poster_path : null, banner: info.backdrop_path ? TMDB_IMG + '/w780' + info.backdrop_path : null, description: info.overview || '', status: 'unknown', genres: (info.genres || []).map(function (g) { return g.name; }), studios: [], type: 'movie', sourceId: SOURCE_ID, year: (info.release_date || info.first_air_date || '').slice(0, 4) || null, imdbId: imdbId, tmdbId: p.id, tmdbIsTv: isTv, episodes: eps, subCount: eps.length, dubCount: 0 };
  }
  return null;
}
function getEpisodes(url, opts) { return getDetail(url, opts).then(function (d) { return d && d.episodes ? d.episodes : []; }); }
function _parseStreamId(raw) {
  var item = raw && typeof raw === 'object' ? raw : null;
  if (!item) {
    var s = String(raw || '');
    if (s.charAt(0) === '{') { try { item = JSON.parse(s); } catch (e) {} }
    if (!item) item = { id: s };
  }
  var imdb = String(item.imdbId || item.imdb_id || ''), tmdb = item.tmdbId || item.tmdb_id || item.moviedb_id || null, kitsu = item.kitsuId || null, anilist = item.anilistId || null, mal = item.malId || null;
  var type = item.type === 'tv' || item.type === 'series' ? 'series' : 'movie';
  var season = parseInt(item.season, 10); if (isNaN(season) || season <= 0) season = null;
  var episode = parseInt(item.episode, 10) || 0;
  return { type: type, season: season, episode: episode, imdbId: imdb || null, tmdbId: tmdb || null, kitsuId: kitsu, anilistId: anilist, malId: mal };
}
async function _resolveMeta(p) {
  var meta = { title: null, year: null, imdbId: p.imdbId, tmdbId: p.tmdbId };
  if (meta.imdbId) {
    try {
      var data = await fetchJson(CINEMETA + "/meta/" + (p.type === "series" ? "series" : "movie") + "/" + meta.imdbId + ".json");
      if (data && data.meta) {
        meta.title = data.meta.name || (data.meta.aliases && data.meta.aliases[0]);
        meta.year = parseInt(data.meta.releaseInfo || data.meta.year);
        if (!meta.tmdbId && data.meta.moviedb_id) meta.tmdbId = data.meta.moviedb_id;
      }
    } catch (e) {}
  }
  return meta;
}

// ── Standard providers ────────────────────────────────────────
async function getVaPlayer(imdbId, season, episode, subCb) {
  if (!imdbId) return [];
  var ref = "https://nextgencloudfabric.com/";
  var url = season == null ? VA_PLAYER + "/api.php?imdb=" + imdbId + "&type=movie" : VA_PLAYER + "/api.php?imdb=" + imdbId + "&type=tv&season=" + season + "&episode=" + episode;
  try {
    var data = await fetchJson(url, { headers: { "Referer": ref } });
    var out = [];
    if (data && data.data && data.data.stream_urls) data.data.stream_urls.forEach(function (u) { if (u) out.push({ url: fixUrl(u), quality: "Auto", label: "[VaPlayer]", container: u.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: { "Referer": ref } }); });
    if (data && data.default_subs) data.default_subs.forEach(function (s) { if (s.url) subCb({ url: fixUrl(s.url), lang: s.lang || s.code || "Unknown" }); });
    return out;
  } catch (e) { return []; }
}
async function getVidrock(tmdbId, season, episode, subCb) {
  if (!tmdbId) return [];
  var type = season == null ? "movie" : "tv", query = season == null ? tmdbId : tmdbId + "_" + season + "_" + episode;
  var hdrs = { "Origin": VIDROCK, "Referer": VIDROCK + "/" };
  try {
    var data = await fetchJson(VIDROCK + "/api/" + type + "/" + query + "/", { headers: hdrs });
    var out = [];
    for (var k in data) {
      var enc = data[k].url;
      if (enc && enc !== "error" && enc !== "null") {
        var dec = await decryptVidrockUrl(enc);
        if (dec) out.push({ url: fixUrl(dec), quality: "Auto", label: "[Vidrock " + k + "]", container: dec.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: hdrs });
      }
    }
    return out;
  } catch (e) { return []; }
}
async function getVidzee(tmdbId, season, episode, subCb) {
  if (!tmdbId) return [];
  var secret = _atob("QTdrUDl4TTJRdjhMcjROejFIdDZZYzNCdzVKZjBEc1U=");
  var per = await Promise.all([0, 1, 2, 4, 5, 6, 7].map(function (sr) {
    return (async function () {
      var out = [];
      try {
        var url = season == null ? VIDZEE + "/api/server?id=" + tmdbId + "&sr=" + sr : VIDZEE + "/api/server?id=" + tmdbId + "&sr=" + sr + "&ss=" + season + "&ep=" + episode;
        var data = await fetchJson(url);
        if (!data) return out;
        var gh = {};
        if (data.headers) for (var h in data.headers) gh[h] = data.headers[h];
        if (data.url) for (var j = 0; j < data.url.length; j++) {
          var item = data.url[j];
          if (item.link) {
            var fu = decryptVidzeeUrl(item.link, secret);
            if (fu && fu.indexOf("https:") > -1) out.push({ url: fixUrl(fu), quality: "1080p", label: "[VidZee " + (item.name || "") + " (" + (item.lang || "Unknown") + ")]", container: item.type === "hls" || fu.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: Object.assign({}, gh) });
          }
        }
        if (data.tracks) data.tracks.forEach(function (t) { if (t.url && t.lang) subCb({ url: fixUrl(t.url), lang: t.lang }); });
      } catch (e) {}
      return out;
    })();
  }));
  var out = [];
  per.forEach(function (l) { l.forEach(function (s) { out.push(s); }); });
  return out;
}
async function getShowbox(imdbId, season, episode, subCb) {
  var token = _readSetting("showboxToken");
  if (!imdbId || !token) return [];
  var hdrs = { "User-Agent": USER_AGENT, "Accept": "application/json, text/html, */*" };
  try {
    var searchHtml = await fetchText(SHOWBOX + "/search?keyword=" + imdbId, { headers: hdrs });
    var hrefMatch = searchHtml.match(/class="film-name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"/) || searchHtml.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*film-name[^"]*"/);
    if (!hrefMatch) return [];
    var detailHtml = await fetchText(fixUrl(hrefMatch[1], SHOWBOX), { headers: hdrs });
    var idMatch = detailHtml.match(/class="heading-name[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/);
    if (!idMatch) return [];
    var mediaId = parseInt(idMatch[1].split("/").pop());
    if (!mediaId) return [];
    var type = season != null ? 2 : 1;
    var shareJson = await fetchJson(SHOWBOX + "/index/share_link?id=" + mediaId + "&type=" + type, { headers: hdrs });
    if (!shareJson || !shareJson.data || !shareJson.data.link) return [];
    var shareKey = shareJson.data.link.split("/").pop();
    var fileJson = await fetchJson(FEBBOX + "/file/file_share_list?share_key=" + shareKey, { headers: hdrs });
    if (!fileJson || !fileJson.data || !fileJson.data.file_list) return [];
    var vf = null;
    if (season != null && episode != null) {
      var sf = fileJson.data.file_list.find(function (f) { return f.is_dir && (f.file_name || "").toLowerCase().indexOf("season " + season) > -1; }) || fileJson.data.file_list.find(function (f) { return f.is_dir; });
      if (!sf) return [];
      var ed = await fetchJson(FEBBOX + "/file/file_share_list?share_key=" + shareKey + "&parent_id=" + sf.fid, { headers: hdrs });
      if (ed && ed.data && ed.data.file_list) vf = ed.data.file_list.find(function (f) { return !f.is_dir && (f.file_name || "").toLowerCase().indexOf("e" + (episode < 10 ? "0" : "") + episode) > -1; }) || ed.data.file_list.find(function (f) { return !f.is_dir; });
    } else vf = fileJson.data.file_list.find(function (f) { return !f.is_dir; });
    if (!vf) return [];
    var qj = await fetchJson(FEBBOX + "/console/video_quality_list?fid=" + vf.fid + "&share_key=" + shareKey, { headers: Object.assign({}, hdrs, { "Cookie": token.indexOf("ui=") === 0 ? token : "ui=" + token }) });
    if (!qj || !qj.html) return [];
    var out = [], re = /<div[^>]*class="[^"]*file_quality[^"]*"[^>]*>/g, m;
    while ((m = re.exec(qj.html)) !== null) {
      var u = (m[0].match(/data-url="([^"]+)"/) || [])[1], q = (m[0].match(/data-quality="([^"]+)"/) || [])[1];
      if (u && q) out.push({ url: fixUrl(u.replace(/\\\//g, '/')), quality: q === 'ORG' ? '2160p' : (q.match(/\d{3,4}/) || ['Auto'])[0] + 'p', label: '[ShowBox]', container: u.indexOf('.m3u8') > -1 ? 'hls' : 'unknown', headers: hdrs });
    }
    return out;
  } catch (e) { return []; }
}
async function getVidfast(tmdbId, season, episode, subCb) {
  if (!tmdbId) return [];
  var hdrs = { "User-Agent": USER_AGENT, "Referer": VIDFAST + "/" };
  try {
    var html = await fetchText(season == null ? VIDFAST + "/movie/" + tmdbId + "/" : VIDFAST + "/tv/" + tmdbId + "/" + season + "/" + episode + "/", { headers: hdrs });
    var m = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    if (!m) return [];
    var s1 = await fetchJson(MULTI_DECRYPT + "/enc-vidfast?text=" + encodeURIComponent(m[1]) + "&stage=1");
    if (!s1 || !s1.result || !s1.result.stage1) return [];
    var s1t = await fetchText(s1.result.stage1, { method: "POST", headers: Object.assign({}, hdrs, { "X-CSRF-Token": s1.result.token, "X-Requested-With": "XMLHttpRequest" }) });
    if (!s1t) return [];
    var data = await fetchJson(MULTI_DECRYPT + "/enc-vidfast?text=" + encodeURIComponent(s1t) + "&stage=2");
    if (!data || !data.result || !data.result.servers || !data.result.stream) return [];
    var ph = Object.assign({}, hdrs, { "X-CSRF-Token": data.result.token, "X-Requested-With": "XMLHttpRequest" });
    var srvDec = await fetchJson(MULTI_DECRYPT + "/dec-vidfast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: await fetchText(data.result.servers, { method: "POST", headers: ph }) }) });
    if (!srvDec || !srvDec.result) return [];
    var per = await Promise.all(srvDec.result.map(function (sv) {
      return (async function () {
        if (!sv.data) return null;
        try {
          var se = await fetchText(data.result.stream + "/" + sv.data, { method: "POST", headers: ph });
          var sd = await fetchJson(MULTI_DECRYPT + "/dec-vidfast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: se }) });
          if (sd.result && sd.result.url) {
            if (sd.result.tracks) sd.result.tracks.forEach(function (t) { if (t.file && t.label) subCb({ url: fixUrl(t.file), lang: t.label }); });
            return { url: fixUrl(sd.result.url), quality: sd.result.is4kAvailable ? "2160p" : "1080p", label: "[Vidfast " + (sv.name || "") + "]", container: sd.result.url.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: ph };
          }
        } catch (e) {}
        return null;
      })();
    }));
    var out = [];
    per.forEach(function (s) { if (s) out.push(s); });
    return out;
  } catch (e) { return []; }
}
async function getHexa(tmdbId, season, episode, subCb) {
  if (!tmdbId) return [];
  var kb = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) { try { crypto.getRandomValues(kb); } catch (e) {} }
  else { for (var r = 0; r < 32; r++) kb[r] = Math.floor(Math.random() * 256); }
  var key = "";
  for (var i = 0; i < 32; i++) { var h = kb[i].toString(16); key += (h.length === 1 ? "0" : "") + h; }
  try {
    var tk = await fetchJson(MULTI_DECRYPT + "/enc-hexa");
    var enc = await fetchText(season == null ? HEXA + "/api/tmdb/movie/" + tmdbId + "/images" : HEXA + "/api/tmdb/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "/images", { headers: { "User-Agent": USER_AGENT, "Accept": "text/plain", "X-Api-Key": key, "X-Fingerprint-Lite": "e9136c41504646444", "Referer": "https://hexa.su/", "X-Cap-Token": tk.result.token } });
    var dec = await fetchJson(MULTI_DECRYPT + "/dec-hexa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: enc, key: key }) });
    if (!dec.result) return [];
    var out = [];
    dec.result.sources.forEach(function (s) { if (s.url) out.push({ url: fixUrl(s.url), quality: "1080p", label: "[Hexa " + (s.server || "") + "]", container: s.url.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: { "Referer": "https://hexa.su/" } }); });
    return out;
  } catch (e) { return []; }
}

// ── AniKoto (ported from anikoto.js) ────────────────────────
function _anGet(url, ref, xhr) {
  var h = { 'User-Agent': ANIKOTO_UA, 'Referer': ref || ANIKOTO_SITE + '/' };
  if (xhr) h['X-Requested-With'] = 'XMLHttpRequest';
  return fetch(url, { headers: h }).then(function (r) { return r.body || ''; }).catch(function () { return ''; });
}
function _anJson(url, ref) {
  return _anGet(url, ref).then(function (b) { var j; try { j = JSON.parse(b || 'null'); } catch (e) { j = null; } return j; });
}
function _anAjax(path) {
  return _anGet(ANIKOTO_SITE + path, ANIKOTO_SITE + '/', true).then(function (b) { var j; try { j = JSON.parse(b || 'null'); } catch (e) { j = null; } return j; }).catch(function () { return null; });
}
var _AN_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _anB64(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
  while (s.length % 4) s += '=';
  var o = '', i, j;
  for (i = 0; i + 3 < s.length; i += 4) {
    var n = 0, pad = 0;
    for (j = 0; j < 4; j++) { var c = s.charAt(i + j), v = (c === '=') ? 0 : _AN_B64.indexOf(c); if (c === '=') pad++; n = (n << 6) | (v < 0 ? 0 : v); }
    o += String.fromCharCode((n >> 16) & 255);
    if (pad < 2) o += String.fromCharCode((n >> 8) & 255);
    if (pad < 1) o += String.fromCharCode(n & 255);
  }
  return o;
}
function _anFileFromSources(j) {
  var s = j && j.sources;
  var f = s ? (s.file || (s[0] && s[0].file)) : null;
  if (f) return f;
  if (!j || !j.enc) return null;
  try {
    var ct = _arr(base64UrlToBytes(j.enc));
    if (!ct.length || ct.length % 16 !== 0) return null;
    var pt = _bytesToStr(_aesCbcDecrypt(ct, _padBytes('i?LMTAx0Q6,:}50U', 32), _padBytes("W0;27ToaUpl_P%'c", 16)));
    var o = JSON.parse(pt);
    if (!o) return null;
    if (o.file) return o.file;
    s = o.sources;
    return s ? (s.file || (s[0] && s[0].file)) : null;
  } catch (e) { return null; }
}
function _anParseServers(html) {
  var source = String(html || ''), servers = [], seen = {};
  var tagRe = /<\/?([a-z][a-z0-9:-]*)\b([^>]*)>/gi, stack = [], match;
  function attr(a, n) {
    var re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, m;
    while ((m = re.exec(a || '')) !== null) if (m[1].toLowerCase() === n.toLowerCase()) return m[2] !== undefined ? m[2] : m[3];
    return '';
  }
  function vis(raw) {
    return String(raw || '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<style\b[\s\S]*?<\/style\s*>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  while ((match = tagRe.exec(source)) !== null) {
    var full = match[0], tag = match[1].toLowerCase(), attrs = match[2] || '';
    if (full.charAt(1) === '/') { for (var si = stack.length - 1; si >= 0; si--) if (stack[si].tag === tag) { stack.length = si; break; } continue; }
    var node = { tag: tag, attrs: attrs, start: match.index };
    if (tag === 'li') {
      var closeRe = /<\/li\s*>/ig; closeRe.lastIndex = tagRe.lastIndex;
      var close = closeRe.exec(source);
      var inner = close ? source.slice(tagRe.lastIndex, close.index) : '';
      var id = attr(attrs, 'data-link-id');
      if (!id) id = attr(inner, 'data-link-id');
      if (id && !/download-icon/i.test(attrs + ' ' + inner)) {
        var type = attr(attrs, 'data-type');
        if (!type) for (var ai = stack.length - 1; ai >= 0; ai--) { type = attr(stack[ai].attrs, 'data-type') || attr(stack[ai].attrs, 'type'); if (type) break; }
        if (!type) {
          var before = source.slice(0, match.index), types = /(?:data-type|type)\s*=\s*["'](sub|hsub|dub)["']/gi, tm, last = '';
          while ((tm = types.exec(before)) !== null) last = tm[1];
          type = last || 'sub';
        }
        type = String(type).toLowerCase();
        if (type !== 'sub' && type !== 'hsub' && type !== 'dub') type = /dub/i.test(type) ? 'dub' : 'sub';
        var nm = vis(inner), key = [type, id, nm].join('\n');
        if (!seen[key]) { seen[key] = true; servers.push({ type: type, linkId: id, name: nm || ('Server ' + id) }); }
      }
    }
    if (!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag) && !/\/\s*>$/.test(full)) stack.push(node);
  }
  return servers;
}
function _anSrvRank(name) {
  var n = String(name || '').toLowerCase();
  if (n.indexOf('vidplay') > -1) return 0;
  if (n.indexOf('vidstream') > -1) return 1;
  if (n.indexOf('hd') > -1) return 2;
  if (n.indexOf('vidcloud') > -1) return 3;
  return 5;
}
function _anDedupe(list) {
  var seen = {};
  return (list || []).filter(function (s) {
    if (!s || !s.url) return false;
    var k = [s.url, s.label || '', s.kind || '', s.audioLang || ''].join('\n');
    if (seen[k]) return false; seen[k] = true; return true;
  });
}
function _anSourcesUrl(base, dataId, type) {
  var path = /(?:megaplay|vidwish)\.[a-z]+/i.test(String(base || '')) ? '/stream/getSourcesNew' : '/stream/getSources';
  return base + path + '?id=' + dataId + '&type=' + type;
}
function _anExtractPlayer(embed, cat, serverName) {
  var base = (embed.match(/^(https?:\/\/[^/]+)/) || [])[1] || 'https://vidtube.site';
  var type = (embed.match(/\/(sub|hsub|dub)\/?(?:[?#]|$)/i) || [])[1] || cat;
  return _anGet(embed, ANIKOTO_SITE + '/').then(function (mhtml) {
    var dataId = (mhtml.match(/data-id="(\d+)"/) || [])[1];
    if (!dataId) throw new Error('AniKoto: no embed id');
    return fetch(_anSourcesUrl(base, dataId, type), { headers: { 'User-Agent': ANIKOTO_UA, 'Referer': embed, 'X-Requested-With': 'XMLHttpRequest' } }).then(function (r) {
      var j; try { j = JSON.parse(r.body || 'null'); } catch (e) { throw new Error('AniKoto: bad getSources'); }
      var file = _anFileFromSources(j);
      if (!file) throw new Error('AniKoto: no stream file');
      var subs = [], tracks = (j && j.tracks) || [];
      for (var i = 0; i < tracks.length; i++) {
        var t = tracks[i]; if (!t || !t.file) continue;
        if (t.kind && t.kind !== 'captions' && t.kind !== 'subtitles') continue;
        subs.push({ url: t.file, lang: t.label || 'Sub', label: t.label || 'Sub', format: /\.srt(\?|$)/i.test(t.file) ? 'srt' : 'vtt', 'default': !!t['default'] });
      }
      var hdrs = { 'User-Agent': ANIKOTO_UA, 'Referer': base + '/', 'Origin': base };
      var tagged = file + '#anikoto-' + String(serverName || 'server').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + cat;
      return [{ url: tagged, label: (serverName || 'AniKoto') + ' · ' + cat, quality: 'auto', container: /\.m3u8(\?|$)/i.test(file) ? 'hls' : 'mp4', headers: hdrs, kind: cat, audioLang: cat === 'dub' ? 'en' : 'ja', subtitles: subs }];
    });
  });
}
function _anResolveServer(server, cat) {
  var sc = server.type === 'dub' ? 'dub' : (server.type === 'hsub' ? 'hsub' : 'sub');
  return _anAjax('/ajax/server?get=' + encodeURIComponent(server.linkId)).then(function (j) {
    var url = j && j.result && (typeof j.result === 'object' ? j.result.url : null);
    if (!url || !/^https?:\/\//i.test(url)) return [];
    if (/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(url)) {
      var db = (url.match(/^(https?:\/\/[^/]+)/i) || [])[1] || ANIKOTO_SITE;
      return [{ url: url + '#anikoto-' + String(server.name || 'server').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + sc, label: (server.name || 'AniKoto') + ' · ' + sc, quality: 'auto', container: /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : 'mp4', headers: { 'User-Agent': ANIKOTO_UA, 'Referer': ANIKOTO_SITE + '/', 'Origin': db }, kind: sc, audioLang: sc === 'dub' ? 'en' : 'ja', subtitles: [] }];
    }
    return _anExtractPlayer(url, sc, server.name).then(function (g) { return g || []; });
  }).catch(function () { return []; });
}
function _anTryAll(list, cat) {
  list = list || [];
  var jobs = [];
  for (var i = 0; i < list.length; i++) jobs.push(_anResolveServer(list[i], cat));
  return Promise.all(jobs).then(function (groups) {
    var ri = [];
    for (var k = 0; k < groups.length; k++) if (!groups[k].length) ri.push(k);
    var chain = Promise.resolve();
    ri.forEach(function (idx) { chain = chain.then(function () { return _anResolveServer(list[idx], cat).then(function (g) { groups[idx] = g; }); }); });
    return chain.then(function () { var out = []; for (var k2 = 0; k2 < groups.length; k2++) out = out.concat(groups[k2]); return out; });
  });
}
function _anMapperAll(token, cat) {
  if (!token) return Promise.resolve([]);
  return _anJson(ANIKOTO_MAPPER + token, ANIKOTO_SITE + '/').then(function (j) {
    var extra = [];
    for (var name in (j || {})) {
      var e = j[name];
      if (name === 'status' || !e || typeof e !== 'object') continue;
      var b = e[cat];
      if (b && b.url) extra.push({ type: cat, linkId: String(b.url), name: name });
    }
    return _anTryAll(extra, cat);
  }).catch(function () { return []; });
}
function anikotoGetVideoSources(epUrl) {
  var raw = String(epUrl).replace('anikoto://', '');
  var parts = raw.split('/');
  var cat = (parts[0] === 'dub') ? 'dub' : 'sub';
  var sids = parts[1] ? decodeURIComponent(parts[1]) : '';
  var token = (parts[4] && parts[5] && parts[6]) ? (parts[4] + '/' + parts[5] + '/' + parts[6]) : null;
  if (!sids) return Promise.reject(new Error('AniKoto: no server ids'));
  return _anAjax('/ajax/server/list?servers=' + encodeURIComponent(sids)).then(function (j) {
    var lhtml = (j && typeof j.result === 'string') ? j.result : '';
    var servers = _anParseServers(lhtml);
    var want = servers.slice();
    want.sort(function (a, b) { var r = _anSrvRank(a.name) - _anSrvRank(b.name); if (r) return r; return (a.type || '').localeCompare(b.type || ''); });
    return Promise.all([_anTryAll(want, cat), _anMapperAll(token, cat)]).then(function (res) {
      var all = _anDedupe(res[0].concat(res[1]));
      if (all.length) return all;
      throw new Error('AniKoto: no playable server');
    });
  }).catch(function (err) {
    return _anMapperAll(token, cat).then(function (extra) { if (extra.length) return extra; throw err; });
  });
}
async function searchAnikoto(title) {
  var q = _trim(title); if (!q) return null;
  var html = await _anGet(ANIKOTO_SITE + '/filter?keyword=' + encodeURIComponent(q), ANIKOTO_SITE + '/');
  var m = html.match(/href="([^"]*\/watch\/[^"]+)"/);
  if (!m) return null;
  var s = m[1].match(/\/watch\/([^/"?#]+)/);
  return s ? s[1] : null;
}
async function getAnikotoDetail(slug) {
  var html = await _anGet(ANIKOTO_SITE + '/watch/' + encodeURIComponent(slug), ANIKOTO_SITE + '/');
  var animeId = (html.match(/data-id="(\d+)"/) || [])[1];
  if (!animeId) return null;
  var j = await _anAjax('/ajax/episode/list/' + animeId);
  var lhtml = (j && typeof j.result === 'string') ? j.result : '';
  var eps = [], re = /<a\b([^>]*\bdata-id="\d+"[^>]*)>/g, m;
  while ((m = re.exec(lhtml)) !== null) {
    var a = m[1], sids = (a.match(/data-ids="([^"]+)"/) || [])[1];
    if (!sids) continue;
    var num = parseInt((a.match(/data-num="(\d+)"/) || [])[1] || '0', 10);
    var sub = (a.match(/data-sub="(\d+)"/) || [])[1] === '1', dub = (a.match(/data-dub="(\d+)"/) || [])[1] === '1';
    if (!sub && !dub) continue;
    var em = (a.match(/data-mal="(\d+)"/) || [])[1], es = (a.match(/data-slug="([^"]+)"/) || [])[1], et = (a.match(/data-timestamp="(\d+)"/) || [])[1];
    var tok = (em && es && et) ? (em + '/' + encodeURIComponent(es) + '/' + et) : null;
    var cat = dub ? 'dub' : 'sub';
    var eu = 'anikoto://' + cat + '/' + encodeURIComponent(sids) + '/' + (sub ? 1 : 0) + (dub ? 1 : 0) + '/' + num + (tok ? '/' + tok : '');
    eps.push({ number: num, sub: sub, dub: dub, url: eu });
  }
  return eps;
}
async function getAnikotoFixed(title, year, season, episode, subCb) {
  var slug = await searchAnikoto(title);
  if (!slug) return [];
  var eps = await getAnikotoDetail(slug);
  if (!eps || !eps.length) return [];
  var tn = episode || 1;
  var f = eps.filter(function (e) { return e.number === tn; })[0];
  if (!f && (season === 1 || season == null)) f = eps.reduce(function (p, c) { return Math.abs(c.number - tn) < Math.abs(p.number - tn) ? c : p; }, eps[0]);
  if (!f) return [];
  try {
    var st = await anikotoGetVideoSources(f.url);
    st.forEach(function (s) { if (s.subtitles) s.subtitles.forEach(function (sub) { if (sub.url) subCb({ url: sub.url, lang: sub.lang || 'Sub' }); }); });
    return st;
  } catch (e) {
    console.log('CineStream2: AniKoto failed: ' + (e && e.message ? e.message : e));
    return [];
  }
}

// ── RareAnimes (ported from rareanimes.js) ──────────────────
function _raFailed(r) { return !r || r.ok === false || (typeof r.status === 'number' && r.status >= 400); }
function _raBody(r) {
  if (r && typeof r.body === 'string') return Promise.resolve(r.body);
  if (r && typeof r.text === 'function') return r.text();
  return Promise.resolve('');
}
function _raMsg(e) { return e && e.message ? e.message : String(e); }
function _raHost(u) { return ((String(u).match(/^https?:\/\/([^\/:?#]+)/i) || [])[1] || '').toLowerCase(); }
function _raOrigin(u) { return (String(u).match(/^(https?:\/\/[^\/?#]+)/i) || [])[1] || ''; }
function _raGet(url, ref) {
  return fetch(url, { headers: { 'User-Agent': RA_UA, 'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8', 'Referer': ref || RA_SITE + '/' } })
    .then(function (r) { if (_raFailed(r)) throw new Error('HTTP ' + (r && r.status) + ' ' + url); return _raBody(r); })
    .then(function (b) { if (b.length < 60000 && /<title>\s*Just a moment|cf-browser-verification|challenge-platform|cf_chl_opt/i.test(b)) throw new Error('Cloudflare challenge at ' + url); return b; });
}
function _raDecode(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—');
}
function _raStrip(s) { return _raDecode(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function _raAbs(url, base) {
  url = _raDecode(String(url || ''));
  if (/^https?:\/\//i.test(url)) return url;
  if (/^\/\//.test(url)) return 'https:' + url;
  return (base || RA_SITE).replace(/\/+$/, '') + (url.charAt(0) === '/' ? '' : '/') + url;
}
function _raCleanTitle(s) {
  s = _raStrip(s).replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*[-–|]?\s*\b(?:Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|Dual Audio|Multi Audio|All Episodes|Episodes?|Download|HD|Watch Online|Complete)\b[\s\S]*$/i, '');
  return s.replace(/[\s\-–|:,(]+$/, '').trim() || 'Untitled';
}
function _raParseListing(html) {
  html = String(html || '');
  var out = [], seen = {};
  var re = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi, m;
  while ((m = re.exec(html))) {
    var body = m[2];
    var a = body.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/i) || body.match(/<a\b[^>]*title=["']([^"']+)["'][^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/i);
    var href = '', title = '';
    if (a) { if (/^https?:\/\//i.test(a[1])) { href = a[1]; title = a[2] || ''; } else { title = a[1] || ''; href = a[2] || ''; } }
    if (!href) { var h = body.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/i); href = h ? h[1] : ''; }
    if (!title) title = _raStrip((body.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i) || [])[1] || '');
    if (!href || !title || seen[href]) continue;
    var im = body.match(/<img\b[^>]*(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i);
    seen[href] = 1;
    out.push({ id: href, url: href, title: _raCleanTitle(title), cover: im ? _raAbs(im[1], RA_SITE) : null, type: 'anime', sourceId: SOURCE_ID });
  }
  if (!out.length) {
    var ar = /<a\b[^>]*href=["'](https?:\/\/(?:www\.)?rareanimes\.[a-z]{2,}\/[^"'#?]+)["'][^>]*>([\s\S]{0,1800}?)<\/a>/gi, x;
    while ((x = ar.exec(html))) {
      var t = _raStrip((x[2].match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i) || [])[1] || x[2]);
      if (!t || seen[x[1]] || t.length > 140) continue;
      seen[x[1]] = 1;
      var img = x[2].match(/<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i);
      out.push({ id: x[1], url: x[1], title: _raCleanTitle(t), cover: img ? _raAbs(img[1], RA_SITE) : null, type: 'anime', sourceId: SOURCE_ID });
    }
  }
  return out;
}
function _raPostLines(c) {
  var html = String(c || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
  var links = [];
  html = html.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, function (all, url, label) {
    var raw = _raDecode(url).trim(), text = _raStrip(label), full = '';
    if (/^https?:\/\//i.test(raw)) { if (RA_FAMILY_RE.test(_raHost(raw))) full = raw; }
    else if (/^\/\//.test(raw)) { var p = 'https:' + raw; if (RA_FAMILY_RE.test(_raHost(p))) full = p; }
    else if (raw.charAt(0) === '/' && (RA_REL_PATH_RE.test(raw) || RA_REL_LABEL_RE.test(text))) full = 'https://codedew.com' + raw;
    if (!full) return all;
    links.push({ url: full, label: text });
    return ' __RAI_LINK_' + (links.length - 1) + '__ ';
  });
  html = html.replace(/<(?:p|h[1-6]|hr|br|div|li|tr)\b[^>]*>/gi, '\n');
  return html.split(/\n/).map(function (line) {
    var toks = [];
    line = line.replace(/__RAI_LINK_(\d+)__/g, function (_, n) { if (links[+n]) toks.push(links[+n]); return ''; });
    return { text: _raStrip(line), links: toks };
  }).filter(function (x) { return x.text || x.links.length; });
}
function _raVariant(t) {
  var s = String(t || '').replace(/^\s*(?:episode|ep\.?)\s*\d+\s*[-–:]\s*/i, '');
  s = s.split(/\s[-–]\s|[-–]\s*$/)[0].replace(/[\[\]]/g, '').trim();
  var m = s.match(/\b(Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|English|Japanese)\b[\s\S]*$/i);
  if (m) return m[0].slice(0, 48);
  if (/^untouched\b/i.test(s)) return s.slice(0, 48);
  return '';
}
function _raParseEpisodes(c) {
  var lines = _raPostLines(c), eps = [], cur = null, nl = 1, pl = '';
  function ens(n, t, eh) {
    var f = eps.filter(function (e) { return e.number === n; })[0];
    if (f) { if (t && (!f.title || /^Episode \d+$/i.test(f.title))) f.title = t; if (eh) f.hasHeader = true; return f; }
    f = { number: n, title: t || ('Episode ' + n), variants: [], hasHeader: !!eh };
    eps.push(f); return f;
  }
  lines.forEach(function (line) {
    var h = line.text.match(/^(?:episode|ep\.?)\s*0*(\d{1,4})\b\s*(?:[-–:]\s*(.*))?$/i);
    if (h) { cur = ens(+h[1], (h[2] || '').trim(), true); pl = ''; }
    else if (line.text) { var dl = _raVariant(line.text); if (dl) pl = dl; }
    if (line.links.length) {
      if (!cur) { cur = ens(nl, 'Episode ' + nl, false); nl++; }
      var lang = _raVariant(line.text) || pl || (/^episode\s+\d+$/i.test(cur.title) ? 'Default' : cur.title) || 'Default';
      var us = line.links.filter(function (l) { return /watchnow|watch\b|hubcloud/i.test(l.label); });
      if (!us.length) us = line.links.filter(function (l) { return /streambeta|multiquality|dlbeta|filepress|download|play/i.test(l.label); });
      if (!us.length) us = line.links;
      if (!us.length) return;
      var pr = us.filter(function (l) { return /watchnow|watch\b/i.test(l.label); })[0] || us.filter(function (l) { return /hubcloud/i.test(l.label); })[0] || us[0];
      var ord = [pr].concat(us.filter(function (l) { return l !== pr; }));
      line.links.forEach(function (l) { if (ord.indexOf(l) < 0) ord.push(l); });
      var urls = ord.map(function (l) { return l.url; }).slice(0, 6);
      var key = lang.toLowerCase();
      var v = cur.variants.filter(function (x) { return x.lang.toLowerCase() === key; })[0];
      if (!v) { v = { lang: lang, url: pr.url, alts: urls }; cur.variants.push(v); }
      else {
        urls.forEach(function (u) { if (v.alts.indexOf(u) < 0 && v.alts.length < 8) v.alts.push(u); });
        if (/watchnow|watch\b/i.test(pr.label)) v.url = pr.url;
      }
      pl = '';
    }
  });
  return eps.filter(function (e) { return e.hasHeader || e.variants.length; }).sort(function (a, b) { return a.number - b.number; }).map(function (e) {
    var eu = 'rareanimes://episode/' + encodeURIComponent(JSON.stringify({ title: e.title, number: e.number, variants: e.variants }));
    return { id: eu, title: e.title, number: e.number, url: eu };
  });
}
function _raGetDetail(pageUrl) {
  pageUrl = String(pageUrl || '');
  if (!/^https?:\/\//i.test(pageUrl)) pageUrl = _raAbs(pageUrl, RA_SITE);
  if (!/^https?:\/\/(?:www\.)?rareanimes\.[a-z]{2,}\//i.test(pageUrl)) return Promise.reject(new Error('RareAnimes: invalid detail URL'));
  return _raGet(pageUrl).then(function (html) {
    var title = _raStrip((html.match(/<h1\b[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    title = title.replace(/\s*[-|–]\s*Rare Toons India\s*$/i, '');
    var a = html.indexOf('<div class="entry-content'), b = a >= 0 ? html.indexOf('</article>', a) : -1;
    var content = a >= 0 ? html.slice(a, b > a ? b : undefined) : html;
    var poster = (html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1] || '';
    if (!poster) { var im = content.match(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/i); poster = im ? im[1] : ''; }
    var description = _raStrip((content.match(/(?:Synopsis|Storyline|Plot)[\s\S]{0,250}?<\/(?:p|div)>/i) || [])[0] || '');
    var episodes = _raParseEpisodes(content);
    if (!title || !episodes.length) throw new Error('RareAnimes: title/episode links not found');
    return { id: pageUrl, title: _raCleanTitle(title) || title, url: pageUrl, cover: poster ? _raAbs(poster, RA_SITE) : null, description: description || null, type: 'anime', sourceId: SOURCE_ID, episodes: episodes };
  });
}
var _RA_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _raB64Decode(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
  while (s.length % 4) s += '=';
  var out = '', i;
  for (i = 0; i + 3 < s.length; i += 4) {
    var a = _RA_B64.indexOf(s.charAt(i)), b = _RA_B64.indexOf(s.charAt(i + 1));
    var c = s.charAt(i + 2) === '=' ? 0 : _RA_B64.indexOf(s.charAt(i + 2));
    var d = s.charAt(i + 3) === '=' ? 0 : _RA_B64.indexOf(s.charAt(i + 3));
    if (a < 0 || b < 0) break;
    out += String.fromCharCode((a << 2) | (b >> 4));
    if (s.charAt(i + 2) !== '=') out += String.fromCharCode(((b & 15) << 4) | (c >> 2));
    if (s.charAt(i + 3) !== '=') out += String.fromCharCode(((c & 3) << 6) | d);
  }
  try { return decodeURIComponent(escape(out)); } catch (e) { return out; }
}
function _raBalanced(s, o, c) {
  var st = s.indexOf(o);
  if (st < 0) return '';
  var d = 0, q = '', e = false;
  for (var i = st; i < s.length; i++) {
    var ch = s.charAt(i);
    if (q) { if (e) e = false; else if (ch === '\\') e = true; else if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === o) d++;
    if (ch === c && --d === 0) return s.slice(st, i + 1);
  }
  return '';
}
function _raReadString(s, i) {
  var q = s.charAt(i), out = '';
  if (q !== '"' && q !== "'") return null;
  for (var k = i + 1; k < s.length; k++) {
    var ch = s.charAt(k);
    if (ch === '\\') {
      var n = s.charAt(k + 1);
      if (n === 'u' && /^[0-9a-f]{4}$/i.test(s.substr(k + 2, 4))) { out += String.fromCharCode(parseInt(s.substr(k + 2, 4), 16)); k += 5; }
      else if (n === 'n') { out += '\n'; k++; }
      else if (n === 'r') { out += '\r'; k++; }
      else if (n === 't') { out += '\t'; k++; }
      else { out += n; k++; }
    } else if (ch === q) return { value: out, end: k + 1 };
    else out += ch;
  }
  return null;
}
function _raAsArr(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') { var k = ['sources', 'playerSources', 'data', 'links', 'streams']; for (var i = 0; i < k.length; i++) if (Array.isArray(x[k[i]])) return x[k[i]]; }
  return [];
}
function _raParseMaybe(s, d) {
  s = String(s || '').trim(); d = d || 0;
  if (!s) return [];
  var a;
  try { a = _raAsArr(JSON.parse(s)); if (a.length) return a; } catch (e) {}
  var b = _raBalanced(s, '[', ']');
  if (b && b !== s) { try { a = _raAsArr(JSON.parse(b)); if (a.length) return a; } catch (e) {} }
  if (d < 2 && /^[A-Za-z0-9+\/_\-=\s]{16,}$/.test(s)) return _raParseMaybe(_raB64Decode(s), d + 1);
  return [];
}
var _RA_WRAP_RE = /^(?:window\s*\.\s*)?(?:JSON\s*\.\s*parse|atob|base64_decode|decodeURIComponent|escape|unescape)\s*\(\s*/i;
function _raFromRhs(rhs) {
  rhs = String(rhs).replace(/^\s+/, '');
  for (var g = 0; g < 6 && _RA_WRAP_RE.test(rhs); g++) rhs = rhs.replace(_RA_WRAP_RE, '');
  var c = rhs.charAt(0);
  if (c === '[') return _raParseMaybe(_raBalanced(rhs, '[', ']'));
  if (c === '{') return _raParseMaybe(_raBalanced(rhs, '{', '}'));
  if (c === '"' || c === "'") { var r = _raReadString(rhs, 0); return r ? _raParseMaybe(r.value) : []; }
  return [];
}
function _raNorm(list) {
  var out = [];
  (list || []).forEach(function (s) {
    if (typeof s === 'string') s = { stream_url: s };
    if (!s || typeof s !== 'object') return;
    var u = s.stream_url || s.streamUrl || s.file || s.url || s.src || s.link || '';
    if (!u) return;
    out.push({ stream_url: String(u), name: String(s.name || s.label || s.quality || s.type || 'Server'), type: String(s.type || '') });
  });
  return out;
}
function _raExtractSources(html) {
  var h = String(html || ''), found, m, re, n = 0;
  re = /playerSources\s*[:=]\s*/gi;
  while ((m = re.exec(h)) && n++ < 6) {
    found = _raNorm(_raFromRhs(h.slice(m.index + m[0].length, m.index + m[0].length + 400000)));
    if (found.length) return found;
  }
  re = /data-(?:player-)?(?:sources|playlist)\s*=\s*["']([^"']+)["']/gi;
  while ((m = re.exec(h))) { found = _raNorm(_raParseMaybe(_raDecode(m[1]))); if (found.length) return found; }
  var flat = h.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  var seen = {}, list = [];
  function push(u, name) { u = _raDecode(u); if (!/^(?:https?:)?\/\//i.test(u) || seen[u]) return; seen[u] = 1; list.push({ stream_url: u, name: name || 'Server' }); }
  re = /["']?(?:stream_url|streamUrl|file|src|url|source)["']?\s*[:=]\s*["']((?:https?:)?\/\/[^"'\s]+?\.(?:m3u8|mp4|mkv|webm)(?:\?[^"'\s]*)?)["']/gi;
  while ((m = re.exec(flat))) push(m[1], 'Server');
  re = /<(?:source|video)\b[^>]*\bsrc=["']([^"']+)["']/gi;
  while ((m = re.exec(flat))) push(m[1], 'Server');
  if (list.length) return _raNorm(list);
  re = /https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/gi;
  while ((m = re.exec(flat))) push(m[0], 'Fallback');
  return _raNorm(list);
}
function _raParseStreamBeta(html) {
  var h = String(html || ''), sources = _raExtractSources(h);
  var title = _raStrip((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  var lang = _raStrip((h.match(/currentLangNative\s*[=:]\s*["']([^"']+)["']/i) || [])[1] || '');
  var fid = (h.match(/maskedFileId\s*[=:]\s*["']([^"']+)["']/i) || [])[1] || '';
  var variants = [], seenFid = {}, m, re = /<[^>]*\blang-btn\b[^>]*>/gi;
  while ((m = re.exec(h))) {
    var f = (m[0].match(/data-fid=["']([^"']+)["']/i) || [])[1], l = (m[0].match(/data-lang=["']([^"']+)["']/i) || [])[1];
    if (f && !seenFid[f]) { seenFid[f] = 1; variants.push({ fid: f, lang: _raStrip(l || '') }); }
  }
  return { title: title, lang: lang, fid: fid, variants: variants, sources: sources };
}
function _raFidCandidates(fid) {
  var v = _raDecode(String(fid || '')).trim();
  if (!v) return [];
  if (/^https?:\/\//i.test(v)) return [v];
  var nm = v.match(/^streambeta:\/\/(v|url)\/(.+)$/i);
  if (nm) return [RA_SB + '?' + nm[1].toLowerCase() + '=' + encodeURIComponent(nm[2])];
  var pr = /^sb_[A-Za-z0-9_-]+$/i.test(v) ? 'v' : 'url', sec = pr === 'v' ? 'url' : 'v';
  return [RA_SB + '?' + pr + '=' + encodeURIComponent(v), RA_SB + '?' + sec + '=' + encodeURIComponent(v)];
}
function _raSbUrl(url, base) {
  var u = _raDecode(String(url || '')).replace(/\\\//g, '/').trim();
  if (/^\/\//.test(u)) u = 'https:' + u;
  else if (u.charAt(0) === '/') u = (base ? _raOrigin(base) : 'https://codedew.com') + u;
  if (!/^https?:\/\//i.test(u)) return '';
  return RA_FAMILY_RE.test(_raHost(u)) ? u : '';
}
function _raDecodeEp(url) {
  var m = String(url || '').match(/^rareanimes:\/\/episode\/(.+)$/i);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
}
function _raFollow(html, target, ctx) {
  var raws = [], m, re;
  re = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*?url=([^"']+)["']/gi;
  while ((m = re.exec(html))) raws.push(m[1]);
  re = /(?:location(?:\.href)?\s*=|location\.(?:replace|assign)\s*\(|window\.open\s*\()\s*["']([^"']+)["']/gi;
  while ((m = re.exec(html))) raws.push(m[1]);
  re = /(?:data-href|data-src|data-url|data-link|href|src|action|content)\s*=\s*["']([^"']+)["']/gi;
  while ((m = re.exec(html))) raws.push(m[1]);
  var out = [], dup = {};
  raws.forEach(function (raw) {
    raw = _raDecode(raw).trim();
    if (!/^(?:https?:)?\/\//i.test(raw) && raw.charAt(0) !== '/') return;
    if (/\.(?:css|js|png|jpe?g|gif|svg|ico|woff2?)(?:[?#]|$)/i.test(raw)) return;
    var nx = _raSbUrl(raw, target);
    if (!nx || nx === target || ctx.seen[nx] || dup[nx]) return;
    dup[nx] = 1; out.push(nx);
  });
  out.sort(function (a, b) {
    var ka = /streambeta|hubcloud|zipper|multiquality|dlbeta|player|embed/i.test(a) ? 0 : 1;
    var kb = /streambeta|hubcloud|zipper|multiquality|dlbeta|player|embed/i.test(b) ? 0 : 1;
    return ka - kb;
  });
  var href = _raDecode((html.match(/(?:data-href|data-src|data-url|href|src|content)=["']([^"']*(?:streambeta|hubcloud)[^"']*)["']/i) || [])[1] || '');
  var id = (href.match(/(?:streambeta\/[^?]*\?|hubcloud\.[a-z]+\/drive\/)(?:url=)?([A-Za-z0-9_-]{4,160})/i) || [])[1];
  if (id) { var iu = RA_SB + '?url=' + encodeURIComponent(id); if (!ctx.seen[iu] && out.indexOf(iu) < 0) out.push(iu); }
  return out;
}
function _raNewCtx() { return { seen: {}, fetches: 0 }; }
function _raResolveSb(url, depth, ctx, ref) {
  var target = _raSbUrl(url); depth = depth || 0;
  if (!target) return Promise.reject(new Error('unsupported player URL ' + String(url).slice(0, 80)));
  if (depth > 4 || ctx.seen[target] || ctx.fetches >= 10) return Promise.reject(new Error('redirect loop/limit at ' + target));
  ctx.seen[target] = true; ctx.fetches++;
  return _raGet(target, ref || RA_SITE + '/').then(function (html) {
    var p = _raParseStreamBeta(html);
    if (p.sources.length) return { html: html, parsed: p, url: target };
    var cs = _raFollow(html, target, ctx), i = 0, le = null;
    function next() {
      if (i >= cs.length) return Promise.reject(le || new Error('no stream data and no wrapper link at ' + target));
      var c = cs[i++];
      return _raResolveSb(c, depth + 1, ctx, target).catch(function (e) { le = e; return next(); });
    }
    return next();
  });
}
function _raFirstResolved(urls, errs, ref) {
  var i = 0;
  function next() {
    if (i >= urls.length) return Promise.resolve(null);
    var u = urls[i++];
    return _raResolveSb(u, 0, _raNewCtx(), ref).then(null, function (e) { errs.push(_raMsg(e)); return next(); });
  }
  return next();
}
function _raFixUrl(u, base) {
  u = _raDecode(String(u || '')).replace(/\\u0026/g, '&').replace(/\\\//g, '/').trim();
  if (/^\/\//.test(u)) return 'https:' + u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.charAt(0) === '/' && base) return _raOrigin(base) + u;
  return '';
}
function _raToSources(r, lang) {
  function build(incPix) {
    var out = [];
    r.parsed.sources.forEach(function (s) {
      if (!s) return;
      var isPix = /pixeldrain/i.test(s.type) || /pixeldrain/i.test(s.stream_url);
      if (isPix && !incPix) return;
      var url = _raFixUrl(s.stream_url, r.url);
      if (!url) return;
      var nm = String(s.name || 'Server'), probe = nm + ' ' + url;
      out.push({ url: url, quality: /2160p|\b4k\b/i.test(probe) ? '2160p' : (/1080p/i.test(probe) ? '1080p' : (/720p/i.test(probe) ? '720p' : (/480p/i.test(probe) ? '480p' : 'auto'))), label: [lang, nm].join(' • '), container: /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : 'mp4', kind: /^(?:Japanese|Original|Sub|Subbed)$/i.test(lang) ? 'sub' : 'dub', headers: { 'User-Agent': RA_UA, 'Referer': r.url || RA_SB, 'Origin': _raOrigin(r.url || RA_SB) } });
    });
    return out;
  }
  var out = build(false);
  return out.length ? out : build(true);
}
function _raVideoSources(epUrl) {
  var p = _raDecodeEp(epUrl);
  if (!p) return Promise.resolve([]);
  var vs = Array.isArray(p.variants) && p.variants.length ? p.variants : (p.url ? [{ url: p.url, lang: p.lang || '' }] : []);
  if (!vs.length) return Promise.resolve([]);
  var errs = [];
  return Promise.all(vs.map(function (v) {
    var urls = [v.url].concat(v.alts || []).filter(function (u, i, a) { return u && a.indexOf(u) === i; });
    return _raFirstResolved(urls, errs).then(function (r) { return { resolved: r, sources: r ? _raToSources(r, v.lang || r.parsed.lang || 'Auto') : [] }; });
  })).then(function (resolved) {
    var out = [], seenS = {}, curF = {}, altF = {}, altOrd = [];
    function ap(ss) { (ss || []).forEach(function (s) { var k = s.url + '|' + s.label; if (!seenS[k]) { seenS[k] = true; out.push(s); } }); }
    resolved.forEach(function (it) { ap(it.sources); if (it.resolved && it.resolved.parsed && it.resolved.parsed.fid) curF[String(it.resolved.parsed.fid)] = true; });
    resolved.forEach(function (it) {
      if (!it.resolved || !it.resolved.parsed) return;
      (it.resolved.parsed.variants || []).forEach(function (b) {
        var f = String(b.fid || '').trim();
        if (!f || curF[f] || altF[f]) return;
        altF[f] = { lang: b.lang || 'Auto', ref: it.resolved.url }; altOrd.push(f);
      });
    });
    return Promise.all(altOrd.map(function (f) {
      var info = altF[f];
      return _raFirstResolved(_raFidCandidates(f), errs, info.ref).then(function (r) { return r ? _raToSources(r, info.lang || r.parsed.lang || 'Auto') : []; }, function (e) { errs.push('lang ' + info.lang + ' (' + f + '): ' + _raMsg(e)); return []; });
    })).then(function (groups) {
      groups.forEach(ap);
      if (!out.length) throw new Error('RareAnimes: no usable direct sources. ' + (errs.length ? errs.slice(0, 8).join(' | ') : 'no player links'));
      return out;
    });
  });
}
async function getRareAnimes(title, season, episode, subCb) {
  if (!title) return [];
  try {
    var q = String(title).trim(); if (!q) return [];
    var sh = await _raGet(RA_SITE + '/?s=' + encodeURIComponent(q).replace(/%20/g, '+'));
    var rs = _raParseListing(sh);
    if (!rs.length) return [];
    var det = await _raGetDetail(rs[0].url);
    if (!det || !det.episodes || !det.episodes.length) return [];
    var en = episode || 1;
    var tgt = det.episodes.filter(function (e) { return e.number === en; })[0];
    if (!tgt) tgt = det.episodes.reduce(function (p, c) { return Math.abs(c.number - en) < Math.abs(p.number - en) ? c : p; }, det.episodes[0]);
    if (!tgt) return [];
    var st = await _raVideoSources(tgt.url);
    if (st && st.length) { st.forEach(function (s) { if (s.subtitles) s.subtitles.forEach(function (sub) { if (sub.url) subCb({ url: sub.url, lang: sub.lang || 'Sub' }); }); }); }
    return st || [];
  } catch (e) {
    console.log('CineStream2: RareAnimes failed: ' + _raMsg(e));
    return [];
  }
}

// ── Orchestrator ────────────────────────────────────────────
async function getVideoSources(episodeUrl, opts) {
  opts = opts || {};
  var p = _parseStreamId(episodeUrl);
  var meta = await _resolveMeta(p);
  var subs = [], subCb = function (s) { if (s && s.url) subs.push(s); };
  var tasks = [];
  var safe = function (name, fn) { return withTimeout(fn, 7000, [], name).catch(function (e) { console.log("CineStream2: " + name + " failed: " + (e && e.message ? e.message : e)); return []; }); };
  if (_bool('enableVaPlayer', true)) tasks.push(safe("VaPlayer", getVaPlayer(meta.imdbId, p.season, p.episode, subCb)));
  if (_bool('enableVidrock', true)) tasks.push(safe("Vidrock", getVidrock(meta.tmdbId, p.season, p.episode, subCb)));
  if (_bool('enableVidzee', true)) tasks.push(safe("Vidzee", getVidzee(meta.tmdbId, p.season, p.episode, subCb)));
  if (_bool('enableShowbox', false)) tasks.push(safe("Showbox", getShowbox(meta.imdbId, p.season, p.episode, subCb)));
  if (_bool('enableVidfast', true)) tasks.push(safe("Vidfast", getVidfast(meta.tmdbId, p.season, p.episode, subCb)));
  if (_bool('enableHexa', true)) tasks.push(safe("Hexa", getHexa(meta.tmdbId, p.season, p.episode, subCb)));
  if (_bool('enableAnikoto', true)) tasks.push(safe("Anikoto", getAnikotoFixed(meta.title, meta.year, p.season, p.episode, subCb)));
  if (_bool('enableRareAnimes', true)) tasks.push(safe("RareAnimes", getRareAnimes(meta.title, p.season, p.episode, subCb)));
  var results = await Promise.all(tasks);
  var out = [], seen = {};
  results.forEach(function (list) { if (!list) return; list.forEach(function (s) { if (s && s.url && !seen[s.url]) { seen[s.url] = true; out.push(s); } }); });
  if (typeof opts.onSubtitle === 'function') {
    var ss = {};
    subs.forEach(function (s) { if (!ss[s.url]) { ss[s.url] = true; opts.onSubtitle(s); } });
  }
  console.log("CineStream2 DONE: " + out.length + " streams | " + (meta.title || "?") + " | imdb=" + (meta.imdbId || "?"));
  return out;
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

// ── Exports ─────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '2.3.0',
    getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _parseStreamId: _parseStreamId,
    _debug: { getRareAnimes: getRareAnimes, getAnikotoFixed: getAnikotoFixed, getShowbox: getShowbox }
  };
}
