const CANONICAL_HOSTNAME = "solectrics.co.nz";

function isPagesHostname(hostname) {
  return hostname === "pages.dev" || hostname.endsWith(".pages.dev");
}

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (context.env?.JOBHUB_STAGING_ONLY === "true") {
    if (context.env.ALLOW_PAGES_DEV_HOST === "true" &&
        url.hostname === "fletcher-package-mobile-fix.solectrics-jobhub-staging.pages.dev") {
      return context.next();
    }
    return new Response("Staging hostname is not allowed", {
      status: 403, headers: { "Cache-Control": "no-store" }
    });
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
