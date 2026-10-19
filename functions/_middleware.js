import {stagingIntent,stagingGate} from './api/_usability-staging.js';
import {authenticateAccessRequest,withPrivateNoStore} from './api/_access-security.js';
import {usabilityLocal} from './api/_usability-local.js';
const CANONICAL_HOSTNAME = "solectrics.co.nz";

function isPagesHostname(hostname) {
  return hostname === "pages.dev" || hostname.endsWith(".pages.dev");
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if(stagingIntent(context))return stagingGate(context);

  if (!isPagesHostname(url.hostname)) {
    if(url.pathname.startsWith('/mini-fergus') && !usabilityLocal(context)) {
      const auth=await authenticateAccessRequest(context);if(!auth.ok)return auth.response;
      return withPrivateNoStore(await context.next());
    }
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
