// VISUAL PREVIEW ONLY — NEVER MERGE INTO MAIN OR RELEASE BRANCH.
// Pages preview permits static GET/HEAD only. All APIs and writes are blocked.
// Production keeps the canonical pages.dev -> solectrics.co.nz redirect.
function isPreviewHostname(host) {
  return host === "pages.dev" || host.endsWith(".pages.dev");
}
export async function onRequest(context){
  const url=new URL(context.request.url);
  if(!isPreviewHostname(url.hostname))return context.next();
  const deny=()=>new Response("Unavailable in this read-only preview",{
    status:404,headers:{"Cache-Control":"no-store","Content-Type":"text/plain; charset=utf-8"}
  });
  if(url.pathname==="/api"||url.pathname.startsWith("/api/"))return deny();
  if(context.request.method!=="GET"&&context.request.method!=="HEAD")return deny();
  const known=new Set(["/","/home-energy-check","/smart-energy",
    "/smart-solar-prices","/home-battery-guide","/free-home-solar-visit","/hec-email-preview"]);
  const allowed=known.has(url.pathname)||
    /\.(?:html?|css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf)$/i.test(url.pathname);
  return allowed?context.next():deny();
}
