const CANONICAL_HOSTNAME = "solectrics.co.nz";

function isPagesHostname(hostname) {
  return hostname === "pages.dev" || hostname.endsWith(".pages.dev");
}

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Staging deployments must not expose the shared staging DB through an
  // unprotected per-deployment/preview alias. Use only the Access-protected host.
  if (context.env.JOBHUB_STAGING_ONLY === "true" &&
      url.hostname !== "solectrics-jobhub-staging.pages.dev") {
    return new Response("Staging hostname is not allowed", {
      status: 403, headers: { "Cache-Control": "no-store" }
    });
  }

  if (!isPagesHostname(url.hostname)) {
    return context.next();
  }

  // The isolated staging Pages project may opt into its own Access-protected
  // pages.dev hostname. Production keeps the canonical-host redirect unless
  // this explicit Pages environment variable is set.
  if (context.env.ALLOW_PAGES_DEV_HOST === "true") {
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
