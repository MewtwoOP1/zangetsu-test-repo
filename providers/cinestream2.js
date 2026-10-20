// =============================================================================
//  cinestream2.js — CineStream2 for Zangetsu
//  v2.1.2 — Restored Anime Metadata (Kitsu/Haglund), fixed episode mapping
//  v2.1.3 — Pure-JS AES (app runtime has no WebCrypto), parallel server loops,
//           7s extractor budget, Referer opts-shape fixes, TMDB fallback key
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
var TMDB_FALLBACK_KEY = '1865f43a0549ca50d341dd9ab8b29f49'; // public plugin key — used only when the user has not set their own
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
        type: 'movie', version: '2.1.3'
    };
}

function getSettings() {
    return [
        { key: 'tmdbApiKey', label: 'TMDB API Key (optional)', description: 'Optional — a built-in public key is used when empty.', type: 'text', default: '' },
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

function withTimeout(promise, ms, fallback, label) {
    var settled = false;
    return Promise.race([
        Promise.resolve(promise).then(function (v) { settled = true; return v; }, function (e) { settled = true; throw e; }),
        new Promise(function (resolve) { setTimeout(function () { if (!settled) { if (label) console.log("CineStream2: " + label + " timed out after " + ms + "ms"); resolve(fallback === undefined ? [] : fallback); } }, ms); })
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
        var r = await fetch(url, { method: opts.method || "GET", headers: headers, body: opts.body, timeoutMs: opts.timeoutMs || 7000 });
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
// ── Pure-JS AES ─────────────────────────────────────────────────────────
// The app's JS runtime exposes NO WebCrypto (crypto.subtle) and NO
// TextEncoder/TextDecoder — only a sha256/aesCtr bridge. Any extractor that
// decrypts via crypto.subtle silently returns [] in-app while passing Node
// tests. This core is byte-verified: CBC against live MegaPlay `enc` blobs,
// GCM + forward cipher against FIPS-197 and WebCrypto-generated vectors.
function _arr(x){var a=[];for(var i=0;i<x.length;i++)a.push(x[i]&0xff);return a;}
var _SBOX=[0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
var _ISBOX=[0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];
function _xtime(a){a<<=1;if(a&0x100)a^=0x11b;return a&0xff;}
function _gmul(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return p&0xff;}
function _keyExp(key){
  var Nk=key.length/4,Nr=Nk+6,w=[],i;
  for(i=0;i<Nk;i++)w.push([key[4*i],key[4*i+1],key[4*i+2],key[4*i+3]]);
  var rcon=1;
  for(i=Nk;i<4*(Nr+1);i++){
    var t=w[i-1].slice();
    if(i%Nk===0){t=[t[1],t[2],t[3],t[0]];t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];t[0]^=rcon;rcon=_xtime(rcon);}
    else if(Nk>6&&i%Nk===4){t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];}
    w.push([w[i-Nk][0]^t[0],w[i-Nk][1]^t[1],w[i-Nk][2]^t[2],w[i-Nk][3]^t[3]]);
  }
  return {w:w,Nr:Nr};
}
function _invCipher(inb,ks){
  var w=ks.w,Nr=ks.Nr,s=[[],[],[],[]],r,c,i;
  for(i=0;i<16;i++)s[i%4][(i/4)|0]=inb[i];
  function ark(round){for(c=0;c<4;c++)for(r=0;r<4;r++)s[r][c]^=w[round*4+c][r];}
  function isub(){for(r=0;r<4;r++)for(c=0;c<4;c++)s[r][c]=_ISBOX[s[r][c]];}
  function ishift(){for(r=1;r<4;r++){var row=s[r].slice();for(c=0;c<4;c++)s[r][c]=row[(c-r+4)%4];}}
  function imix(){for(c=0;c<4;c++){var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
    s[0][c]=_gmul(a0,14)^_gmul(a1,11)^_gmul(a2,13)^_gmul(a3,9);
    s[1][c]=_gmul(a0,9)^_gmul(a1,14)^_gmul(a2,11)^_gmul(a3,13);
    s[2][c]=_gmul(a0,13)^_gmul(a1,9)^_gmul(a2,14)^_gmul(a3,11);
    s[3][c]=_gmul(a0,11)^_gmul(a1,13)^_gmul(a2,9)^_gmul(a3,14);}}
  ark(Nr);
  for(var round=Nr-1;round>=1;round--){ishift();isub();ark(round);imix();}
  ishift();isub();ark(0);
  var out=[];for(i=0;i<16;i++)out[i]=s[i%4][(i/4)|0];return out;
}
function _aesCbcDecrypt(ct,key,iv){
  var ks=_keyExp(key),out=[],prev=iv.slice(),off,i;
  for(off=0;off+16<=ct.length;off+=16){
    var block=ct.slice(off,off+16),dec=_invCipher(block,ks);
    for(i=0;i<16;i++)out.push(dec[i]^prev[i]);
    prev=block;
  }
  var pad=out[out.length-1];
  if(pad>0&&pad<=16)out=out.slice(0,out.length-pad);
  return out;
}
function _padBytes(s, n) {
  var out = [], i;
  for (i = 0; i < n; i++) out[i] = 0;
  var b = String(s || '');
  for (i = 0; i < b.length && i < n; i++) out[i] = b.charCodeAt(i) & 0xff;
  return out;
}
function _bytesToStr(b){var s='',i=0;while(i<b.length){var c=b[i++];if(c<0x80)s+=String.fromCharCode(c);else if(c<0xE0)s+=String.fromCharCode(((c&0x1f)<<6)|(b[i++]&0x3f));else if(c<0xF0)s+=String.fromCharCode(((c&0x0f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f));else{var cp=((c&0x07)<<18)|((b[i++]&0x3f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f);cp-=0x10000;s+=String.fromCharCode(0xD800+(cp>>10),0xDC00+(cp&0x3FF));}}return s;}
function _cipher(inb,ks){
  var w=ks.w,Nr=ks.Nr,s=[[],[],[],[]],r,c,i;
  for(i=0;i<16;i++)s[i%4][(i/4)|0]=inb[i];
  function ark(round){for(c=0;c<4;c++)for(r=0;r<4;r++)s[r][c]^=w[round*4+c][r];}
  function sub(){for(r=0;r<4;r++)for(c=0;c<4;c++)s[r][c]=_SBOX[s[r][c]];}
  function shift(){for(r=1;r<4;r++){var row=s[r].slice();for(c=0;c<4;c++)s[r][c]=row[(c+r)%4];}}
  function mix(){for(c=0;c<4;c++){var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
    s[0][c]=_gmul(a0,2)^_gmul(a1,3)^a2^a3;
    s[1][c]=a0^_gmul(a1,2)^_gmul(a2,3)^a3;
    s[2][c]=a0^a1^_gmul(a2,2)^_gmul(a3,3);
    s[3][c]=_gmul(a0,3)^a1^a2^_gmul(a3,2);}}
  ark(0);
  for(var round=1;round<Nr;round++){sub();shift();mix();ark(round);}
  sub();shift();ark(Nr);
  var out=[];for(i=0;i<16;i++)out[i]=s[i%4][(i/4)|0];return out;
}
function _gmul128(x,y){
  var z=[],v=y.slice(),i,j,k;for(i=0;i<16;i++)z.push(0);
  for(i=0;i<16;i++){
    for(j=7;j>=0;j--){
      if((x[i]>>j)&1){for(k=0;k<16;k++)z[k]^=v[k];}
      var lsb=v[15]&1;
      for(k=15;k>0;k--)v[k]=((v[k]>>>1)|((v[k-1]&1)<<7))&0xff;
      v[0]=(v[0]>>>1)&0x7f;
      if(lsb)v[0]^=0xe1;
    }
  }
  return z;
}
function _ghash(h,data){
  var y=[],i,off;for(i=0;i<16;i++)y.push(0);
  for(off=0;off+16<=data.length;off+=16){
    for(i=0;i<16;i++)y[i]^=data[off+i];
    y=_gmul128(y,h);
  }
  return y;
}
function _aesGcmDecrypt(data,key){
  if(!data||data.length<28)return null;
  var ks=_keyExp(key),i,off;
  var nonce=data.slice(0,12),tag=data.slice(data.length-16),ct=data.slice(12,data.length-16);
  var H=_cipher([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],ks);
  var J0=nonce.concat([0,0,0,1]);
  var gdata=ct.slice();while(gdata.length%16)gdata.push(0);
  var bitLen=ct.length*8;
  gdata=gdata.concat([0,0,0,0,0,0,0,0,0,0,0,0,(bitLen>>>24)&0xff,(bitLen>>>16)&0xff,(bitLen>>>8)&0xff,bitLen&0xff]);
  var S=_ghash(H,gdata);
  var EJ0=_cipher(J0,ks);
  for(i=0;i<16;i++){if((S[i]^EJ0[i])!==tag[i])return null;}
  var out=[],ctr=J0.slice();
  for(off=0;off<ct.length;off+=16){
    var n=((ctr[12]<<24)|(ctr[13]<<16)|(ctr[14]<<8)|ctr[15])+1;
    ctr[12]=(n>>>24)&0xff;ctr[13]=(n>>>16)&0xff;ctr[14]=(n>>>8)&0xff;ctr[15]=n&0xff;
    var stream=_cipher(ctr,ks);
    var take=Math.min(16,ct.length-off);
    for(var j=0;j<take;j++)out.push(ct[off+j]^stream[j]);
  }
  return out;
}

function decryptVidzeeUrl(encryptedUrl, secret) {
    try {
        var decodedString = _atob(encryptedUrl);
        var parts = decodedString.split(":");
        if (parts.length < 2) return null;
        var iv = _arr(base64ToBytes(parts[0]));
        var ct = _arr(base64ToBytes(parts[1]));
        if (!ct.length) return null;
        return _bytesToStr(_aesCbcDecrypt(ct, _padBytes(secret, 32), iv));
    } catch(e) { return null; }
}
function decryptVidrockUrl(payload) {
    try {
        var keyHex = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";
        var keyBytes = [];
        for (var i = 0; i + 1 < keyHex.length; i += 2) keyBytes.push(parseInt(keyHex.substr(i, 2), 16));
        var b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4) b64 += "=";
        var pt = _aesGcmDecrypt(_arr(base64ToBytes(b64)), keyBytes);
        return pt ? _bytesToStr(pt) : null;
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
        var key = _readSetting('tmdbApiKey') || TMDB_FALLBACK_KEY;
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
    var season = parseInt(item.season, 10); if (isNaN(season) || season <= 0) season = null; // null = movie; extractors branch on season == null
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
        var data = await fetchJson(url, { headers: { "Referer": referer } });
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
    // Servers are independent — resolve them in parallel, keep server order.
    var perServer = await Promise.all([0,1,2,4,5,6,7].map(function(sr) {
        return (async function() {
            var out = [];
            try {
                var url = season == null ? VIDZEE + "/api/server?id=" + tmdbId + "&sr=" + sr : VIDZEE + "/api/server?id=" + tmdbId + "&sr=" + sr + "&ss=" + season + "&ep=" + episode;
                var data = await fetchJson(url);
                if (!data) return out;
                var globalHeaders = {};
                if (data.headers) { for (var h in data.headers) globalHeaders[h] = data.headers[h]; }
                if (data.url) for (var j = 0; j < data.url.length; j++) {
                    var item = data.url[j];
                    if (item.link) {
                        var finalUrl = decryptVidzeeUrl(item.link, secret);
                        if (finalUrl && finalUrl.indexOf("https:") > -1) {
                            var headersMap = Object.assign({}, globalHeaders);
                            out.push({ url: fixUrl(finalUrl), quality: "1080p", label: "[VidZee " + (item.name||"") + " (" + (item.lang||"Unknown") + ")]", container: item.type === "hls" || finalUrl.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: headersMap });
                        }
                    }
                }
                if (data.tracks) data.tracks.forEach(function(t) { if (t.url && t.lang) subCallback({ url: fixUrl(t.url), lang: t.lang }); });
            } catch(e) {}
            return out;
        })();
    }));
    var out = [];
    perServer.forEach(function(l) { l.forEach(function(s) { out.push(s); }); });
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
        var searchRes = await fetchJson(KISSKH + "/api/DramaList/Search?q=" + encodeURIComponent(title) + "&type=" + (season == null ? "2" : "1"), { headers: { "Referer": KISSKH + "/" } });
        if (!searchRes || !searchRes.length) return [];
        var detailRes = await fetchJson(KISSKH + "/api/DramaList/Drama/" + searchRes[0].id + "?isq=false", { headers: { "Referer": KISSKH + "/" } });
        if (!detailRes || !detailRes.episodes) return [];
        var targetEp = detailRes.episodes.find(function(e) { return e.number === (episode || 1); });
        if (!targetEp) return [];
        var encRes = await fetchJson(MULTI_DECRYPT + "/enc-kisskh?text=" + targetEp.id + "&type=vid", { headers: { "Referer": KISSKH } });
        if (!encRes || !encRes.result) return [];
        var streamRes = await fetchJson(KISSKH + "/api/DramaList/Episode/" + targetEp.id + ".png?err=false&ts=&time=&kkey=" + encRes.result, { headers: { "Referer": KISSKH } });
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
        // enc-dec.app now requires the two-stage flow (stage=1 -> POST -> stage=2);
        // the old single call returns HTTP 400 "Expected query: text, stage" everywhere.
        var stage1 = await fetchJson(MULTI_DECRYPT + "/enc-vidfast?text=" + encodeURIComponent(m[1]) + "&stage=1");
        if (!stage1 || !stage1.result || !stage1.result.stage1) return [];
        var stage1Text = await fetchText(stage1.result.stage1, { method: "POST", headers: Object.assign({}, headers, { "X-CSRF-Token": stage1.result.token, "X-Requested-With": "XMLHttpRequest" }) });
        if (!stage1Text) return [];
        var data = await fetchJson(MULTI_DECRYPT + "/enc-vidfast?text=" + encodeURIComponent(stage1Text) + "&stage=2");
        if (!data || !data.result || !data.result.servers || !data.result.stream) return [];
        var postHeaders = Object.assign({}, headers, { "X-CSRF-Token": data.result.token, "X-Requested-With": "XMLHttpRequest" });
        var serversDec = await fetchJson(MULTI_DECRYPT + "/dec-vidfast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: await fetchText(data.result.servers, { method: "POST", headers: postHeaders }) }) });
        if (!serversDec || !serversDec.result) return [];
        // Servers are independent — resolve them in parallel, keep server order.
        var perServer = await Promise.all(serversDec.result.map(function(server) {
            return (async function() {
                if (!server.data) return null;
                try {
                    var streamEnc = await fetchText(data.result.stream + "/" + server.data, { method: "POST", headers: postHeaders });
                    var streamDec = await fetchJson(MULTI_DECRYPT + "/dec-vidfast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: streamEnc }) });
                    if (streamDec.result && streamDec.result.url) {
                        if (streamDec.result.tracks) streamDec.result.tracks.forEach(function(t) { if (t.file && t.label) subCallback({ url: fixUrl(t.file), lang: t.label }); });
                        return { url: fixUrl(streamDec.result.url), quality: streamDec.result.is4kAvailable ? "2160p" : "1080p", label: "[Vidfast " + (server.name||"") + "]", container: streamDec.result.url.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: postHeaders };
                    }
                } catch(e) {}
                return null;
            })();
        }));
        var out = [];
        perServer.forEach(function(s) { if (s) out.push(s); });
        return out;
    } catch(e) { return []; }
}

async function getHexa(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var keyBytes = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) { try { crypto.getRandomValues(keyBytes); } catch(e) {} }
    else { for (var rb = 0; rb < 32; rb++) keyBytes[rb] = Math.floor(Math.random() * 256); }
    var key = ""; for (var kb = 0; kb < 32; kb++) { var hb = keyBytes[kb].toString(16); key += (hb.length === 1 ? "0" : "") + hb; }
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
        // Servers are independent — resolve them in parallel, one bad server
        // no longer discards the rest. NOTE: the /g step needs a binary fetch
        // (arrayBuffer); the app's fetch bridge is text-only, so in-app this
        // extractor stays empty until the bridge grows a base64 mode.
        var perServer = await Promise.all(serversRes.servers.map(function(sv) {
            return (async function() {
            var out = [];
            var server = sv.name;
            try {
            var encRes = await fetchJson(MULTI_DECRYPT + "/enc-cinejoy?url=" + encodeURIComponent(CINEJOY + "/?title=" + encodeURIComponent(title||"") + "&type=" + (season != null ? "series" : "movie") + "&year=" + (year||"") + "&imdb=" + (imdbId||"") + "&tmdb=" + (tmdbId||"") + "&server=" + server + (season != null ? "&season=" + season + "&episode=" + episode : "")));
            if (!encRes || !encRes.result || !encRes.result.data) return out;
            var encryptedResponse = await fetch(CINEJOY + "/g", { method: "POST", headers: headers, body: base64UrlToBytes(encRes.result.data) });
            var decRes = await fetchJson(MULTI_DECRYPT + "/dec-cinejoy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: bytesToBase64Url(new Uint8Array(await encryptedResponse.arrayBuffer())), state: encRes.result.state }) });
            if (!decRes || !decRes.result || !decRes.result.data || decRes.result.data.error) return out;
            decRes.result.data.stream.forEach(function(st) {
                if (st.type === "hls" && st.playlist) out.push({ url: fixUrl(st.playlist), quality: "1080p", label: "[Cinejoy " + server + "]", container: "hls", headers: headers });
                else if (st.type === "file" && st.qualities) for (var qk in st.qualities) if (st.qualities[qk].url) out.push({ url: fixUrl(st.qualities[qk].url), quality: qk === "4k" ? "2160p" : qk === "1080" ? "1080p" : qk === "720" ? "720p" : qk === "480" ? "480p" : "Auto", label: "[Cinejoy " + server + " " + qk + "]", container: st.qualities[qk].url.indexOf(".m3u8") > -1 ? "hls" : "unknown", headers: headers });
                if (st.captions) st.captions.forEach(function(c) { if (c.url) subCallback({ url: fixUrl(c.url), lang: c.language || c.id || "Unknown" }); });
            });
            } catch(e) {}
            return out;
            })();
        }));
        var out = [];
        perServer.forEach(function(l) { l.forEach(function(s) { out.push(s); }); });
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
    var safe = function(name, fn) { return withTimeout(fn, 7000, [], name).catch(function(e) { console.log("CineStream2: " + name + " failed: " + (e && e.message ? e.message : e)); return []; }); };
    
    // Standard providers (use IMDB/TMDB)
    if (_bool('enableVaPlayer', true)) tasks.push(safe("VaPlayer", getVaPlayer(meta.imdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableVidrock', true)) tasks.push(safe("Vidrock", getVidrock(meta.tmdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableVidzee', true)) tasks.push(safe("Vidzee", getVidzee(meta.tmdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableShowbox', false)) tasks.push(safe("Showbox", getShowbox(meta.imdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableVidfast', true)) tasks.push(safe("Vidfast", getVidfast(meta.tmdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableHexa', true)) tasks.push(safe("Hexa", getHexa(meta.tmdbId, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableCinejoy', true)) tasks.push(safe("Cinejoy", getCinejoy(meta.title, meta.imdbId, meta.tmdbId, meta.year, parsed.season, parsed.episode, subCallback)));
    
    // Anime providers (use title + absolute episode)
    if (_bool('enableAnikoto', true)) tasks.push(safe("Anikoto", getAnikoto(meta.title, meta.year, parsed.episode, subCallback)));
    if (_bool('enableKissKH', true)) tasks.push(safe("KissKH", getKissKH(meta.title, meta.year, parsed.season, parsed.episode, subCallback)));
    if (_bool('enableAnimeSalt', true)) tasks.push(safe("AnimeSalt", getAnimesalt(meta.title, parsed.season, parsed.episode, subCallback)));
    
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
        version: '2.1.3',
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
