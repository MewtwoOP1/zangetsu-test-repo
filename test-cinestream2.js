// test-cinestream2.js
const p = require('./providers/cinestream2.js');

// Stub QuickJS-NG globals for Node.js
global.__SOURCE_ID = 'cinestream2';
global.__settings = { cinestream2: {} };
global.fetch = async () => ({ ok: true, status: 200, body: '{}' });
global.bytesToBase64 = b => Buffer.from(b).toString('base64');
global.bytesFromBase64 = s => new Uint8Array(Buffer.from(s, 'base64'));
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;
global.crypto = require('crypto').webcrypto;

// 1. Info
console.log('name    :', p.getInfo().name);
if (p.getInfo().name !== 'CineStream2') throw new Error('Name mismatch');

// 2. Catalog item — scheme MUST be tmdb://
const item = p._itemFromCinemeta({ id: 'tt0499549', type: 'movie', name: 'Avatar', year: '2009' });
console.log('item.url:', item.url);
if (!item.url.startsWith('tmdb://')) throw new Error('URL scheme is not tmdb://');

// 3. Detail URL parsing — must round-trip
const parsed = p._parseDetailUrl('tmdb://movie/tt0499549');
console.log('parse   :', JSON.stringify(parsed));
if (parsed.kind !== 'movie' || parsed.id !== 'tt0499549') throw new Error('Parse detail URL failed');

// 4. Episode URL — must contain both id and videoId
const ep = p._episodeUrl('series', 'tt0944947', 1399, 1, 2);
const epObj = JSON.parse(ep);
console.log('id/videoId:', epObj.id === epObj.videoId ? 'Match' : 'Mismatch');
if (epObj.id !== epObj.videoId || !epObj.videoId) throw new Error('videoId missing or mismatched');

// 5. MD5 sanity
const md5 = p._md5('hello');
console.log('md5 ok  :', md5 === '5d41402abc4b2a76b9719d911017c592' ? '✓' : '✗');
if (md5 !== '5d41402abc4b2a76b9719d911017c592') throw new Error('MD5 failed');

console.log('✅ All tests passed!');
