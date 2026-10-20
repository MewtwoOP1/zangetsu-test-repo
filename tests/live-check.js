// tests/live-check.js
// Hits real APIs from your phone. Run: node tests/live-check.js
// Node 18+ / Termux friendly.

'use strict';

const path = require('path');

// ── Safe global setter (Node 20 has read-only crypto/fetch) ──────────────
function safeSetGlobal(name, value) {
  try {
    Object.defineProperty(global, name, { value, configurable: true, writable: true, enumerable: false });
  } catch (e1) {
    try { global[name] = value; } catch (e2) {}
  }
}

safeSetGlobal('bytesToBase64', (b) => Buffer.from(b).toString('base64'));
safeSetGlobal('bytesFromBase64', (s) => new Uint8Array(Buffer.from(s, 'base64')));
if (typeof globalThis.TextEncoder === 'undefined') safeSetGlobal('TextEncoder', require('util').TextEncoder);
if (typeof globalThis.TextDecoder === 'undefined') safeSetGlobal('TextDecoder', require('util').TextDecoder);
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
  safeSetGlobal('crypto', require('crypto').webcrypto);
}

// Read Showbox token from env (never commit it)
const SHOWBOX_TOKEN = (process.env.SHOWBOX_TOKEN || '').trim();

safeSetGlobal('__SOURCE_ID', 'cinestream2');
safeSetGlobal('__settings', { cinestream2: { showboxToken: SHOWBOX_TOKEN } });

// ── Load the provider ────────────────────────────────────────────────────
const p = require(path.resolve(__dirname, '..', 'providers', 'cinestream2.js'));

// ── Colored output (uses ANSI escapes — works in Termux) ─────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m'
};
function ok(m)   { console.log('  ' + C.green + '✓' + C.reset + ' ' + m); }
function fail(m) { console.log('  ' + C.red   + '✗' + C.reset + ' ' + m); }
function info(m) { console.log('  ' + C.cyan  + 'ℹ' + C.reset + ' ' + m); }
function hdr(m)  { console.log('\n' + C.bold + '▶ ' + m + C.reset); }

// ── Test cases ───────────────────────────────────────────────────────────
const CASES = [
  { label: 'Avatar (movie)',          imdbId: 'tt0499549', tmdbId: 19995, type: 'movie',  season: 0, episode: 0 },
  { label: 'Interstellar (movie)',    imdbId: 'tt0816692', tmdbId: 157336, type: 'movie', season: 0, episode: 0 },
  { label: 'Breaking Bad S01E01',     imdbId: 'tt0903747', tmdbId: 1396, type: 'series', season: 1, episode: 1 },
  { label: 'Game of Thrones S01E01',  imdbId: 'tt0944947', tmdbId: 1399, type: 'series', season: 1, episode: 1 }
];

async function runCase(c) {
  hdr(c.label + '  [' + c.imdbId + (c.type === 'series' ? ' / S' + c.season + 'E' + c.episode : '') + ']');

  const payload = JSON.stringify({
    imdbId: c.imdbId,
    tmdbId: c.tmdbId,
    type:   c.type,
    season: c.season,
    episode: c.episode
  });

  const t0 = Date.now();
  let streams;
  try {
    streams = await p.getVideoSources(payload, { onSubtitle: () => {} });
  } catch (e) {
    fail('getVideoSources threw: ' + e.message);
    return { label: c.label, count: 0, elapsed: Date.now() - t0, byProvider: {} };
  }
  const elapsed = Date.now() - t0;

  // Group by provider label prefix
  const byProvider = {};
  streams.forEach((s) => {
    const key = (s.label || '?').match(/^\[([^\]]+)\]/);
    const name = key ? key[1] : 'Other';
    if (!byProvider[name]) byProvider[name] = [];
    byProvider[name].push(s);
  });

  const providerNames = Object.keys(byProvider).sort((a, b) => byProvider[b].length - byProvider[a].length);

  if (streams.length === 0) {
    fail('0 streams returned in ' + elapsed + 'ms');
  } else {
    ok(streams.length + ' streams in ' + elapsed + 'ms from ' + providerNames.length + ' providers');
    providerNames.forEach((name) => {
      const list = byProvider[name];
      const qualities = [...new Set(list.map((s) => s.quality))].join(', ');
      console.log('     ' + C.dim + '·' + C.reset + ' ' + name + ' → ' + list.length + ' [' + qualities + ']');
    });
  }

  return { label: c.label, count: streams.length, elapsed, byProvider };
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(C.bold + '\n═══════════════════════════════════════════════════');
  console.log('  CineStream2 LIVE test  —  Node ' + process.version);
  console.log('  Provider version: ' + p.getInfo().version);
  console.log('  Showbox token:    ' + (SHOWBOX_TOKEN ? C.green + 'SET (' + SHOWBOX_TOKEN.length + ' chars)' + C.reset : C.yellow + 'not set' + C.reset));
  console.log('═══════════════════════════════════════════════════' + C.reset);

  const results = [];
  for (const c of CASES) {
    results.push(await runCase(c));
  }

  // Summary table
  hdr('SUMMARY');
  console.log('  ' + C.bold + 'Title                          Streams  Time    Providers' + C.reset);
  console.log('  ' + '─'.repeat(70));
  results.forEach((r) => {
    const prov = Object.keys(r.byProvider).length;
    const colored = r.count > 0 ? C.green + String(r.count).padStart(3) + C.reset : C.red + '  0' + C.reset;
    console.log('  ' + r.label.padEnd(30) + '  ' + colored + '  ' + String(r.elapsed).padStart(4) + 'ms  ' + prov);
  });

  // Final pass/fail
  const totalStreams = results.reduce((a, r) => a + r.count, 0);
  console.log('\n  Total streams across all cases: ' + C.bold + totalStreams + C.reset);
  const pass = results.every((r) => r.count > 0);
  console.log('  ' + (pass ? C.green + '✓ LIVE TEST PASSED' : C.red + '✗ LIVE TEST FAILED — some titles returned 0') + C.reset + '\n');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('\n💥 ' + (e.stack || e)); process.exit(1); });
