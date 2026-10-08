const CANONICAL_HOSTNAME = "solectrics.co.nz";
const STAGING_ALLOWED_HOSTNAMES = new Set([
  "codex-hec-customer-copy-bran.solectrics-jobhub-staging.pages.dev"
]);

function isPagesHostname(hostname) {
  return hostname === "pages.dev" || hostname.endsWith(".pages.dev");
}

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // TEMPORARY: inspect only these two non-secret flags on the reviewed alias.
  // Keep this before the staging gate so missing flags can be diagnosed.
  if (STAGING_ALLOWED_HOSTNAMES.has(url.hostname) &&
      url.pathname === "/__staging/hec-host-flags") {
    if (context.request.method !== "GET" && context.request.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: { "Allow": "GET, HEAD", "Cache-Control": "no-store" }
      });
    }
    const flagStatus = name => ({
      present: typeof context.env?.[name] !== "undefined",
      enabled: context.env?.[name] === "true"
    });
    const body = JSON.stringify({
      JOBHUB_STAGING_ONLY: flagStatus("JOBHUB_STAGING_ONLY"),
      ALLOW_PAGES_DEV_HOST: flagStatus("ALLOW_PAGES_DEV_HOST")
    });
    return new Response(context.request.method === "HEAD" ? null : body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow"
      }
    });
  }
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
