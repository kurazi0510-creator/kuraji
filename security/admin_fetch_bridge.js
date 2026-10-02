// Only runs inside an owner-only Apps Script HTML-service deployment.
// The public GitHub copy of kanri.html must not be used after cutover.
(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const parsed = new URL(url, location.href);
    if (parsed.hostname !== 'script.google.com' ||
        !/^\/macros\/s\/[^/]+\/exec$/.test(parsed.pathname) ||
        parsed.pathname !== '/macros/s/AKfycbxN8GuaDOG2WnR9OiJINtqoMOz2guWn-TrmRlkLQIs3QAvuLZxDh1obSNGDbpFto2oltg/exec') {
      return nativeFetch(input, init);
    }
    const method = (init.method || (input.method || 'GET')).toUpperCase();
    const request = method === 'GET'
      ? {method, params: Object.fromEntries(parsed.searchParams)}
      : {method, body: JSON.parse(init.body || '{}')};
    const data = await new Promise((resolve, reject) => {
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).adminRequest(request);
    });
    return new Response(data, {status: 200, headers: {'Content-Type': 'application/json'}});
  };
})();
