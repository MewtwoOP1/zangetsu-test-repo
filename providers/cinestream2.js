// =============================================================================
//  cinestream2.js — CineStream2 for Zangetsu
//  v2.0.0 — Clean slate port from Kotlin CineStreamExtractors
// =============================================================================

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'cinestream2';

var CINEMETA = "https://v3-cinemeta.strem.io";
var VA_PLAYER = "https://streamdata.vaplayer.ru";
var VIDROCK = "https://vidrock.ru";
var VIDZEE = "https://player.vidzee.wtf";
var MULTI_DECRYPT = "https://enc-dec.app/api";
var SHOWBOX = "https://showbox.media";
var FEBBOX = "https://www.febbox.com";
var ANIKOTO = "https://anikototv.to";
var KISSKH = "https://kisskh.nl";
var ANIMESALT = "https://animesalt.ac";
var VIDFAST = "https://vidfast.vc";
var HEXA = "https://theemoviedb.hexa.su";
var CINEJOY = "https://api.shegu.st";
var CINEJOY_BASE = "https://cinejoy.to";

var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

function withTimeout(promise, ms, fallback) {
    return Promise.race([
        Promise.resolve(promise).catch(function (e) { throw e; }),
        new Promise(function (resolve) { setTimeout(function () { resolve(fallback === undefined ? [] : fallback); }, ms); })
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
            if (domainParts.length > 2) {
                return domainParts[0] + "//" + domainParts[2] + url;
            }
        }
        return base + (base.endsWith("/") ? "" : "/") + url;
    }
    return "https://" + url;
}

async function fetchText(url, opts) {
    opts = opts || {};
    var headers = Object.assign({ "User-Agent": USER_AGENT }, opts.headers || {});
    try {
        var r = await fetch(url, {
            method: opts.method || "GET",
            headers: headers,
            body: opts.body,
            timeoutMs: opts.timeoutMs || 10000
        });
        if (!r) throw new Error("Empty response");
        var text = r.body;
        if (typeof text !== "string") {
            text = JSON.stringify(text);
        }
        return text;
    } catch (e) {
        console.log("[CineStream2] Fetch error: " + url + " - " + e.message);
        return "";
    }
}

function base64ToBytes(b64) {
    try {
        var bin = atob(b64);
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
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function slugify(text) {
    if (!text) return "";
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// =============================================================================
//  CRYPTO FUNCTIONS
// =============================================================================
async function decryptVidzeeUrl(encryptedUrl, secret) {
    try {
        var decodedString = atob(encryptedUrl);
        var parts = decodedString.split(":");
        if (parts.length < 2) return null;
        
        var iv = base64ToBytes(parts[0]);
        var ct = base64ToBytes(parts[1]);
        
        var keyBytes = new Uint8Array(32);
        var secretBytes = new TextEncoder().encode(secret);
        keyBytes.set(secretBytes.slice(0, 32));
        
        var key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, ["decrypt"]);
        var decrypted = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv }, key, ct);
        return new TextDecoder().decode(decrypted);
    } catch(e) { return null; }
}

async function decryptVidrockUrl(payload) {
    try {
        var keyHex = "7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f";
        var keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g).map(function(b) { return parseInt(b, 16); }));
        
        var b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4) b64 += "=";
        var encryptedData = base64ToBytes(b64);
        
        var nonce = encryptedData.slice(0, 12);
        var ct = encryptedData.slice(12);
        
        var key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
        var decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, ct);
        return new TextDecoder().decode(decrypted);
    } catch(e) { return null; }
}

// =============================================================================
//  PROVIDERS
// =============================================================================

async function getVaPlayer(imdbId, season, episode, subCallback) {
    if (!imdbId) return [];
    var referer = "https://nextgencloudfabric.com/";
    var url = season == null 
        ? VA_PLAYER + "/api.php?imdb=" + imdbId + "&type=movie"
        : VA_PLAYER + "/api.php?imdb=" + imdbId + "&type=tv&season=" + season + "&episode=" + episode;
    try {
        var res = await fetchText(url, { "Referer": referer });
        var data = JSON.parse(res);
        var out = [];
        if (data && data.data && data.data.stream_urls) {
            data.data.stream_urls.forEach(function(u) {
                if (u) {
                    out.push({
                        url: fixUrl(u),
                        quality: "Auto",
                        label: "[VaPlayer]",
                        container: u.indexOf(".m3u8") > -1 ? "hls" : "unknown",
                        headers: { "Referer": referer }
                    });
                }
            });
        }
        if (data && data.default_subs) {
            data.default_subs.forEach(function(s) {
                if (s.url) subCallback({ url: fixUrl(s.url), lang: s.lang || s.code || "Unknown" });
            });
        }
        return out;
    } catch(e) { return []; }
}

async function getVidrock(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var type = season == null ? "movie" : "tv";
    var query = season == null ? tmdbId : tmdbId + "_" + season + "_" + episode;
    var url = VIDROCK + "/api/" + type + "/" + query + "/";
    var headers = { "Origin": VIDROCK, "Referer": VIDROCK + "/" };
    try {
        var res = await fetchText(url, { headers: headers });
        var data = JSON.parse(res);
        var out = [];
        for (var key in data) {
            var enc = data[key].url;
            if (enc && enc !== "error" && enc !== "null") {
                var dec = await decryptVidrockUrl(enc);
                if (dec) {
                    out.push({
                        url: fixUrl(dec),
                        quality: "Auto",
                        label: "[Vidrock " + key + "]",
                        container: dec.indexOf(".m3u8") > -1 ? "hls" : "unknown",
                        headers: headers
                    });
                }
            }
        }
        return out;
    } catch(e) { return []; }
}

async function getVidzee(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var secret = atob("QTdrUDl4TTJRdjhMcjROejFIdDZZYzNCdzVKZjBEc1U=");
    var defaultReferer = VIDZEE + "/";
    var servers = [0, 1, 2, 4, 5, 6, 7];
    var out = [];
    for (var i = 0; i < servers.length; i++) {
        var sr = servers[i];
        try {
            var url = season == null
                ? VIDZEE + "/api/server?id=" + tmdbId + "&sr=" + sr
                : VIDZEE + "/api/server?id=" + tmdbId + "&sr=" + sr + "&ss=" + season + "&ep=" + episode;
            var res = await fetchText(url);
            var data = JSON.parse(res);
            var globalHeaders = {};
            if (data.headers) {
                for (var h in data.headers) globalHeaders[h] = data.headers[h];
            }
            if (data.url) {
                for (var j = 0; j < data.url.length; j++) {
                    var item = data.url[j];
                    if (item.link) {
                        var finalUrl = await decryptVidzeeUrl(item.link, secret);
                        if (finalUrl && finalUrl.indexOf("https:") > -1) {
                            var headersMap = Object.assign({}, globalHeaders);
                            var referer = headersMap["referer"] || defaultReferer;
                            var name = item.name || "";
                            var lang = item.lang || "Unknown";
                            var flag = item.flag || "";
                            var displayName = flag ? "[VidZee " + name + " (" + lang + " - " + flag + ")]" : "[VidZee " + name + " (" + lang + ")]";
                            out.push({
                                url: fixUrl(finalUrl),
                                quality: "1080p",
                                label: displayName,
                                container: item.type === "hls" || finalUrl.indexOf(".m3u8") > -1 ? "hls" : "unknown",
                                headers: headersMap
                            });
                        }
                    }
                }
            }
            if (data.tracks) {
                data.tracks.forEach(function(t) {
                    if (t.url && t.lang) subCallback({ url: fixUrl(t.url), lang: t.lang });
                });
            }
        } catch(e) {}
    }
    return out;
}

async function getShowbox(imdbId, season, episode, subCallback) {
    var token = _readSetting("showboxToken");
    if (!imdbId || !token) return [];
    
    var headers = { "User-Agent": USER_AGENT, "Accept": "application/json, text/html, */*" };
    try {
        var searchUrl = SHOWBOX + "/search?keyword=" + imdbId;
        var searchHtml = await fetchText(searchUrl, { headers: headers });
        var hrefMatch = searchHtml.match(/class="film-name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"/) || searchHtml.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*film-name[^"]*"/);
        if (!hrefMatch) return [];
        
        var detailUrl = fixUrl(hrefMatch[1], SHOWBOX);
        var detailHtml = await fetchText(detailUrl, { headers: headers });
        var idMatch = detailHtml.match(/class="heading-name[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/);
        if (!idMatch) return [];
        var mediaId = parseInt(idMatch[1].split("/").pop());
        if (!mediaId) return [];
        
        var type = season != null ? 2 : 1;
        var shareUrl = SHOWBOX + "/index/share_link?id=" + mediaId + "&type=" + type;
        var shareJson = JSON.parse(await fetchText(shareUrl, { headers: headers }));
        if (!shareJson.data || !shareJson.data.link) return [];
        var shareKey = shareJson.data.link.split("/").pop();
        
        var fileListUrl = FEBBOX + "/file/file_share_list?share_key=" + shareKey;
        var fileJson = JSON.parse(await fetchText(fileListUrl, { headers: headers }));
        if (!fileJson.data || !fileJson.data.file_list) return [];
        
        var fileList = fileJson.data.file_list;
        var videoFile = null;
        
        if (season != null && episode != null) {
            var seasonSlug = season < 10 ? "0" + season : "" + season;
            var episodeSlug = episode < 10 ? "0" + episode : "" + episode;
            var seasonFolder = fileList.find(function(f) {
                return f.is_dir && (f.file_name || "").toLowerCase().indexOf("season " + season) > -1 || (f.file_name || "").toLowerCase().indexOf("s" + seasonSlug) > -1;
            }) || fileList.find(function(f) { return f.is_dir; });
            if (!seasonFolder) return [];
            
            var epDataUrl = FEBBOX + "/file/file_share_list?share_key=" + shareKey + "&parent_id=" + seasonFolder.fid;
            var epData = JSON.parse(await fetchText(epDataUrl, { headers: headers }));
            if (!epData.data || !epData.data.file_list) return [];
            
            videoFile = epData.data.file_list.find(function(f) {
                if (f.is_dir) return false;
                var name = (f.file_name || "").toLowerCase();
                return name.indexOf("e" + episodeSlug) > -1 || name.indexOf("ep" + episodeSlug) > -1 || name.indexOf("episode " + episode) > -1;
            }) || epData.data.file_list.find(function(f) { return !f.is_dir; });
        } else {
            videoFile = fileList.find(function(f) { return !f.is_dir; });
        }
        
        if (!videoFile) return [];
        
        var cookieToken = token.indexOf("ui=") === 0 ? token : "ui=" + token;
        var qualHeaders = Object.assign({}, headers, { "Cookie": cookieToken });
        var qualUrl = FEBBOX + "/console/video_quality_list?fid=" + videoFile.fid + "&share_key=" + shareKey;
        var qualJson = JSON.parse(await fetchText(qualUrl, { headers: qualHeaders }));
        if (!qualJson.html) return [];
        
        var out = [];
        var re = /<div[^>]*class="[^"]*file_quality[^"]*"[^>]*>/g;
        var match;
        while ((match = re.exec(qualJson.html)) !== null) {
            var tag = match[0];
            var u = (tag.match(/data-url="([^"]+)"/) || [])[1];
            var q = (tag.match(/data-quality="([^"]+)"/) || [])[1];
            if (u && q) {
                out.push({
                    url: fixUrl(u.replace(/\\\//g, '/')),
                    quality: q === 'ORG' ? '2160p' : (q.match(/\d{3,4}/) || ['Auto'])[0] + 'p',
                    label: '[ShowBox]',
                    container: u.indexOf('.m3u8') > -1 ? 'hls' : 'unknown',
                    headers: headers
                });
            }
        }
        return out;
    } catch(e) { return []; }
}

async function getAnikoto(title, year, episode, subCallback) {
    if (!title) return [];
    var headers = { "referer": ANIKOTO + "/", "x-requested-with": "XMLHttpRequest" };
    try {
        var filterUrl = ANIKOTO + "/filter?keyword=" + encodeURIComponent(title) + "&type=&year%5B%5D=" + (year||"") + "&ep_min=&ep_max=&sort=default";
        var filterHtml = await fetchText(filterUrl);
        var dataTipMatch = filterHtml.match(/class="tip ani"[^>]*data-tip="([^"]+)"/);
        if (!dataTipMatch) return [];
        var dataTip = dataTipMatch[1];
        
        var infoUrl = ANIKOTO + "/ajax/episode/list/" + dataTip + "?vrf=";
        var infoJson = JSON.parse(await fetchText(infoUrl, { headers: headers }));
        var infoHtml = infoJson.result;
        
        var epRegex = new RegExp('data-num="' + (episode||1) + '"[^>]*data-ids="([^"]+)"');
        var epMatch = infoHtml.match(epRegex);
        if (!epMatch) return [];
        var dataIds = epMatch[1];
        
        var serversUrl = ANIKOTO + "/ajax/server/list?servers=" + dataIds;
        var serversJson = JSON.parse(await fetchText(serversUrl, { headers: headers }));
        var serversHtml = serversJson.result;
        
        var linkIdRegex = /data-link-id="([^"]+)"/g;
        var linkIdMatch;
        var out = [];
        while ((linkIdMatch = linkIdRegex.exec(serversHtml)) !== null) {
            var linkId = linkIdMatch[1];
            var serverUrl = ANIKOTO + "/ajax/server?get=" + linkId;
            var serverJson = JSON.parse(await fetchText(serverUrl, { headers: headers }));
            var embedUrl = serverJson.result ? serverJson.result.url : null;
            if (embedUrl) {
                out.push({
                    url: fixUrl(embedUrl),
                    quality: "Auto",
                    label: "[Anikoto]",
                    container: embedUrl.indexOf(".m3u8") > -1 ? "hls" : "unknown",
                    headers: {}
                });
            }
        }
        return out;
    } catch(e) { return []; }
}

async function getKissKH(title, year, season, episode, subCallback) {
    if (!title) return [];
    try {
        var type = season == null ? "2" : "1";
        var searchUrl = KISSKH + "/api/DramaList/Search?q=" + encodeURIComponent(title) + "&type=" + type;
        var searchRes = JSON.parse(await fetchText(searchUrl, { "Referer": KISSKH + "/" }));
        if (!searchRes || !searchRes.length) return [];
        
        var showId = searchRes[0].id;
        var detailUrl = KISSKH + "/api/DramaList/Drama/" + showId + "?isq=false";
        var detailRes = JSON.parse(await fetchText(detailUrl, { "Referer": KISSKH + "/" }));
        if (!detailRes || !detailRes.episodes) return [];
        
        var targetEp = detailRes.episodes.find(function(e) { return e.number === (episode || 1); });
        if (!targetEp) return [];
        
        var encUrl = MULTI_DECRYPT + "/enc-kisskh?text=" + targetEp.id + "&type=vid";
        var encRes = JSON.parse(await fetchText(encUrl, { "Referer": KISSKH }));
        if (!encRes || !encRes.result) return [];
        
        var vidKey = encRes.result;
        var streamUrl = KISSKH + "/api/DramaList/Episode/" + targetEp.id + ".png?err=false&ts=&time=&kkey=" + vidKey;
        var streamRes = JSON.parse(await fetchText(streamUrl, { "Referer": KISSKH }));
        if (!streamRes) return [];
        
        var out = [];
        if (streamRes.Video) {
            out.push({
                url: fixUrl(streamRes.Video),
                quality: "720p",
                label: "[KissKH]",
                container: streamRes.Video.indexOf(".m3u8") > -1 ? "hls" : "unknown",
                headers: { "Referer": KISSKH, "Origin": KISSKH }
            });
        }
        return out;
    } catch(e) { return []; }
}

async function getAnimesalt(title, season, episode, subCallback) {
    var slug = slugify(title);
    if (!slug) return [];
    var headers = { "Referer": ANIMESALT + "/", "User-Agent": USER_AGENT };
    try {
        var url = season == null 
            ? ANIMESALT + "/movies/" + slug + "/"
            : ANIMESALT + "/episode/" + slug + "-" + season + "x" + episode + "/";
        var html = await fetchText(url, { headers: headers });
        var iframeMatch = html.match(/src="(https:\/\/as-cdn\d+\.top\/video\/([a-f0-9]+))"/);
        if (!iframeMatch) return [];
        var playerUrl = iframeMatch[1];
        var hash = iframeMatch[2];
        var playerCdn = playerUrl.split("/video/")[0];
        
        var postData = "hash=" + hash + "&r=" + encodeURIComponent(ANIMESALT + "/");
        var dataRes = await fetchText(playerCdn + "/player/index.php?data=" + hash + "&do=getVideo", {
            method: "POST",
            headers: {
                "Referer": ANIMESALT + "/",
                "Origin": playerCdn,
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: postData
        });
        var data = JSON.parse(dataRes);
        var m3u8 = data.videoSource || data.securedLink;
        if (!m3u8) return [];
        return [{
            url: fixUrl(m3u8),
            quality: "1080p",
            label: "[AnimeSalt]",
            container: "hls",
            headers: headers
        }];
    } catch(e) { return []; }
}

async function getVidfast(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var url = season == null ? VIDFAST + "/movie/" + tmdbId + "/" : VIDFAST + "/tv/" + tmdbId + "/" + season + "/" + episode + "/";
    var headers = { "User-Agent": USER_AGENT, "Referer": VIDFAST + "/" };
    try {
        var html = await fetchText(url, { headers: headers });
        var m = html.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
        if (!m) return [];
        var enc = m[1];
        
        var decUrl = MULTI_DECRYPT + "/enc-vidfast?text=" + encodeURIComponent(enc);
        var decodedData = JSON.parse(await fetchText(decUrl));
        if (!decodedData || !decodedData.result) return [];
        var data = decodedData.result;
        var serversUrl = data.servers;
        var streamBase = data.stream;
        var token = data.token;
        
        var postHeaders = Object.assign({}, headers, { "X-CSRF-Token": token });
        var serversEnc = await fetchText(serversUrl, { method: "POST", headers: postHeaders });
        var serversDec = JSON.parse(await fetchText(MULTI_DECRYPT + "/dec-vidfast", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: serversEnc })
        }));
        
        if (!serversDec || !serversDec.result) return [];
        var out = [];
        for (var i = 0; i < serversDec.result.length; i++) {
            var server = serversDec.result[i];
            if (!server.data) continue;
            var streamEnc = await fetchText(streamBase + "/" + server.data, { method: "POST", headers: postHeaders });
            var streamDec = JSON.parse(await fetchText(MULTI_DECRYPT + "/dec-vidfast", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: streamEnc })
            }));
            if (streamDec && streamDec.result && streamDec.result.url) {
                out.push({
                    url: fixUrl(streamDec.result.url),
                    quality: streamDec.result.is4kAvailable ? "2160p" : "1080p",
                    label: "[Vidfast " + (server.name||"") + "]",
                    container: streamDec.result.url.indexOf(".m3u8") > -1 ? "hls" : "unknown",
                    headers: postHeaders
                });
                if (streamDec.result.tracks) {
                    streamDec.result.tracks.forEach(function(t) { if (t.file && t.label) subCallback({ url: fixUrl(t.file), lang: t.label }); });
                }
            }
        }
        return out;
    } catch(e) { return []; }
}

async function getHexa(tmdbId, season, episode, subCallback) {
    if (!tmdbId) return [];
    var url = season == null ? HEXA + "/api/tmdb/movie/" + tmdbId + "/images" : HEXA + "/api/tmdb/tv/" + tmdbId + "/season/" + season + "/episode/" + episode + "/images";
    var keyBytes = new Uint8Array(32);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(keyBytes);
    var key = Array.from(keyBytes).map(function(b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    try {
        var tokenRes = JSON.parse(await fetchText(MULTI_DECRYPT + "/enc-hexa"));
        var token = tokenRes.result.token;
        var headers = { "User-Agent": USER_AGENT, "Accept": "text/plain", "X-Api-Key": key, "X-Fingerprint-Lite": "e9136c41504646444", "Referer": "https://hexa.su/", "X-Cap-Token": token };
        var encData = await fetchText(url, { headers: headers });
        
        var decRes = JSON.parse(await fetchText(MULTI_DECRYPT + "/dec-hexa", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: encData, key: key })
        }));
        if (!decRes || !decRes.result) return [];
        var out = [];
        decRes.result.sources.forEach(function(src) {
            if (src.url) {
                out.push({
                    url: fixUrl(src.url),
                    quality: "1080p",
                    label: "[Hexa " + (src.server||"") + "]",
                    container: src.url.indexOf(".m3u8") > -1 ? "hls" : "unknown",
                    headers: { "Referer": "https://hexa.su/" }
                });
            }
        });
        return out;
    } catch(e) { return []; }
}

async function getCinejoy(title, imdbId, tmdbId, year, season, episode, subCallback) {
    var isSeries = season != null && episode != null;
    var type = isSeries ? "series" : "movie";
    var headers = { "Accept": "*/*", "Origin": CINEJOY_BASE, "Referer": CINEJOY_BASE + "/", "User-Agent": USER_AGENT };
    try {
        var serversRes = JSON.parse(await fetchText(CINEJOY + "/servers", { headers: headers }));
        if (!serversRes || !serversRes.servers) return [];
        var servers = serversRes.servers.map(function(s) { return s.name; });
        
        var out = [];
        for (var i = 0; i < servers.length; i++) {
            var server = servers[i];
            var targetUrl = CINEJOY + "/?title=" + encodeURIComponent(title||"") + "&type=" + type + "&year=" + (year||"") + "&imdb=" + (imdbId||"") + "&tmdb=" + (tmdbId||"") + "&server=" + server + (isSeries ? "&season=" + season + "&episode=" + episode : "");
            
            var encUrl = MULTI_DECRYPT + "/enc-cinejoy?url=" + encodeURIComponent(targetUrl);
            var encRes = JSON.parse(await fetchText(encUrl));
            if (!encRes || encRes.status !== 200 || !encRes.result || !encRes.result.data) continue;
            
            var decodedBytes = base64UrlToBytes(encRes.result.data);
            var encryptedResponse = await fetch(CINEJOY + "/g", { method: "POST", headers: headers, body: decodedBytes });
            var arrayBuffer = await encryptedResponse.arrayBuffer();
            var b64Encrypted = bytesToBase64Url(new Uint8Array(arrayBuffer));
            
            var decRes = JSON.parse(await fetchText(MULTI_DECRYPT + "/dec-cinejoy", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: b64Encrypted, state: encRes.result.state })
            }));
            if (!decRes || !decRes.result || !decRes.result.data || decRes.result.data.error) continue;
            
            var streams = decRes.result.data.stream || [];
            streams.forEach(function(st) {
                if (st.type === "hls" && st.playlist) {
                    out.push({ url: fixUrl(st.playlist), quality: "1080p", label: "[Cinejoy " + server + "]", container: "hls", headers: headers });
                } else if (st.type === "file" && st.qualities) {
                    for (var qk in st.qualities) {
                        var q = st.qualities[qk];
                        if (q.url) {
                            out.push({
                                url: fixUrl(q.url),
                                quality: qk === "4k" ? "2160p" : qk === "1080" ? "1080p" : qk === "720" ? "720p" : qk === "480" ? "480p" : "Auto",
                                label: "[Cinejoy " + server + " " + qk + "]",
                                container: q.url.indexOf(".m3u8") > -1 ? "hls" : "unknown",
                                headers: headers
                            });
                        }
                    }
                }
                if (st.captions) {
                    st.captions.forEach(function(c) {
                        if (c.url) subCallback({ url: fixUrl(c.url), lang: c.language || c.id || "Unknown" });
                    });
                }
            });
        }
        return out;
    } catch(e) { return []; }
}

// =============================================================================
//  ORCHESTRATOR & METADATA
// =============================================================================
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
    if (imdb) { if (type === 'series' && season > 0 && episode > 0) add(imdb + ':' + season + ':' + episode); add(imdb); }
    if (tmdb) { add(String(tmdb)); add('tmdb:' + (type === 'series' ? 'series' : 'movie') + ':' + String(tmdb)); if (type === 'series' && season > 0 && episode > 0) add('tmdb:series:' + String(tmdb) + ':' + season + ':' + episode); }
    return { ids: ids, type: type, season: season, episode: episode, imdbId: imdb || null, tmdbId: tmdb || null };
}

async function _resolveMeta(parsed) {
    var meta = { title: null, year: null, imdbId: parsed.imdbId, tmdbId: parsed.tmdbId };
    if (!meta.imdbId && !meta.tmdbId) return meta;
    
    if (meta.imdbId) {
        try {
            var res = await fetchText(CINEMETA + "/meta/" + (parsed.type === "series" ? "series" : "movie") + "/" + meta.imdbId + ".json");
            var data = JSON.parse(res);
            if (data && data.meta) {
                meta.title = data.meta.name || (data.meta.aliases && data.meta.aliases[0]);
                meta.year = parseInt(data.meta.releaseInfo || data.meta.year);
                if (!meta.tmdbId && data.meta.moviedb_id) meta.tmdbId = data.meta.moviedb_id;
            }
        } catch(e) {}
    }
    
    if (meta.tmdbId && !meta.title) {
        try {
            var res2 = await fetchText("https://api.themoviedb.org/3/" + (parsed.type === "series" ? "tv" : "movie") + "/" + meta.tmdbId);
            var data2 = JSON.parse(res2);
            if (data2) {
                if (!meta.title) meta.title = data2.title || data2.name;
                if (!meta.year) meta.year = parseInt((data2.release_date || data2.first_air_date || "").substring(0, 4));
            }
        } catch(e) {}
    }
    return meta;
}

async function getVideoSources(episodeUrl, opts) {
    opts = opts || {};
    var parsed = _parseStreamId(episodeUrl);
    if (!parsed.ids.length) return [];
    
    var meta = await _resolveMeta(parsed);
    var subs = [];
    var subCallback = function(s) { if (s && s.url) subs.push(s); };
    
    // List of all working providers ported from Kotlin
    var tasks = [
        getVaPlayer(meta.imdbId, parsed.season, parsed.episode, subCallback),
        getVidrock(meta.tmdbId, parsed.season, parsed.episode, subCallback),
        getVidzee(meta.tmdbId, parsed.season, parsed.episode, subCallback),
        getShowbox(meta.imdbId, parsed.season, parsed.episode, subCallback),
        getVidfast(meta.tmdbId, parsed.season, parsed.episode, subCallback),
        getHexa(meta.tmdbId, parsed.season, parsed.episode, subCallback),
        getCinejoy(meta.title, meta.imdbId, meta.tmdbId, meta.year, parsed.season, parsed.episode, subCallback),
        getAnikoto(meta.title, meta.year, parsed.episode, subCallback),
        getKissKH(meta.title, meta.year, parsed.season, parsed.episode, subCallback),
        getAnimesalt(meta.title, parsed.season, parsed.episode, subCallback)
    ];
    
    // Run all concurrently with a strict 15-second timeout per provider
    var results = await Promise.all(tasks.map(function(t) { return withTimeout(t, 15000, []); }));
    
    var out = [];
    var seen = {};
    results.forEach(function(list) {
        if (!list) return;
        list.forEach(function(s) {
            if (s && s.url && !seen[s.url]) {
                seen[s.url] = true;
                out.push(s);
            }
        });
    });
    
    if (typeof opts.onSubtitle === 'function') {
        var subSeen = {};
        subs.forEach(function(s) {
            if (!subSeen[s.url]) {
                subSeen[s.url] = true;
                opts.onSubtitle(s);
            }
        });
    } else if (typeof opts.subtitleCallback === 'function') {
        var subSeen2 = {};
        subs.forEach(function(s) {
            if (!subSeen2[s.url]) {
                subSeen2[s.url] = true;
                opts.subtitleCallback(s);
            }
        });
    }
    
    console.log("CineStream2 DONE: " + out.length + " streams | " + (meta.title || "?") + " | imdb=" + (meta.imdbId || "?"));
    return out;
}

// =============================================================================
//  EXPORTS
// =============================================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        version: '2.0.0',
        getInfo: function() {
            return {
                name: 'CineStream2', lang: 'en', baseUrl: 'https://www.themoviedb.org',
                logo: 'https://www.google.com/s2/favicons?sz=256&domain=strem.io',
                type: 'movie', version: '2.0.0'
            };
        },
        getSettings: function() {
            return [
                { key: 'showboxToken', label: 'Showbox (Febbox) UI Token', description: 'Required for Showbox', type: 'text', default: '' },
                { key: 'debug', label: 'Debug logging', type: 'enum', default: 'false', options: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }] }
            ];
        },
        getVideoSources: getVideoSources,
        getStreams: getVideoSources,
        getLinks: getVideoSources,
        _parseStreamId: _parseStreamId
    };
}
