const CANONICAL_HOSTNAME = "solectrics.co.nz";
const STAGING_ALLOWED_HOSTNAMES = new Set([
  "codex-hec-customer-copy-bran.solectrics-jobhub-staging.pages.dev"
]);

function isPagesHostname(hostname) {
  return hostname === "pages.dev" || hostname.endsWith(".pages.dev");
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const stagingOnly = context.env?.JOBHUB_STAGING_ONLY === "true";

  // Only the reviewed HEC preview may use this staging-only bypass.
  if (stagingOnly && !STAGING_ALLOWED_HOSTNAMES.has(url.hostname)) {
    return new Response("Staging hostname is not allowed", {
      status: 403,
      headers: { "Cache-Control": "no-store" }
    });
  }
  if (stagingOnly && context.env?.ALLOW_PAGES_DEV_HOST === "true" &&
      STAGING_ALLOWED_HOSTNAMES.has(url.hostname)) {
    return context.next();
  }

  if (!isPagesHostname(url.hostname)) {
    return context.next();
  }

  if (context.request.method === "GET" || context.request.method === "HEAD") {
    url.protocol = "https:";
    url.hostname = CANONICAL_HOSTNAME;
    url.port = "";
    return Response.redirect(url.toString(), 308);
  }

  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}
