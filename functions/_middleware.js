// PREVIEW-ONLY middleware. Do not merge this file into the release or main.
// Read-only browser preview: static assets work; APIs cannot touch production.
function isPagesHostname(hostname) {
  return hostname === "pages.dev" || hostname.endsWith(".pages.dev");
}

function denyPreviewRequest() {
  return new Response("Unavailable in this read-only preview", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (!isPagesHostname(url.hostname)) {
    return context.next();
  }

  // Protect customer data: no API access or form submissions in preview.
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return denyPreviewRequest();
  }
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    return denyPreviewRequest();
  }

  // Cloudflare Pages automatically redirects /page.html to /page.
  // Allow only public, known HTML pages at those clean URLs.
  const cleanPublicPages = new Set([
    "/",
    "/home-energy-check",
    "/smart-energy",
    "/smart-solar-prices"
  ]);
  const staticResource = cleanPublicPages.has(url.pathname) ||
    /\.(?:html?|css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf)$/i.test(url.pathname);
  if (staticResource) {
    return context.next();
  }
  return denyPreviewRequest();
}
