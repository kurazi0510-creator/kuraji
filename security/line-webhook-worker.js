// Cloudflare Worker: LINE signs the *raw* body. Set secrets via Worker settings:
// LINE_CHANNEL_SECRET and GAS_WEBHOOK_URL (including ?webhookKey=...).
export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('Not found', {status: 404});
    if (!env.LINE_CHANNEL_SECRET || !env.GAS_WEBHOOK_URL) return new Response('Not configured', {status: 503});
    const raw = await request.arrayBuffer();
    const supplied = request.headers.get('x-line-signature') || '';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LINE_CHANNEL_SECRET),
      {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, raw));
    const expected = btoa(String.fromCharCode(...signature));
    const a = new TextEncoder().encode(supplied), b = new TextEncoder().encode(expected);
    let diff = a.length ^ b.length;
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
    if (diff) return new Response('Unauthorized', {status: 401});
    // Keep the authenticated forwarding alive if LINE disconnects while GAS runs.
    // The HTTP response still reflects GAS acceptance; this is not a durable queue.
    const forwarding = (async () => {
      try {
        const target = new URL(env.GAS_WEBHOOK_URL);
        console.log('relay_target', {
          googleHost: target.hostname === 'script.google.com',
          productionPath: /^\/macros\/s\/[^/]+\/exec$/.test(target.pathname),
          keyLength: (target.searchParams.get('webhookKey') || '').length,
        });
        const upstream = await fetch(env.GAS_WEBHOOK_URL, {
          method: 'POST', headers: {'Content-Type': 'text/plain'}, body: raw, redirect: 'follow',
        });
        console.log('relay_upstream_status', upstream.status);
        const result = upstream.ok ? await upstream.json() : null;
        console.log('relay_result', {
          accepted: result?.ok === true,
          denied: result?.error === '権限がありません',
        });
        if (!result || result.ok !== true) return new Response('Webhook upstream error', {status: 502});
        return new Response('OK', {status: 200});
      } catch {
        console.log('relay_failed', 'URL, connection, or response format');
        return new Response('Webhook upstream error', {status: 502});
      }
    })();
    ctx.waitUntil(forwarding);
    return await forwarding;
  },
};
