import { load } from 'cheerio';

const TARGET_DOMAIN = 'xhamster.com';
const TARGET_URL = `https://${TARGET_DOMAIN}`;

export async function proxyRequest(path: string, searchParams: string, originalHeaders: Headers, host: string) {
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const localBase = `${protocol}://${host}`;

    // 1. Asset Proxying
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
        // High-reputation Browser Headers
        headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
        headers.set('Accept-Language', 'en-US,en;q=0.9');
        headers.set('Referer', 'https://www.google.com/');

        // Anti-Datacenter detection: Spoof IP (Random residential-like IP)
        headers.set('X-Forwarded-For', '92.40.' + Math.floor(Math.random() * 255) + '.' + Math.floor(Math.random() * 255));

        // Force Age Verification and bypass landing pages via Cookies
        let cookieStr = originalHeaders.get('cookie') || '';
        const ageCookies = [
            'age_confirmed=1',
            'is_adult=1',
            'ah_age_confirmed=true',
            'f_adult=1',
            'is_mature=1'
        ];

        ageCookies.forEach(c => {
            if (!cookieStr.includes(c.split('=')[0])) {
                cookieStr += (cookieStr ? '; ' : '') + c;
            }
        });
        headers.set('Cookie', cookieStr);

        const range = originalHeaders.get('range');
        if (range) headers.set('Range', range);

        const response = await fetch(url, {
            method: 'GET',
            headers,
            redirect: 'follow', // We follow to see where it wants to take us, but we might force-rewrite the result
        });

        // If we are being redirected to a login/signup wall content (even with code 200)
        // We can't easily detect content, but we can try to fetch a specific subpage if root fails

        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('video/') || contentType.includes('audio/') || contentType.includes('image/') || contentType.includes('font/')) {
            const outHeaders = new Headers();
            outHeaders.set('Content-Type', contentType);
            outHeaders.set('Access-Control-Allow-Origin', '*');
            if (response.headers.has('content-range')) outHeaders.set('Content-Range', response.headers.get('content-range')!);
            return new Response(response.body, { status: response.status, headers: outHeaders });
        }

        if (contentType.includes('text/html') || contentType.includes('application/json') || contentType.includes('javascript')) {
            let text = await response.text();

            // Rewrite URLs
            text = text.split(`https://${TARGET_DOMAIN}`).join(localBase);
            text = text.split(`//${TARGET_DOMAIN}`).join(`//${host}`);
            text = text.replace(/https?:\/\/([^/]+\.xhcdn\.com)/g, `${localBase}/_xh_assets/$1`);

            // Mask Brand
            text = text.replace(/xHamster(?!Live)/gi, 'PornHub');
            text = text.replace(/XHAMSTER/g, 'PORNHUB');

            if (contentType.includes('text/html')) {
                // If the page content includes "Join xHamster for free" or "Sign up", 
                // it means we hit the wall. Let's try to inject a script that redirects the CLIENT to /videos
                // which often bypasses the root wall.
                if (text.includes('Join PornHub for free') || text.includes('Sign up')) {
                    // Try to force a different path if we are on root
                    if (path === '' || path === '/') {
                        // We can't easily re-fetch from here without recursion risk, 
                        // so we'll try to add a meta-refresh or JS redirect as a fallback
                        // But first, let's just try the cookie injection fix.
                    }
                }
                text = injectHelper(text, localBase, host);
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

function injectHelper(html: string, localBase: string, host: string) {
    const $ = load(html);

    // Auto-Verify on client side too
    const clientBypass = `
    (function() {
        document.cookie = "ah_age_confirmed=true; path=/; max-age=31536000";
        document.cookie = "age_confirmed=1; path=/; max-age=31536000";
        document.cookie = "is_adult=1; path=/; max-age=31536000";
        
        // If we see the signup modal, try to find the 'close' or 'skip' button
        // Or redirect to /videos if stuck on a landing page
        if (window.location.pathname === '/' && document.body.innerHTML.includes('Join PornHub for free')) {
             // window.location.href = '/videos'; // Subtle redirection as a fallback
        }
    })();
    `;

    const helperScript = `
    (function() {
        const LB = window.location.origin;
        const TD = 'xhamster.com';
        function fU(u) {
            if (!u || typeof u !== 'string' || u.startsWith(LB) || u.startsWith('/_xh_assets/')) return u;
            if (u.includes(TD) && !u.includes('xhamsterlive.com')) u = u.replace('https://'+TD, LB).replace('//'+TD, LB);
            if (u.includes('xhcdn.com')) {
                const m = u.match(/https?:\\/\\/([^/]+\\.xhcdn\.com)(\\/.*)/);
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
        const oF = window.fetch; window.fetch = (i, t) => oF(typeof i==='string'?fU(i):i, t);
        const oO = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u) { return oO.apply(this, [m, typeof u==='string'?fU(u):u]); };
    })();
    `;

    $('head').prepend(`<script>${clientBypass}</script>`);
    $('head').prepend(`<script>${helperScript}</script>`);
    if (!$('base').length) $('head').prepend(`<base href="${localBase}/">`);
    else $('base').attr('href', localBase + '/');

    return $.html();
}

async function proxyAsset(url: string, originalHeaders: Headers, localBase: string) {
    try {
        const headers = new Headers();
        headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        headers.set('Referer', TARGET_URL);
        const range = originalHeaders.get('range');
        if (range) headers.set('Range', range);

        const response = await fetch(url, { headers });
        const contentType = response.headers.get('content-type') || '';

        if (url.endsWith('.m3u8') || contentType.includes('mpegurl')) {
            let content = await response.text();
            content = content.replace(/https?:\/\/([^/]+)(\/.*)/g, (match, domain, path) => {
                if (domain.includes('localhost') || domain.includes('vercel.app')) return match;
                return `${localBase}/_xh_assets/${domain}${path}`;
            });
            return new Response(content, { headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' } });
        }

        const h = new Headers();
        h.set('Content-Type', contentType);
        h.set('Access-Control-Allow-Origin', '*');
        h.set('Cache-Control', 'public, max-age=31536000');
        if (response.headers.has('content-range')) h.set('Content-Range', response.headers.get('content-range')!);
        return new Response(response.body, { status: response.status, headers: h });
    } catch (e) {
        return new Response('Asset Not Found', { status: 404 });
    }
}
