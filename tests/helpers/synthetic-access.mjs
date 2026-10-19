import {webcrypto} from 'node:crypto';
import {ACCEPTANCE_HOST} from '../../functions/api/_usability-staging.js';
export async function syntheticAccess(){
 const crypto=webcrypto;
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk={...await crypto.subtle.exportKey('jwk',keys.publicKey),kid:'synthetic-acceptance-key'};
 const issuer='https://synthetic-access.example.invalid',audience='synthetic-acceptance-audience';
 const env={JOBHUB_USABILITY_STAGING:'true',JOBHUB_STAGING_ONLY:'true',ALLOW_PAGES_DEV_HOST:'true',JOBHUB_ACCESS_ISSUER:issuer,JOBHUB_ACCESS_AUDIENCES:JSON.stringify({[ACCEPTANCE_HOST]:audience}),JOBHUB_STAFF_EMAILS:'jane@example.invalid,tom@example.invalid'};
 async function token(overrides={},header={}){
  const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const a=enc({alg:'RS256',kid:jwk.kid,...header});
  const b=enc({iss:issuer,aud:[audience],sub:'synthetic-jane-subject',email:'jane@example.invalid',exp:Math.floor(Date.now()/1000)+300,...overrides});
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,Buffer.from(a+'.'+b));return a+'.'+b+'.'+Buffer.from(sig).toString('base64url');
 }
 const jwksFetch=async url=>{if(url!==issuer+'/cdn-cgi/access/certs')throw Error('Non-synthetic provider access prohibited');return Response.json({keys:[jwk]});};
 return {env,token,jwksFetch,issuer};
}
