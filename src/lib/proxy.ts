import { load } from 'cheerio';

const TARGET_DOMAIN = 'xhamster.com';
const TARGET_URL = `https://${TARGET_DOMAIN}`;

export async function proxyRequest(path: string, searchParams: string, originalHeaders: Headers, host: string) {
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const localBase = `${protocol}://${host}`;

    // 1. Asset Proxying (Static files)
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

    // 2. INTERNAL REDIRECT: Bypass landing page for root
    const targetPath = (path === '' || path === '/') ? 'videos' : path;
    const url = `${TARGET_URL}/${targetPath}${searchParams ? `?${searchParams}` : ''}`;

    try {
        const headers = new Headers();
        headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
        headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
        headers.set('Accept-Language', 'en-US,en;q=0.9');
        headers.set('Referer', 'https://www.google.com/');

        // PASS THE USER'S REAL IP (Azerbaijan IP) to bypass Virginia/USA wall
        const userIP = originalHeaders.get('x-forwarded-for')?.split(',')[0].trim();
        if (userIP) {
            headers.set('X-Forwarded-For', userIP);
            headers.set('X-Real-IP', userIP);
            headers.set('True-Client-IP', userIP);
        } else {
            // Fallback random residential-like IP if forwarder fails
            const randIP = `92.40.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
            headers.set('X-Forwarded-For', randIP);
        }

        // Force Global Verification Headers
        headers.set('RTA', '1'); // Restricted to Adults

        let cookieArr = [];
        const existingCookie = originalHeaders.get('cookie');
        if (existingCookie) cookieArr.push(existingCookie);
        cookieArr.push('age_confirmed=1', 'is_adult=1', 'ah_age_confirmed=true', 'f_adult=1', 'access_granted=true');
        headers.set('Cookie', cookieArr.join('; '));

        const response = await fetch(url, {
            method: 'GET',
            headers,
            redirect: 'follow',
        });

        const contentType = response.headers.get('content-type') || '';

        // Media files pass-through
        if (contentType.includes('video/') || contentType.includes('audio/') || contentType.includes('image/') || contentType.includes('font/')) {
            const h = new Headers();
            h.set('Content-Type', contentType);
            h.set('Access-Control-Allow-Origin', '*');
            if (response.headers.has('content-range')) h.set('Content-Range', response.headers.get('content-range')!);
            return new Response(response.body, { status: response.status, headers: h });
        }

        // Textual content processing
        if (contentType.includes('text/html') || contentType.includes('json') || contentType.includes('javascript')) {
            let text = await response.text();

            // Rewrite URLs
            text = text.split(`https://${TARGET_DOMAIN}`).join(localBase);
            text = text.split(`//${TARGET_DOMAIN}`).join(`//${host}`);
            text = text.replace(/https?:\/\/([^/ \n\r"']+\.xhcdn\.com)/g, `${localBase}/_xh_assets/$1`);

            // Mask Brand ONLY (Strict fix for Error 1000)
            text = text.replace(/xHamster(?!\\.com)/gi, 'PornHub');
            text = text.replace(/XHAMSTER/g, 'PORNHUB');

            if (contentType.includes('text/html')) {
                text = injectFinalBypass(text, localBase);
            }

            const outHeaders = new Headers();
            outHeaders.set('Content-Type', contentType);
            outHeaders.set('Access-Control-Allow-Origin', '*');
            const setCookie = response.headers.get('set-cookie');
            if (setCookie) outHeaders.set('Set-Cookie', setCookie.replace(/domain=\.?xhamster\.com/gi, ''));

            return new Response(text, { status: response.status, headers: outHeaders });
        }

        return new Response(response.body, { status: response.status, headers: { 'Content-Type': contentType } });

    } catch (error) {
        return new Response('Proxy Error', { status: 502 });
    }
}

function injectFinalBypass(html: string, localBase: string) {
    const $ = load(html);

    // NUCLEAR CSS: Ensure no modals are visible
    const style = `
    <style>
        .signup-modal, .modal-overlay, #signup-popup, .lp-container, .age-verification,
        div[style*="z-index: 1000"], div[style*="z-index: 99999"], 
        [class*="signup"], [id*="signup"], [class*="modal"] {
            display: none !important; 
            visibility: hidden !important; 
            opacity: 0 !important;
            pointer-events: none !important;
        }
        body { overflow: auto !important; position: static !important; filter: none !important; }
        .blurred, .blur { filter: none !important; }
    </style>
    `;

    // NUCLEAR JS: Kill the wall as soon as it appears
    const script = `
    <script>
        (function() {
            // Force verification in browser
            document.cookie = "ah_age_confirmed=true; path=/; max-age=31536000";
            document.cookie = "is_adult=1; path=/; max-age=31536000";
            
            // Detect and Flush Wall
            const flush = () => {
                document.querySelectorAll('.signup-modal, .modal-overlay, #signup-popup, .lp-container').forEach(e => e.remove());
                if (document.body.innerText.includes('Join PornHub') || document.body.innerText.includes('Sign up')) {
                    // If we see the wall, we are on the wrong page. Redirect to /videos
                    if (window.location.pathname === '/' || window.location.pathname === '') {
                        window.location.href = '/videos';
                    }
                }
                document.body.style.overflow = 'auto';
            };
            
            setInterval(flush, 200);
            
            // Asset correction
            const LB = window.location.origin;
            const fix = (u) => {
                if(!u || typeof u !== 'string' || u.startsWith(LB) || u.startsWith('/_xh_assets/')) return u;
                if(u.includes('xhamster.com')) return u.replace(/https?:\\/\\/xhamster\\.com/g, LB);
                if(u.includes('xhcdn.com')) {
                    const m = u.match(/https?:\\/\\/([^/]+\\.xhcdn\\.com)(\\/.*)/);
                    if(m) return LB + '/_xh_assets/' + m[1] + m[2];
                }
                return u;
            };
            
            new MutationObserver(ms => ms.forEach(m => {
                m.addedNodes.forEach(n => {
                    if(n.nodeType !== 1) return;
                    ['href','src','data-src','data-thumb','poster'].forEach(a => {
                        const v = n.getAttribute(a);
                        if(v) n.setAttribute(a, fix(v));
                    });
                });
            })).observe(document.documentElement, {childList:true, subtree:true});
        })();
    </script>
    `;

    $('head').prepend(style);
    $('head').prepend(script);
    if (!$('base').length) $('head').prepend(`<base href="${localBase}/">`);
    else $('base').attr('href', localBase + '/');

    // Clean initial DOM
    $('.signup-modal, .modal-overlay, #signup-popup, .lp-container').remove();

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

        if (url.endsWith('.m3u8')) {
            let content = await response.text();
            content = content.replace(/https?:\/\/([^/]+\.xhcdn\.com)(\/.*)/g, (m, d, p) => `${localBase}/_xh_assets/${d}${p}`);
            return new Response(content, { headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': '*' } });
        }

        const h = new Headers();
        h.set('Content-Type', contentType);
        h.set('Access-Control-Allow-Origin', '*');
        if (response.headers.has('content-range')) h.set('Content-Range', response.headers.get('content-range')!);
        return new Response(response.body, { status: response.status, headers: h });
    } catch (e) { return new Response('Not Found', { status: 404 }); }
}
