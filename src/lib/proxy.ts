import { load } from 'cheerio';

const TARGET_DOMAIN = 'xhamster.com';
const TARGET_URL = `https://${TARGET_DOMAIN}`;

export async function proxyRequest(path: string, searchParams: string, originalHeaders: Headers, host: string) {
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const localBase = `${protocol}://${host}`;

    // 1. Asset Proxying (No changes here, it works)
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

    // 2. FORCE BYPASS: If hitting root, try to fetch /videos internally to skip landing page
    let effectivePath = path;
    if (path === '' || path === '/') {
        effectivePath = 'videos';
    }

    const url = `${TARGET_URL}/${effectivePath}${searchParams ? `?${searchParams}` : ''}`;

    try {
        const headers = new Headers();
        headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
        headers.set('Accept-Language', 'en-US,en;q=0.9');
        headers.set('Referer', 'https://www.google.com/');

        // Residential IP Spoofing
        const randIP = `103.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
        headers.set('X-Forwarded-For', randIP);
        headers.set('X-Real-IP', randIP);

        let cookieStr = originalHeaders.get('cookie') || '';
        const forceCookies = [
            'age_confirmed=1', 'is_adult=1', 'ah_age_confirmed=true',
            'f_adult=1', 'is_mature=1', 'access_granted=true'
        ];
        forceCookies.forEach(c => {
            if (!cookieStr.includes(c.split('=')[0])) cookieStr += (cookieStr ? '; ' : '') + c;
        });
        headers.set('Cookie', cookieStr);

        const response = await fetch(url, {
            method: 'GET',
            headers,
            redirect: 'follow',
        });

        // Detect if we were redirected to a signup page despite our efforts
        const finalUrl = response.url;
        if (finalUrl.includes('/lp/') || finalUrl.includes('/signup') || finalUrl.includes('/join')) {
            // If they still try to force-redirect us, try /best as a last resort
            return proxyRequest('best', '', originalHeaders, host);
        }

        const contentType = response.headers.get('content-type') || '';

        // Pass-through media
        if (contentType.includes('video/') || contentType.includes('audio/') || contentType.includes('image/') || contentType.includes('font/')) {
            const outH = new Headers();
            outH.set('Content-Type', contentType);
            outH.set('Access-Control-Allow-Origin', '*');
            if (response.headers.has('content-range')) outH.set('Content-Range', response.headers.get('content-range')!);
            return new Response(response.body, { status: response.status, headers: outH });
        }

        // AGGRESSIVE REWRITING for all text-based formats
        if (contentType.includes('text') || contentType.includes('json') || contentType.includes('javascript')) {
            let text = await response.text();

            // 1. URL Rewriting
            text = text.split(`https://${TARGET_DOMAIN}`).join(localBase);
            text = text.split(`//${TARGET_DOMAIN}`).join(`//${host}`);
            text = text.replace(/https?:\/\/([^/]+\.xhcdn\.com)/g, `${localBase}/_xh_assets/$1`);

            // 2. ULTRA-STRICT BRAND MASKING (Catching all cases)
            text = text.replace(/xHamster/gi, 'PornHub');
            text = text.replace(/XH-Desktop/gi, 'PH-Desktop');
            text = text.replace(/XH-Shared/gi, 'PH-Shared');
            text = text.replace(/XHAMSTER/g, 'PORNHUB');

            if (contentType.includes('text/html')) {
                text = injectHelperFix(text, localBase);
            }

            const outH = new Headers();
            outH.set('Content-Type', contentType);
            outH.set('Access-Control-Allow-Origin', '*');
            const setCookie = response.headers.get('set-cookie');
            if (setCookie) outH.set('Set-Cookie', setCookie.replace(/domain=\.?xhamster\.com/gi, ''));

            return new Response(text, { status: response.status, headers: outH });
        }

        return new Response(response.body, { status: response.status, headers: { 'Content-Type': contentType } });

    } catch (error) {
        return new Response('Proxy Error', { status: 502 });
    }
}

function injectHelperFix(html: string, localBase: string) {
    const $ = load(html);

    // Clean headers and analytics
    $('meta[http-equiv="Content-Security-Policy"]').remove();
    $('script[src*="google-analytics"], script[src*="googletagmanager"], script[src*="histats"]').remove();

    const script = `
    (function() {
        // Force cookies in browser
        const c = ["age_confirmed=1", "is_adult=1", "ah_age_confirmed=true"];
        c.forEach(x => { document.cookie = x + "; path=/; max-age=31536000"; });
        
        // Link Fixer
        const LB = window.location.origin;
        const TD = 'xhamster.com';
        function fU(u) {
            if (!u || typeof u !== 'string' || u.startsWith(LB) || u.startsWith('/_xh_assets/')) return u;
            if (u.includes(TD) && !u.includes('xhamsterlive.com')) u = u.replace('https://'+TD, LB).replace('//'+TD, LB);
            if (u.includes('xhcdn.com')) {
                const m = u.match(/https?:\\/\\/([^/]+\\.xhcdn\\.com)(\\/.*)/);
                if (m) u = LB + '/_xh_assets/' + m[1] + m[2];
            }
            return u;
        }
        function pN(n) {
            if (n.nodeType !== 1) return;
            ['href','src','data-src','data-thumb','poster'].forEach(a => {
                const v = n.getAttribute(a);
                if (v) { const nv = fU(v); if(nv!==v) n.setAttribute(a, nv); }
            });
        }
        new MutationObserver(ms => ms.forEach(m => {
            m.addedNodes.forEach(pN);
            if(m.type==='attributes') pN(m.target);
        })).observe(document.documentElement, {childList:true, subtree:true, attributes:true, attributeFilter:['href','src','data-src']});
    })();
    `;

    $('head').prepend(`<script>${script}</script>`);
    $('head').prepend(`<base href="${localBase}/">`);

    // Final check for brand in common structural elements
    $('title').text($('title').text().replace(/xHamster/gi, 'PornHub'));

    return $.html();
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
            content = content.replace(/https?:\/\/([^/]+)(\/.*)/g, (match, domain) => {
                if (domain.includes('localhost') || domain.includes('vercel.app')) return match;
                return `${localBase}/_xh_assets/${domain}${content.substring(match.length)}`; // Simplified for brevity
            });
            // Better regex for manifest
            content = content.replace(/https?:\/\/([^/]+)(\/.*)/g, (m, d, p) => `${localBase}/_xh_assets/${d}${p}`);
            return new Response(content, { headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' } });
        }

        const h = new Headers();
        h.set('Content-Type', contentType);
        h.set('Access-Control-Allow-Origin', '*');
        if (response.headers.has('content-range')) h.set('Content-Range', response.headers.get('content-range')!);
        return new Response(response.body, { status: response.status, headers: h });
    } catch (e) {
        return new Response('Asset Not Found', { status: 404 });
    }
}
