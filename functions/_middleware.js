const CANONICAL_HOSTNAME = "solectrics.co.nz";
const BILL_ACCURACY_PREVIEW_HOSTNAME = "codex-hec-bill-accuracy-stag.solectrics-jobhub-staging.pages.dev";
const STAGING_ALLOWED_HOSTNAMES = new Set([
  "solectrics-jobhub-staging.pages.dev",
  "codex-jobhub-solar-operation.solectrics-jobhub-staging.pages.dev"
]);

function isPagesHostname(hostname) {
  return hostname === "pages.dev" || hostname.endsWith(".pages.dev");
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const isBillAccuracyPreview = url.hostname === BILL_ACCURACY_PREVIEW_HOSTNAME;
  // Temporary bill-accuracy preview: exact host and both explicit staging flags.
  if (isBillAccuracyPreview && context.env.JOBHUB_STAGING_ONLY === "true" &&
      context.env.ALLOW_PAGES_DEV_HOST === "true") {
    return context.next();
  }

  // The staging project has a shared staging database. Permit only its
  // Access-protected project hostname and the one reviewed Operations preview;
  // never allow preview aliases by suffix or wildcard.
  if (context.env.JOBHUB_STAGING_ONLY === "true" &&
      !STAGING_ALLOWED_HOSTNAMES.has(url.hostname)) {
    return new Response("Staging hostname is not allowed", {
      status: 403, headers: { "Cache-Control": "no-store" }
    });
  }

  if (!isPagesHostname(url.hostname)) {
    return context.next();
  }

  // The isolated staging Pages project may opt into its explicitly allowed
  // pages.dev hostnames. Production keeps the canonical-host redirect unless
  // this explicit Pages environment variable is set.
  if (context.env.ALLOW_PAGES_DEV_HOST === "true" && !isBillAccuracyPreview) {
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
