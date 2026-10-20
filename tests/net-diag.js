// tests/net-diag.js — run with: node tests/net-diag.js
'use strict';

const https = require('https');
const dns   = require('dns').promises;

const DOMAINS = [
  'v3-cinemeta.strem.io',
  'api.themoviedb.org',
  'streamdata.vaplayer.ru',
  'vidlink.pro',
  'enc-dec.app',
  'vidrock.ru',
  'vidfast.vc',
  'vidcore.io',
  'api.meowtv.ru',
  'x.eat-peach.sbs',
  'api.shegu.st',
  'showbox.media',
  'www.febbox.com',
  'fsharetv.cc',
  'api.speedracelight.com',
  'arm.haglund.dev'
];

const C = { reset:'\x1b[0m', green:'\x1b[32m', red:'\x1b[31m', yellow:'\x1b[33m', dim:'\x1b[2m' };

function testTLS(host) {
  return new Promise((resolve) => {
    const req = https.request({ host, port: 443, path: '/', method: 'HEAD', timeout: 5000 }, (res) => {
      resolve({ ok: true, status: res.statusCode });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.on('error',   (e) => resolve({ ok: false, reason: e.code || e.message }));
    req.end();
  });
}

async function testDNS(host) {
  try {
    const addrs = await dns.resolve4(host);
    return { ok: addrs.length > 0, addrs: addrs.slice(0, 2) };
  } catch (e) {
    return { ok: false, reason: e.code || e.message };
  }
}

(async () => {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Network reachability from Termux');
  console.log('  Node ' + process.version);
  console.log('═══════════════════════════════════════════════\n');

  for (const host of DOMAINS) {
    const [dnsR, tlsR] = await Promise.all([testDNS(host), testTLS(host)]);
    const dnsStr = dnsR.ok ? C.green + 'DNS ✓' + C.reset + ' ' + C.dim + (dnsR.addrs || []).join(',') + C.reset
                           : C.red + 'DNS ✗ ' + dnsR.reason + C.reset;
    const tlsStr = tlsR.ok ? C.green + 'HTTPS ✓ ' + tlsR.status + C.reset
                           : C.red + 'HTTPS ✗ ' + tlsR.reason + C.reset;
    console.log('  ' + host.padEnd(32) + '  ' + dnsStr + '   ' + tlsStr);
  }
  console.log('');
})();
