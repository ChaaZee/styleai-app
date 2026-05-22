/**
 * Stitch Depop Proxy Worker
 * Runs on Cloudflare's edge — fetches Depop API on behalf of Render.
 *
 * Usage: POST /fetch
 * Body: { "url": "https://webapi.depop.com/..." }
 * Returns: raw JSON from Depop
 *
 * Protected by a shared secret in the Authorization header.
 */

const ALLOWED_HOSTS = ["api.depop.com", "webapi.depop.com"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/fetch") {
      return new Response("Not found", { status: 404 });
    }

    // Auth check
    const secret = env.WORKER_SECRET;
    const authHeader = request.headers.get("Authorization") || "";
    if (secret && authHeader !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    const { url: targetUrl } = body;

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return new Response("Invalid target URL", { status: 400 });
    }
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      return new Response(`Host not allowed: ${parsed.hostname}`, { status: 403 });
    }

    try {
      const depopRes = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Content-Type": "application/json",
          "Origin": "https://www.depop.com",
          "Referer": "https://www.depop.com/",
          "Sec-Ch-Ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Ch-Ua-Platform": '"Windows"',
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-site",
          "depop-device-id": "968ef61a-f2a8-4688-8f02-f8098565bb8f",
          "depop-session-id": env.DEPOP_SESSION_ID || "8f975b12-8661-4c33-b51c-74b1109528b3",
          "x-cached-sizes": "true",
        },
        cf: {
          cacheTtl: 0,
          cacheEverything: false,
        },
      });

      const text = await depopRes.text();
      return new Response(text, {
        status: depopRes.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "X-Depop-Status": String(depopRes.status),
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
