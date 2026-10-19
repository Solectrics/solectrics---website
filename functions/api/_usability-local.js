// Feature containment only; staging requires separately reviewed staff authentication.
export function usabilityLocal(context) {
 return context.env?.JOBHUB_USABILITY_LOCAL_ONLY === 'true' &&
 ['localhost','127.0.0.1','[::1]'].includes(new URL(context.request.url).hostname);
}
export function localDenied() { return Response.json({ok:false,error:'This usability candidate is enabled only for local synthetic testing.'},{status:403}); }
