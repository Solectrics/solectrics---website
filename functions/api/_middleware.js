import {authenticateAccessRequest,withPrivateNoStore} from './_access-security.js';
import {stagingGate,stagingIntent} from './_usability-staging.js';
import {usabilityLocal} from './_usability-local.js';
const PUBLIC_METHODS=new Map([['/api/enquiry',new Set(['POST','OPTIONS'])],['/api/read-bill',new Set(['POST','OPTIONS'])]]);
export async function onRequest(context){
 if(stagingIntent(context))return stagingGate(context,{api:true});
 if(usabilityLocal(context))return context.next();
 const methods=PUBLIC_METHODS.get(new URL(context.request.url).pathname);
 if(methods?.has(context.request.method))return context.next();
 const auth=await authenticateAccessRequest(context);if(!auth.ok)return auth.response;
 return withPrivateNoStore(await context.next());
}
