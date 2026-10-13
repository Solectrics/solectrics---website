import { authenticateAccessRequest, withPrivateNoStore } from "./_access-security.js";

const PUBLIC_METHODS = new Map([
  ["/api/enquiry", new Set(["POST", "OPTIONS"])],
  ["/api/read-bill", new Set(["POST", "OPTIONS"])]
]);

function isPublicApiRequest(request) {
  const url = new URL(request.url);
  const methods = PUBLIC_METHODS.get(url.pathname);
  return Boolean(methods && methods.has(request.method));
}

export async function onRequest(context) {
  if (isPublicApiRequest(context.request)) {
    return context.next();
  }

  const auth = await authenticateAccessRequest(context);
  if (!auth.ok) return auth.response;

  const response = await context.next();
  return withPrivateNoStore(response);
}
