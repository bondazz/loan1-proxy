import { load } from 'cheerio';

const TARGET_DOMAIN = 'xhamster.com';
const TARGET_URL = `https://${TARGET_DOMAIN}`;

export async function proxyRequest(path: string, searchParams: string, originalHeaders: Headers, host: string) {
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const localBase = `${protocol}://${host}`;

    // 1. Asset Proxying (Recursive check)
    if (path.startsWith('_xh_assets/')) {
        let actualAssetUrl = path.replace('_xh_assets/', '');
        if (actualAssetUrl.includes('_xh_assets/')) {
            actualAssetUrl = actualAssetUrl.split('_xh_assets/').pop() || '';
        }
        if (!actualAssetUrl.startsWith('http')) {
            actualAssetUrl = 'https://' + actualAssetUrl;
        }
        return proxyAsset(actualAssetUrl, originalHeaders, localBase);
    }

    const url = `${TARGET_URL}/${path}${searchParams ? `?${searchParams}` : ''}`;

    try {
        const headers = new Headers();
        headers.set('User-Agent', originalHeaders.get('user-agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        headers.set('Accept', originalHeaders.get('accept') || '*/*');
        headers.set('Referer', TARGET_URL);

        const cookie = originalHeaders.get('cookie');
        if (cookie) headers.set('Cookie', cookie);

        const range = originalHeaders.get('range');
        if (range) headers.set('Range', range);

        const response = await fetch(url, {
            method: 'GET',
            headers,
            redirect: 'follow',
        });

        const contentType = response.headers.get('content-type') || '';

        // Return directly if it's a video/media stream to avoid loading it into memory
        if (contentType.includes('video/') || contentType.includes('audio/') || contentType.includes('image/') || contentType.includes('font/')) {
            const outHeaders = new Headers();
            outHeaders.set('Content-Type', contentType);
            outHeaders.set('Access-Control-Allow-Origin', '*');
            if (response.headers.has('content-range')) outHeaders.set('Content-Range', response.headers.get('content-range')!);
            if (response.headers.has('accept-ranges')) outHeaders.set('Accept-Ranges', 'bytes');
            if (response.headers.has('content-length')) outHeaders.set('Content-Length', response.headers.get('content-length')!);

            return new Response(response.body, {
                status: response.status,
                headers: outHeaders,
            });
        }

        // Handle HTML
        if (contentType.includes('text/html')) {
            let html = await response.text();
            html = rewriteHtml(html, host);

            return new Response(html, {
                status: response.status,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        // Handle JSON/API/JS
        if (contentType.includes('application/json') || contentType.includes('javascript')) {
            let text = await response.text();
            text = text.split(`https://${TARGET_DOMAIN}`).join(localBase);
            text = text.split(`//${TARGET_DOMAIN}`).join(`//${host}`);
            text = text.replace(/https?:\/\/([^/]+\.xhcdn\.com)/g, `${localBase}/_xh_assets/$1`);

            return new Response(text, {
                status: response.status,
                headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' },
            });
        }

        return new Response(response.body, { status: response.status, headers: { 'Content-Type': contentType } });

    } catch (error) {
        return new Response('Proxy Error', { status: 502 });
    }
}

async function proxyAsset(url: string, originalHeaders: Headers, localBase: string) {
    try {
        const headers = new Headers();
        headers.set('User-Agent', 'Mozilla/5.0');
        headers.set('Referer', TARGET_URL);
        const range = originalHeaders.get('range');
        if (range) headers.set('Range', range);

        const response = await fetch(url, { headers });
        const contentType = response.headers.get('content-type') || '';

        if (url.endsWith('.m3u8') || contentType.includes('mpegurl')) {
            let content = await response.text();
            content = content.replace(/https?:\/\/([^/]+)(\/.*)/g, (match, domain, path) => {
                if (domain.includes('localhost')) return match;
                return `${localBase}/_xh_assets/${domain}${path}`;
            });
            return new Response(content, { headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' } });
        }

        const h = new Headers();
        h.set('Content-Type', contentType);
        h.set('Access-Control-Allow-Origin', '*');
        h.set('Cache-Control', 'public, max-age=31536000');
        if (response.headers.has('content-range')) h.set('Content-Range', response.headers.get('content-range')!);
        if (response.headers.has('content-length')) h.set('Content-Length', response.headers.get('content-length')!);

        return new Response(response.body, { status: response.status, headers: h });
    } catch (e) {
        return new Response('Asset Not Found', { status: 404 });
    }
}

function rewriteHtml(html: string, host: string): string {
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const localBase = `${protocol}://${host}`;
    const $ = load(html);

    // Remove anti-proxy/analytics
    $('meta[http-equiv="Content-Security-Policy"]').remove();
    $('script[src*="google-analytics"], script[src*="googletagmanager"], script[src*="histats"], script[src*="mcore.com"]').remove();

    // Helper script for dynamic links (Optimized)
    const helperScript = `
    (function() {
        const LB = window.location.origin;
        const TD = 'xhamster.com';
        
        function fU(u) {
            if (!u || typeof u !== 'string' || u.startsWith(LB) || u.startsWith('/_xh_assets/')) return u;
            // Strict check: must contain xhamster.com but NOT xhamsterlive.com
            if (u.includes(TD) && !u.includes('xhamsterlive.com')) {
                u = u.replace('https://'+TD, LB).replace('//'+TD, LB);
            }
            if (u.includes('xhcdn.com')) {
                const m = u.match(/https?:\\/\\/([^/]+\\.xhcdn\\.com)(\\/.*)/);
                if (m) u = LB + '/_xh_assets/' + m[1] + m[2];
            }
            return u;
        }

        function pN(n) {
            if (n.nodeType !== 1) return;
            ['href','src','data-src','data-thumb','poster','data-mp4','data-m3u8'].forEach(a => {
                const v = n.getAttribute(a);
                if (v) { const nv = fU(v); if(nv!==v) n.setAttribute(a, nv); }
            });
        }

        const obs = new MutationObserver(ms => ms.forEach(m => {
            m.addedNodes.forEach(pN);
            if(m.type==='attributes') pN(m.target);
        }));
        obs.observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['href','src','data-src','style']});
        
        // Bridge for XHR/Fetch
        const oF = window.fetch; window.fetch = (i, t) => oF(typeof i==='string'?fU(i):i, t);
        const oO = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u) { return oO.apply(this, [m, typeof u==='string'?fU(u):u]); };
    })();
    `;
    $('head').prepend(`<script>${helperScript}</script>`);
    $('head').prepend(`<base href="${localBase}/">`);

    let output = $.html();
    // Global replacement for static parts (Using safer regex to not touch live.com)
    output = output.replace(/https?:\/\/xhamster\.com(?!\/)/g, localBase);
    output = output.replace(/https?:\/\/xhamster\.com\//g, localBase + '/');
    output = output.replace(/\/\/xhamster\.com/g, '//' + host);

    output = output.replace(/https?:\/\/([^/]+\.xhcdn\.com)/g, `${localBase}/_xh_assets/$1`);
    output = output.replace(/xHamster(?!Live)/gi, 'PornHub');

    return output;
}
