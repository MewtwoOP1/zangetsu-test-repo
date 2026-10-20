// cstest.js — end-to-end tester for cinestream2.js v2.4.0
if (typeof globalThis.crypto === 'undefined') {
  try { globalThis.crypto = require('crypto').webcrypto; } catch (e) {}
}
const p = require('./providers/cinestream2.js');

function bar(t) { console.log('-'.repeat(60)); console.log(t); console.log('-'.repeat(60)); }

async function main() {
  const q = process.argv[2] || 'Solo Leveling';
  const s = process.argv[3] ? parseInt(process.argv[3], 10) : 1;
  const e = process.argv[4] ? parseInt(process.argv[4], 10) : 1;
  console.log('Provider:', JSON.stringify(p.getInfo()));
  console.log('Query:', q, 'S:' + s, 'E:' + e);

  bar('1. SEARCH');
  let rs = [];
  try {
    rs = await p.search(q);
    console.log('-> ' + rs.length + ' result(s)');
    rs.slice(0, 6).forEach((r, i) => console.log('  ' + (i + 1) + '. ' + r.title + '  [' + r.type + ']  ' + r.url));
  } catch (err) { console.log('SEARCH ERROR:', err.message); return; }
  if (!rs.length) { console.log('No results.'); return; }

  const pick = rs.find(r => /anime|kitsu/i.test(r.url)) || rs[0];
  console.log('\nSelected:', pick.title, '->', pick.url);

  bar('2. DETAIL');
  let d;
  try {
    d = await p.getDetail(pick.url);
    if (!d) throw new Error('null');
    console.log('Title:', d.title);
    console.log('IDs: imdb=' + (d.imdbId || '-') + ' tmdb=' + (d.tmdbId || '-') + ' kitsu=' + (d.kitsuId || '-') + ' anilist=' + (d.anilistId || '-') + ' mal=' + (d.malId || '-'));
    console.log('Episodes:', d.episodes.length);
    d.episodes.slice(0, 3).forEach(ep => console.log('  ep ' + ep.number + ' (S' + (ep.season ?? '?') + ') - ' + ep.title));
  } catch (err) { console.log('DETAIL ERROR:', err.message); return; }
  if (!d.episodes.length) { console.log('No episodes.'); return; }

  const want = d.episodes.find(ep => ep.number === e) || d.episodes.reduce((a, b) => Math.abs(b.number - e) < Math.abs(a.number - e) ? b : a);
  console.log('\nWill resolve:', want.title);

  bar('3. STREAMS');
  let subs = [], streams = [];
  try {
    streams = await p.getVideoSources(want.url, { onSubtitle: x => subs.push(x) });
  } catch (err) { console.log('STREAMS ERROR:', err.message); }
  console.log('-> ' + streams.length + ' stream(s)');
  streams.forEach((x, i) => {
    console.log('\n[' + (i + 1) + '] ' + x.label + '  q=' + (x.quality || '?') + '  c=' + (x.container || '?'));
    console.log('    ' + x.url.slice(0, 140) + (x.url.length > 140 ? '...' : ''));
  });
  console.log('\n-> ' + subs.length + ' subtitle(s)');

  bar('SUMMARY');
  console.log('Search: ' + (rs.length ? 'OK ' + rs.length : 'none') + ' | Detail: ' + (d.episodes.length ? d.episodes.length + ' eps' : 'none') + ' | Streams: ' + streams.length + ' | Subs: ' + subs.length);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
