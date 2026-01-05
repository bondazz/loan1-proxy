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
        headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
        headers.set('Accept-Language', 'en-US,en;q=0.9');
        headers.set('Referer', 'https://www.google.com/');

        // CRITICAL: Pass the REAL user IP to bypass Virginia/USA restrictions
        // Vercel gives the client IP in 'x-forwarded-for'
        const clientIP = originalHeaders.get('x-forwarded-for')?.split(',')[0].trim();
        if (clientIP) {
            headers.set('X-Forwarded-For', clientIP);
            headers.set('X-Real-IP', clientIP);
            headers.set('True-Client-IP', clientIP);
            headers.set('CF-Connecting-IP', clientIP);
        }

        // Force Cookies for Age Verification
        let cookieArr = [];
        const existingCookie = originalHeaders.get('cookie');
        if (existingCookie) cookieArr.push(existingCookie);
        cookieArr.push('age_confirmed=1', 'is_adult=1', 'ah_age_confirmed=true', 'f_adult=1', 'is_mature=1');
        headers.set('Cookie', cookieArr.join('; '));

        const response = await fetch(url, {
            method: 'GET',
            headers,
            redirect: 'follow',
        });

        const contentType = response.headers.get('content-type') || '';

        // Pass binary/media through
        if (contentType.includes('video/') || contentType.includes('audio/') || contentType.includes('image/') || contentType.includes('font/')) {
            const h = new Headers();
            h.set('Content-Type', contentType);
            h.set('Access-Control-Allow-Origin', '*');
            if (response.headers.has('content-range')) h.set('Content-Range', response.headers.get('content-range')!);
            return new Response(response.body, { status: response.status, headers: h });
        }

        if (contentType.includes('text/html') || contentType.includes('application/json') || contentType.includes('javascript')) {
            let text = await response.text();

            // 1. URL rewriting
            text = text.split(`https://${TARGET_DOMAIN}`).join(localBase);
            text = text.split(`//${TARGET_DOMAIN}`).join(`//${host}`);
            text = text.replace(/https?:\/\/([^/ \n\r"']+\.xhcdn\.com)/g, `${localBase}/_xh_assets/$1`);

            // 2. Global Brand Replacement (Nuclear)
            text = text.replace(/xHamster/gi, 'PornHub');
            text = text.replace(/XHAMSTER/g, 'PORNHUB');

            if (contentType.includes('text/html')) {
                const $ = load(text);

                // 3. Inject "Anti-Wall" CSS & JS
                const style = `
                <style>
                    /* Hide anything that looks like a modal or signup wall */
                    .signup-modal, .modal-overlay, #signup-popup, .age-verification, 
                    [class*="signup"], [class*="login-wall"], div[style*="z-index: 1000"] { 
                        display: none !important; opacity: 0 !important; pointer-events: none !important; 
                    }
                    body { overflow: auto !important; position: static !important; }
                    .blurred, .blur { filter: none !important; }
                </style>
                `;

                const script = `
                <script>
                    (function() {
                        // Set cookies locally too
                        document.cookie = "ah_age_confirmed=true; path=/; max-age=31536000";
                        document.cookie = "is_adult=1; path=/; max-age=31536000";
                        
                        // Link and Asset correction
                        const LB = window.location.origin;
                        const fix = (u) => {
                            if(!u || typeof u !== 'string' || u.startsWith(LB) || u.startsWith('/_xh_assets/')) return u;
                            if(u.includes('xhamster.com')) return u.replace(/https?:\\/\\/xhamster\\.com/g, LB);
                            if(u.includes('xhcdn.com')) {
                                const m = u.match(/https?:\\/\\/([^/]+\\.xhcdn\.com)(\\/.*)/);
                                if(m) return LB + '/_xh_assets/' + m[1] + m[2];
                            }
                            return u;
                        };
                        
                        new MutationObserver(ms => ms.forEach(m => {
                            m.addedNodes.forEach(n => {
                                if(n.nodeType !== 1) return;
                                ['href','src','data-src','data-thumb'].forEach(a => {
                                    const v = n.getAttribute(a);
                                    if(v) n.setAttribute(a, fix(v));
                                });
                                // Remove dynamic modals
                                if(n.innerText && (n.innerText.includes('PornHub') && n.innerText.includes('free'))) n.remove();
                            });
                        })).observe(document.documentElement, {childList:true, subtree:true});
                    })();
                </script>
                `;

                $('head').prepend(style);
                $('head').prepend(script);
                if (!$('base').length) $('head').prepend(`<base href="${localBase}/">`);
                else $('base').attr('href', localBase + '/');

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
        if (url.endsWith('.m3u8')) {
            let content = await response.text();
            content = content.replace(/https?:\/\/([^/ \n\r"']+\.xhcdn\.com)(\/.*)/g, (m, d, p) => `${localBase}/_xh_assets/${d}${p}`);
            return new Response(content, { headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' } });
        }
        const h = new Headers();
        h.set('Content-Type', contentType);
        h.set('Access-Control-Allow-Origin', '*');
        if (response.headers.has('content-range')) h.set('Content-Range', response.headers.get('content-range')!);
        return new Response(response.body, { status: response.status, headers: h });
    } catch (e) { return new Response('Not Found', { status: 404 }); }
}
