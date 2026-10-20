// tests/cinestream2.test.js
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

function safeSetGlobal(name, value) {
  try { Object.defineProperty(global, name, { value, configurable: true, writable: true, enumerable: false }); }
  catch (e1) { try { global[name] = value; } catch (e2) {} }
}

safeSetGlobal('bytesToBase64', (b) => Buffer.from(b).toString('base64'));
safeSetGlobal('bytesFromBase64', (s) => new Uint8Array(Buffer.from(s, 'base64')));
if (typeof globalThis.TextEncoder === 'undefined') safeSetGlobal('TextEncoder', require('util').TextEncoder);
if (typeof globalThis.TextDecoder === 'undefined') safeSetGlobal('TextDecoder', require('util').TextDecoder);
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) safeSetGlobal('crypto', require('crypto').webcrypto);
if (typeof globalThis.fetch === 'undefined') safeSetGlobal('fetch', () => Promise.reject(new Error('stub')));

safeSetGlobal('__SOURCE_ID', 'cinestream2');
safeSetGlobal('__settings', { cinestream2: {} });

let passed = 0, failed = 0;
const failures = [];
function section(name) { console.log('\n▶ ' + name); }
function test(name, fn) {
  try { fn(); console.log('  ✅ ' + name); passed++; }
  catch (e) { console.log('  ❌ ' + name + '\n     ' + e.message); failures.push({ name, error: e }); failed++; }
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  CineStream2 Test Suite');
  console.log('═══════════════════════════════════════════════════');

  section('File & syntax');
  const providerPath = path.resolve(__dirname, '..', 'providers', 'cinestream2.js');
  test('provider file exists', () => assert.ok(fs.existsSync(providerPath)));
  test('syntax is valid', () => new Function(fs.readFileSync(providerPath, 'utf8')));

  section('Module loading');
  let p;
  try { p = require(providerPath); passed++; console.log('  ✅ module loaded'); }
  catch (e) { console.error('  ❌ module failed:', e.message); process.exit(1); }

  test('exports getInfo', () => assert.strictEqual(typeof p.getInfo, 'function'));
  test('exports getSettings', () => assert.strictEqual(typeof p.getSettings, 'function'));
  test('exports getHome', () => assert.strictEqual(typeof p.getHome, 'function'));
  test('exports search', () => assert.strictEqual(typeof p.search, 'function'));
  test('exports getDetail', () => assert.strictEqual(typeof p.getDetail, 'function'));
  test('exports getVideoSources', () => assert.strictEqual(typeof p.getVideoSources, 'function'));

  section('Manifest');
  const info = p.getInfo();
  test("name === 'CineStream2'", () => assert.strictEqual(info.name, 'CineStream2'));
  test("version is a semver", () => assert.match(info.version, /^\d+\.\d+\.\d+$/));
  test("type === 'movie'", () => assert.strictEqual(info.type, 'movie'));

  section('Settings');
  const settings = p.getSettings();
  test('is an array', () => assert.ok(Array.isArray(settings)));
  test('has >= 5 entries', () => assert.ok(settings.length >= 5));
  test('contains tmdbApiKey', () => assert.ok(settings.find((s) => s.key === 'tmdbApiKey')));

  section('Internal Helpers (if exported)');
  if (typeof p._parseStreamId === 'function') {
    test('_parseStreamId works', () => {
      const r = p._parseStreamId(JSON.stringify({ imdbId: 'tt0499549', type: 'movie' }));
      assert.ok(r.ids.includes('tt0499549'));
    });
  } else {
    test('_parseStreamId exported', () => { throw new Error('missing export'); });
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  ✅ Passed: ' + passed);
  console.log('  ❌ Failed: ' + failed);
  console.log('═══════════════════════════════════════════════════');
  if (failed > 0) process.exit(1);
  console.log('\n🎉 All tests passed!\n');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
