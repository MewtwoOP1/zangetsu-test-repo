// tests/one-by-one.js
'use strict';

function safeSetGlobal(n,v){try{Object.defineProperty(global,n,{value:v,configurable:true,writable:true})}catch(e){try{global[n]=v}catch(e2){}}}
safeSetGlobal('bytesToBase64', b => Buffer.from(b).toString('base64'));
safeSetGlobal('bytesFromBase64', s => new Uint8Array(Buffer.from(s, 'base64')));
if (typeof globalThis.TextEncoder === 'undefined') safeSetGlobal('TextEncoder', require('util').TextEncoder);
if (typeof globalThis.TextDecoder === 'undefined') safeSetGlobal('TextDecoder', require('util').TextDecoder);
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) safeSetGlobal('crypto', require('crypto').webcrypto);
safeSetGlobal('__SOURCE_ID', 'cinestream2');
safeSetGlobal('__settings', { cinestream2: { tmdbApiKey: (process.env.TMDB_API_KEY||'').trim() } });

const p = require('../providers/cinestream2.js');
const C = { reset:'\x1b[0m', green:'\x1b[32m', red:'\x1b[31m', yellow:'\x1b[33m', dim:'\x1b[2m' };

async function probe(name, fn) {
  process.stdout.write('  ' + name.padEnd(15) + ' ');
  const t0 = Date.now();
  try {
    const r = await fn();
    const n = Array.isArray(r) ? r.length : (r ? 1 : 0);
    const time = Date.now() - t0;
    if (n > 0) console.log(C.green + '✓ ' + n + ' streams' + C.reset + ' (' + time + 'ms)');
    else       console.log(C.yellow + '○ 0 streams' + C.reset + ' (' + time + 'ms)');
  } catch (e) {
    console.log(C.red + '✗ ' + (e && e.message || e) + C.reset);
  }
}

(async () => {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Per-provider probe — Avatar (tt0499549 / tmdb 19995)');
  console.log('════════════════════════════════════════════════\n');

  await probe('VaPlayer',   () => p._invokeVaPlayer('tt0499549', null, null, () => {}));
  await probe('Vidlink',    () => p._invokeVidlink(19995, null, null, () => {}));
  await probe('Vidrock',    () => p._invokeVidrock(19995, null, null));
  await probe('Peachify',   () => p._invokePeachify(19995, null, null));
  await probe('Meowtv',     () => p._invokeMeowtv(19995, null, null));
  await probe('VidFastPro', () => p._invokeVidFastPro(19995, null, null, () => {}));
  await probe('Vidcore',    () => p._invokeVidcore(19995, null, null, () => {}));
  await probe('Vidup',      () => p._invokeVidup(19995, null, null, () => {}));
  await probe('Fshare',     () => p._invokeFshare('Avatar', 'tt0499549'));
  await probe('Videasy',    () => p._invokeVideasy('Avatar', 19995, 'tt0499549', 2009, null, null, () => {}));
  await probe('Cinejoy',    () => p._invokeCinejoy('Avatar', 'tt0499549', 19995, 2009, null, null, () => {}));

  console.log('');
})();
