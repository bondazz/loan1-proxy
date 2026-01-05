import { load } from 'cheerio';

const TARGET_DOMAIN = 'xhamster.com';
const TARGET_URL = `https://${TARGET_DOMAIN}`;

export async function proxyRequest(path: string, searchParams: string, originalHeaders: Headers, host: string) {
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const localBase = `${protocol}://${host}`;

    // 1. Asset Proxying (Critical for CSS/JS)
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

    // 2. Determine target path
    const targetPath = (path === '' || path === '/') ? '' : path;
    const url = `${TARGET_URL}/${targetPath}${searchParams ? `?${searchParams}` : ''}`;

    try {
        const headers = new Headers();
        // Use a very common browser UA
        headers.set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
        headers.set('Accept-Language', 'en-US,en;q=0.9');
        headers.set('Referer', 'https://www.google.com/');
        headers.set('Cache-Control', 'no-cache');

        // Anti-Datacenter: Residential spoofing
        const randIP = `${103 + Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
        headers.set('X-Forwarded-For', randIP);
        headers.set('X-Real-IP', randIP);

        // Force age verification and skip landing pages via Cookies
        let cookieEntries = [];
        const originalCookie = originalHeaders.get('cookie');
        if (originalCookie) cookieEntries.push(originalCookie);

        // Critical bypass cookies
        cookieEntries.push('age_confirmed=1');
        cookieEntries.push('is_adult=1');
        cookieEntries.push('ah_age_confirmed=true');
        cookieEntries.push('f_adult=1');
        cookieEntries.push('is_mature=1');
        cookieEntries.push('content_filter=0'); // Disable filters

        headers.set('Cookie', cookieEntries.join('; '));

        const response = await fetch(url, {
            method: 'GET',
            headers,
            redirect: 'follow',
        });

        // If redirected to a known login-wall path, try to fetch the actual video list instead
        if (response.url.includes('/lp/') || response.url.includes('/signup')) {
            return proxyRequest('videos', '', originalHeaders, host);
        }

        const contentType = response.headers.get('content-type') || '';

        // Media optimization
        if (contentType.includes('video/') || contentType.includes('audio/') || contentType.includes('image/') || contentType.includes('font/')) {
            const outH = new Headers();
            outH.set('Content-Type', contentType);
            outH.set('Access-Control-Allow-Origin', '*');
            if (response.headers.has('content-range')) outH.set('Content-Range', response.headers.get('content-range')!);
            return new Response(response.body, { status: response.status, headers: outH });
        }

        // HTML/JSON/JS processing
        if (contentType.includes('text/html') || contentType.includes('application/json') || contentType.includes('javascript')) {
            let text = await response.text();

            // Rewrite links and assets
            text = text.split(`https://${TARGET_DOMAIN}`).join(localBase);
            text = text.split(`//${TARGET_DOMAIN}`).join(`//${host}`);
            text = text.replace(/https?:\/\/([^/ \n\r"']+\.xhcdn\.com)/g, `${localBase}/_xh_assets/$1`);

            // Brand Masking
            text = text.replace(/xHamster(?!Live)/gi, 'PornHub');
            text = text.replace(/XHAMSTER/g, 'PORNHUB');

            if (contentType.includes('text/html')) {
                const $ = load(text);

                // 3. NUCLEAR OPTIONS: Remove common signup/modal patterns
                $('.signup-modal, .modal-overlay, #signup-popup, .lp-container, .age-verification-modal').remove();

                // Remove problematic scripts
                $('script[src*="google-analytics"], script[src*="googletagmanager"], script[src*="histats"]').remove();

                const helperScript = `
                (function() {
                    // Force cookies locally
                    const ck = ["age_confirmed=1", "is_adult=1", "ah_age_confirmed=true", "content_filter=0"];
                    ck.forEach(x => { document.cookie = x + "; path=/; max-age=31536000; sameSite=Lax"; });
                    
                    const LB = window.location.origin;
                    function fU(u) {
                        if (!u || typeof u !== 'string' || u.startsWith(LB) || u.startsWith('/_xh_assets/')) return u;
                        if (u.includes('xhamster.com')) return u.replace(/https?:\\/\\/xhamster\\.com/g, LB).replace(/\\/\\/xhamster\\.com/g, LB);
                        if (u.includes('xhcdn.com')) {
                            const m = u.match(/https?:\\/\\/([^/]+\\.xhcdn\\.com)(\\/.*)/);
                            if (m) return LB + '/_xh_assets/' + m[1] + m[2];
                        }
                        return u;
                    }
                    function pN(n) {
                        if (n.nodeType !== 1) return;
                        ['href','src','data-src','data-thumb','poster'].forEach(a => {
                            const v = n.getAttribute(a);
                            if (v) { const nv = fU(v); if(nv!==v) n.setAttribute(a, nv); }
                        });
                        // Kill any element that looks like a landing page modal
                        if(n.innerText && (n.innerText.includes('Join PornHub') || n.innerText.includes('Sign up'))) {
                           // n.style.display = 'none';
                        }
                    }
                    new MutationObserver(ms => ms.forEach(m => {
                        m.addedNodes.forEach(pN);
                        if(m.type==='attributes') pN(m.target);
                    })).observe(document.documentElement, {childList:true, subtree:true, attributes:true});
                    
                    const oF = window.fetch; window.fetch = (i, t) => oF(typeof i==='string'?fU(i):i, t);
                    const oO = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(m, u) { return oO.apply(this, [m, typeof u==='string'?fU(u):u]); };
                })();
                `;
                $('head').prepend(`<script>${helperScript}</script>`);
                $('head').prepend(`<base href="${localBase}/">`);

                text = $.html();
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
            content = content.replace(/https?:\/\/([^/]+\.xhcdn\.com)(\/.*)/g, (m, d, p) => `${localBase}/_xh_assets/${d}${p}`);
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

export const dynamic = 'force-dynamic';
