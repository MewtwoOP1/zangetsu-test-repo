// tests/cinestream2.test.js
// Zero-dependency test suite for providers/cinestream2.js
// Runs under Node 18+ (uses util.TextEncoder, crypto.webcrypto)

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// ── Global stubs (must run before requiring the provider) ────────────────
global.bytesToBase64 = (b) => Buffer.from(b).toString('base64');
global.bytesFromBase64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
global.TextEncoder = require('util').TextEncoder;
global.TextDecoder = require('util').TextDecoder;
global.crypto = require('crypto').webcrypto;
global.__SOURCE_ID = 'cinestream2';
global.__settings = { cinestream2: {} };
global.fetch = () => Promise.reject(new Error('fetch not stubbed for this test'));

// ── Test harness ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function section(name) {
  console.log('\n▶ ' + name);
}

function test(name, fn) {
  try {
    fn();
    console.log('  ✅ ' + name);
    passed++;
  } catch (e) {
    console.log('  ❌ ' + name);
    console.log('     ' + (e && e.message ? e.message : String(e)));
    failures.push({ name, error: e });
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log('  ✅ ' + name);
    passed++;
  } catch (e) {
    console.log('  ❌ ' + name);
    console.log('     ' + (e && e.message ? e.message : String(e)));
    failures.push({ name, error: e });
    failed++;
  }
}

// ── Mock fetch ───────────────────────────────────────────────────────────
function jsonResponse(obj) {
  // Simulates Zangetsu returning an OBJECT body (the v1.0.4 fix scenario)
  return { ok: true, status: 200, body: obj };
}
function textResponse(str) {
  return { ok: true, status: 200, body: str };
}

function makeMockFetch() {
  return async function mockFetch(url, opts) {
    opts = opts || {};

    // Cinemeta meta
    if (url.includes('cinemeta') && url.includes('/meta/')) {
      return jsonResponse({
        meta: {
          id: 'tt0499549',
          imdb_id: 'tt0499549',
          moviedb_id: 19995,
          name: 'Avatar',
          year: '2009',
          type: 'movie'
        }
      });
    }

    // TMDB find
    if (url.includes('api.themoviedb') && url.includes('/find/')) {
      return jsonResponse({ movie_results: [{ id: 19995 }], tv_results: [] });
    }

    // TMDB detail
    if (url.includes('api.themoviedb') && url.includes('/movie/19995')) {
      return jsonResponse({
        id: 19995, title: 'Avatar', release_date: '2009-12-18', vote_average: 7.5
      });
    }

    // Haglund
    if (url.includes('haglund')) {
      return jsonResponse({ themoviedb: 19995, imdb: 'tt0499549' });
    }

    // AIO metadata
    if (url.includes('aiometadata') || url.includes('baby-beamup')) {
      return jsonResponse({ meta: null });
    }

    // VaPlayer
    if (url.includes('vaplayer') && url.includes('/api.php')) {
      return textResponse(JSON.stringify({
        data: { stream_urls: ['https://example.com/vaplayer.m3u8'] },
        default_subs: [{ lang: 'English', url: 'https://example.com/en.srt' }]
      }));
    }

    // Showbox search (no token → the provider should skip before this)
    if (url.includes('showbox.media')) {
      return textResponse('<html></html>');
    }

    // enc-dec.app (empty in mock → providers return [])
    if (url.includes('enc-dec.app')) {
      return jsonResponse({ result: null, status: 200 });
    }

    // Default: empty OK
    return jsonResponse({});
  };
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  CineStream2 Test Suite');
  console.log('═══════════════════════════════════════════════════');

  // ── 1. Provider file exists & is syntactically valid ──────────────────
  section('File & syntax');
  const providerPath = path.resolve(__dirname, '..', 'providers', 'cinestream2.js');
  test('provider file exists', () => {
    assert.ok(fs.existsSync(providerPath), 'missing ' + providerPath);
  });
  test('syntax is valid', () => {
    const src = fs.readFileSync(providerPath, 'utf8');
    new Function(src); // throws on syntax error
  });

  // ── 2. Load the module ────────────────────────────────────────────────
  section('Module loading');
  let p;
  try {
    p = require(providerPath);
    console.log('  ✅ module loaded');
    passed++;
  } catch (e) {
    console.error('  ❌ module failed to load:', e.message);
    process.exit(1);
  }

  test('exports getInfo', () => assert.strictEqual(typeof p.getInfo, 'function'));
  test('exports getSettings', () => assert.strictEqual(typeof p.getSettings, 'function'));
  test('exports getHome', () => assert.strictEqual(typeof p.getHome, 'function'));
  test('exports search', () => assert.strictEqual(typeof p.search, 'function'));
  test('exports getDetail', () => assert.strictEqual(typeof p.getDetail, 'function'));
  test('exports getEpisodes', () => assert.strictEqual(typeof p.getEpisodes, 'function'));
  test('exports getVideoSources', () => assert.strictEqual(typeof p.getVideoSources, 'function'));
  test('exports getStreams', () => assert.strictEqual(typeof p.getStreams, 'function'));
  test('exports getLinks', () => assert.strictEqual(typeof p.getLinks, 'function'));

  // ── 3. Manifest (getInfo) ─────────────────────────────────────────────
  section('Manifest');
  const info = p.getInfo();
  test("name === 'CineStream2'", () => assert.strictEqual(info.name, 'CineStream2'));
  test("version is '1.0.x'", () => assert.match(info.version, /^1\.0\.\d+$/));
  test("type === 'movie'", () => assert.strictEqual(info.type, 'movie'));
  test('has logo', () => assert.ok(info.logo));

  // ── 4. Settings schema ────────────────────────────────────────────────
  section('Settings');
  const settings = p.getSettings();
  test('is an array', () => assert.ok(Array.isArray(settings)));
  test('has >= 6 entries', () => assert.ok(settings.length >= 6));
  test('contains showboxToken', () => {
    assert.ok(settings.find((s) => s.key === 'showboxToken'));
  });
  test('contains addonUrls', () => {
    assert.ok(settings.find((s) => s.key === 'addonUrls'));
  });
  test('contains tmdbApiKey', () => {
    assert.ok(settings.find((s) => s.key === 'tmdbApiKey'));
  });
  settings.forEach((s) => {
    test('setting "' + s.key + '" has key/label/type', () => {
      assert.ok(s.key);
      assert.ok(s.label);
      assert.ok(s.type);
    });
  });

  // ── 5. _readSetting — namespaced AND flat (v1.0.5 fix) ────────────────
  section('_readSetting — settings fallback');

  global.__settings = { cinestream2: { showboxToken: 'TOKEN_A' } };
  test('reads namespaced __settings[SOURCE_ID][key]', () => {
    assert.strictEqual(p._readSetting('showboxToken'), 'TOKEN_A');
  });

  global.__settings = { showboxToken: 'TOKEN_B' };
  test('reads flat __settings[key] (v1.0.5 fix)', () => {
    assert.strictEqual(p._readSetting('showboxToken'), 'TOKEN_B');
  });

  global.__settings = {};
  test('returns null for missing key', () => {
    assert.strictEqual(p._readSetting('showboxToken'), null);
  });

  // Both work together: namespaced takes priority
  global.__settings = {
    showboxToken: 'FLAT',
    cinestream2: { showboxToken: 'NAMESPACED' }
  };
  test('namespaced takes priority over flat', () => {
    assert.strictEqual(p._readSetting('showboxToken'), 'NAMESPACED');
  });

  // ── 6. _combinedSettings ──────────────────────────────────────────────
  section('_combinedSettings');
  global.__settings = {
    cinestream2: {
      tmdbApiKey: '  abc  ',
      addonUrls: 'https://torrentio.strem.fun/limit=4/manifest.json',
      showboxToken: 'ui=xyz',
      maxStreamsPerAddon: '50',
      allowDownloadLinks: 'true'
    }
  };
  const cfg = p._combinedSettings();
  test('trims tmdbApiKey', () => assert.strictEqual(cfg.tmdbKey, 'abc'));
  test('parses addonUrls', () => assert.strictEqual(cfg.addons.length, 1));
  test('strips manifest.json from addon URLs', () => {
    assert.strictEqual(cfg.addons[0], 'https://torrentio.strem.fun/limit=4');
  });
  test('reads showboxToken', () => assert.strictEqual(cfg.showboxToken, 'ui=xyz'));
  test('parses maxPerAddon as number', () => assert.strictEqual(cfg.maxPerAddon, 50));
  test('parses allowDownload boolean', () => assert.strictEqual(cfg.allowDownload, true));

  // ── 7. _parseAddonUrls ────────────────────────────────────────────────
  section('_parseAddonUrls');
  test('single URL', () => {
    assert.deepStrictEqual(
      p._parseAddonUrls('https://a.com/manifest.json'),
      ['https://a.com']
    );
  });
  test('comma separated', () => {
    const r = p._parseAddonUrls('https://a.com/manifest.json,https://b.com/manifest.json');
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0], 'https://a.com');
    assert.strictEqual(r[1], 'https://b.com');
  });
  test('newline separated', () => {
    const r = p._parseAddonUrls('https://a.com\nhttps://b.com');
    assert.strictEqual(r.length, 2);
  });
  test('deduplicates', () => {
    const r = p._parseAddonUrls('https://a.com/manifest.json\nhttps://a.com/manifest.json');
    assert.strictEqual(r.length, 1);
  });
  test('strips stremio:// prefix', () => {
    const r = p._parseAddonUrls('stremio://a.com/manifest.json');
    assert.strictEqual(r[0], 'https://a.com');
  });
  test('empty input → []', () => assert.deepStrictEqual(p._parseAddonUrls(''), []));
  test('invalid input → []', () => assert.deepStrictEqual(p._parseAddonUrls('not-a-url'), []));

  // ── 8. _parseStreamId ─────────────────────────────────────────────────
  section('_parseStreamId');
  test('parses imdb movie JSON', () => {
    const r = p._parseStreamId(JSON.stringify({ imdbId: 'tt0499549', type: 'movie' }));
    assert.strictEqual(r.type, 'movie');
    assert.ok(r.ids.includes('tt0499549'));
  });
  test('parses imdb series JSON', () => {
    const r = p._parseStreamId(JSON.stringify({
      imdbId: 'tt0944947', type: 'series', season: 1, episode: 2
    }));
    assert.strictEqual(r.type, 'series');
    assert.strictEqual(r.season, 1);
    assert.strictEqual(r.episode, 2);
    assert.ok(r.ids.includes('tt0944947:1:2'));
    assert.ok(r.ids.includes('tt0944947'));
  });
  test('parses tmdb-only JSON via moviedb_id', () => {
    const r = p._parseStreamId(JSON.stringify({ moviedb_id: 19995, type: 'movie' }));
    assert.ok(r.ids.includes('19995'));
  });
  test('parses tmdbId field', () => {
    const r = p._parseStreamId(JSON.stringify({ tmdbId: 19995, type: 'movie' }));
    assert.ok(r.ids.includes('19995'));
  });
  test('honours videoId', () => {
    const r = p._parseStreamId(JSON.stringify({ videoId: 'tt0499549', type: 'movie' }));
    assert.ok(r.ids.includes('tt0499549'));
  });
  test('empty object → no ids', () => {
    const r = p._parseStreamId(JSON.stringify({}));
    assert.strictEqual(r.ids.length, 0);
  });

  // ── 9. _parseDetailUrl ────────────────────────────────────────────────
  section('_parseDetailUrl');
  test('tmdb://movie/tt<id>', () => {
    const r = p._parseDetailUrl('tmdb://movie/tt0499549');
    assert.strictEqual(r.kind, 'movie');
    assert.strictEqual(r.id, 'tt0499549');
  });
  test('tmdb://tv/tt<id>', () => {
    const r = p._parseDetailUrl('tmdb://tv/tt0944947');
    assert.strictEqual(r.kind, 'series');
  });
  test('tmdb://movie/<numeric>', () => {
    const r = p._parseDetailUrl('tmdb://movie/19995');
    assert.strictEqual(r.kind, 'tmdb');
    assert.strictEqual(r.type, 'movie');
    assert.strictEqual(r.id, '19995');
  });
  test('tmdb://tv/<numeric>', () => {
    const r = p._parseDetailUrl('tmdb://tv/1399');
    assert.strictEqual(r.kind, 'tmdb');
    assert.strictEqual(r.type, 'tv');
  });
  test('bare imdb id', () => {
    const r = p._parseDetailUrl('tt0499549');
    assert.strictEqual(r.kind, 'movie');
    assert.strictEqual(r.id, 'tt0499549');
  });
  test('invalid → null', () => assert.strictEqual(p._parseDetailUrl('garbage'), null));

  // ── 10. _episodeUrl — both id and videoId ────────────────────────────
  section('_episodeUrl');
  test('movie episode has id + videoId', () => {
    const s = p._episodeUrl('movie', 'tt0499549', 19995, 0, 0);
    const obj = JSON.parse(s);
    assert.strictEqual(obj.id, obj.videoId);
    assert.strictEqual(obj.imdbId, 'tt0499549');
    assert.strictEqual(obj.tmdbId, 19995);
    assert.strictEqual(obj.type, 'movie');
  });
  test('series episode has season + episode', () => {
    const s = p._episodeUrl('series', 'tt0944947', 1399, 1, 2);
    const obj = JSON.parse(s);
    assert.strictEqual(obj.season, 1);
    assert.strictEqual(obj.episode, 2);
    assert.strictEqual(obj.type, 'series');
    assert.strictEqual(obj.tmdbIsTv, true);
  });
  test('round-trips through _parseStreamId', () => {
    const s = p._episodeUrl('series', 'tt0944947', 1399, 1, 2);
    const parsed = p._parseStreamId(s);
    assert.ok(parsed.ids.includes('tt0944947:1:2'));
    assert.ok(parsed.ids.includes('tt0944947'));
    assert.ok(parsed.ids.includes('1399'));
  });

  // ── 11. _tmdbUrl ─────────────────────────────────────────────────────
  section('_tmdbUrl');
  test("movie → 'tmdb://movie/...'", () => {
    assert.strictEqual(p._tmdbUrl('movie', 'tt123'), 'tmdb://movie/tt123');
  });
  test("tv → 'tmdb://tv/...'", () => {
    assert.strictEqual(p._tmdbUrl('tv', 'tt123'), 'tmdb://tv/tt123');
  });
  test("series → 'tmdb://tv/...'", () => {
    assert.strictEqual(p._tmdbUrl('series', 'tt123'), 'tmdb://tv/tt123');
  });

  // ── 12. Crypto / hashing helpers ─────────────────────────────────────
  section('Crypto helpers');
  test("_md5('hello') matches known hash", () => {
    assert.strictEqual(p._md5('hello'), '5d41402abc4b2a76b9719d911017c592');
  });
  test("_md5('') matches known hash", () => {
    assert.strictEqual(p._md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  });
  test('_md5 returns 32-char hex', () => {
    assert.match(p._md5('test'), /^[a-f0-9]{32}$/);
  });

  await testAsync('peachifyDecrypt handles garbage without throwing', async () => {
    const r = await p.peachifyDecrypt('garbage.input.here');
    assert.ok(r === null || typeof r === 'string');
  });
  await testAsync('decryptVidrockUrl handles garbage without throwing', async () => {
    const r = await p.decryptVidrockUrl('invalid-base64!!');
    assert.ok(r === null || typeof r === 'string');
  });

  // ── 13. _toZangetsuStream ─────────────────────────────────────────────
  section('_toZangetsuStream');
  test('parses quality from title', () => {
    const r = p._toZangetsuStream({
      name: 'Test',
      url: 'https://x.com/a.m3u8',
      title: 'Movie 1080p'
    }, 'TestAddon', false);
    assert.strictEqual(r.quality, '1080p');
    assert.strictEqual(r.container, 'hls');
  });
  test('maps 4K → 2160p', () => {
    const r = p._toZangetsuStream({
      url: 'https://x.com/a.mp4',
      name: '4K rip'
    }, 'Test', false);
    assert.strictEqual(r.quality, '2160p');
    assert.strictEqual(r.container, 'mp4');
  });
  test('defaults quality to Auto', () => {
    const r = p._toZangetsuStream({ url: 'https://x.com/a', name: 'x' }, 'T', false);
    assert.strictEqual(r.quality, 'Auto');
  });
  test('extracts headers from behaviorHints.proxyHeaders.request', () => {
    const r = p._toZangetsuStream({
      url: 'https://x.com/a.m3u8',
      behaviorHints: {
        proxyHeaders: { request: { Referer: 'https://ref.com', 'User-Agent': 'UA' } }
      }
    }, 'T', false);
    assert.strictEqual(r.headers.Referer, 'https://ref.com');
    assert.strictEqual(r.headers['User-Agent'], 'UA');
  });
  test('rejects download links when allowDownload=false', () => {
    const r = p._toZangetsuStream({
      url: 'https://video-downloads.googleusercontent.com/x',
      name: 'x'
    }, 'T', false);
    assert.strictEqual(r, null);
  });
  test('keeps download links when allowDownload=true', () => {
    const r = p._toZangetsuStream({
      url: 'https://video-downloads.googleusercontent.com/x',
      name: 'x'
    }, 'T', true);
    assert.ok(r);
  });
  test('returns null for missing url', () => {
    assert.strictEqual(p._toZangetsuStream({ name: 'x' }, 'T', false), null);
  });

  // ── 14. End-to-end with mocked fetch ─────────────────────────────────
  section('End-to-end stream resolution');
  global.__settings = {
    cinestream2: {
      // No showboxToken → Showbox should skip cleanly
      addonUrls: ''
    }
  };

  global.fetch = makeMockFetch();

  const startTime = Date.now();
  let streams;
  try {
    streams = await p.getVideoSources(
      JSON.stringify({
        imdbId: 'tt0499549',
        tmdbId: 19995,
        type: 'movie',
        season: 0,
        episode: 0
      }),
      {}
    );
  } catch (e) {
    console.error('  ❌ getVideoSources threw:', e.message);
    process.exit(1);
  }
  const elapsed = Date.now() - startTime;

  test('returns an array', () => assert.ok(Array.isArray(streams)));
  test('returns at least 1 stream from VaPlayer', () => {
    assert.ok(streams.length >= 1, 'expected >=1 stream, got ' + streams.length);
  });
  test('all streams have a url', () => {
    streams.forEach((s) => assert.ok(s.url, 'missing url'));
  });
  test('all streams have a quality', () => {
    streams.forEach((s) => assert.ok(s.quality, 'missing quality'));
  });
  test('completes within 5 seconds', () => {
    assert.ok(elapsed < 5000, 'took ' + elapsed + 'ms');
  });
  console.log('     (resolved in ' + elapsed + 'ms, ' + streams.length + ' streams)');

  // ── 15. Settings: no-showbox-token path ───────────────────────────────
  section('Showbox skip (no token)');
  global.__settings = { cinestream2: {} };
  const showboxStreams = await p._invokeShowbox('tt0499549', 0, 0);
  test('returns [] when no token set (no crash)', () => {
    assert.deepStrictEqual(showboxStreams, []);
  });

  // ── Final ────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  RESULTS');
  console.log('  ✅ Passed: ' + passed);
  console.log('  ❌ Failed: ' + failed);
  console.log('═══════════════════════════════════════════════════');

  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => {
      console.log('  • ' + f.name);
      if (f.error && f.error.message) console.log('    ' + f.error.message);
    });
    process.exit(1);
  }

  console.log('\n🎉 All tests passed!\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n💥 Test harness crashed:');
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
