import { sendHomeEnergyCheckCopy, ANSWER_FIELDS } from "./_hec-customer-copy.js";
const reply=(status,error)=>Response.json({ok:status===200,...(error?{error}:{})},{status,headers:{'Cache-Control':'no-store',...(status===429?{'Retry-After':'60'}:{})}});
export async function onRequestGet({env}) {
  return Response.json({siteKey:env.HEC_TURNSTILE_SITE_KEY||null},{headers:{'Cache-Control':'no-store'}});
}
// No enquiry, job, D1 or R2 writes. Missing protection fails closed.
export async function onRequestPost({request,env}) {
 try {
  const url=new URL(request.url);
  if(request.headers.get('origin')!==url.origin) return reply(403,'Invalid request origin');
  if(!request.headers.get('content-type')?.startsWith('application/json'))return reply(415,'JSON required');
  if(!env.HEC_TURNSTILE_SECRET || !env.HEC_EMAIL_GUARD?.fetch || !env.RESEND_API_KEY)return reply(503,'Email results are temporarily unavailable');
  const reader=request.body?.getReader();if(!reader)return reply(400,'Invalid results');
  let size=0;const chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16000){await reader.cancel();return reply(413,'Request too large');}chunks.push(value);}
  let payload;try {payload=JSON.parse(await new Blob(chunks).text());}catch{return reply(400,'Invalid JSON');}
  const answers=payload?.answers;
  if(!answers || typeof answers!=='object' || Array.isArray(answers))return reply(400,'Invalid results');
  const recipient=typeof answers.email==='string'?answers.email.trim():'';
  if(recipient.length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient))return reply(400,'A valid email address is required');
  if(typeof payload.token!=='string'||!payload.token||payload.token.length>2048)return reply(400,'Please complete the verification');
  const safe={};
  for(const [key] of ANSWER_FIELDS){
   const value=answers[key];if(value==null)continue;
   if(typeof value==='string'&&value.length<=1000)safe[key]=value;
   else if(Array.isArray(value)&&value.length<=20&&value.every(v=>typeof v==='string'&&v.length<=100))safe[key]=value;
   else return reply(400,'Invalid answer format');
  }
  const ip=request.headers.get('CF-Connecting-IP');if(!ip)return reply(503,'Verification unavailable');
  const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(b=>b.toString(16).padStart(2,'0')).join('');
  const guard=await env.HEC_EMAIL_GUARD.fetch('https://hec-guard/check',{method:'POST',body:JSON.stringify({ip:await hash(ip),recipient:await hash(recipient.toLowerCase())})});
  if(guard.status===429)return reply(429,'Please wait before requesting another email');
  if(!guard.ok)return reply(503,'Verification unavailable');
  const verified=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.HEC_TURNSTILE_SECRET,response:payload.token,remoteip:ip}),signal:AbortSignal.timeout(10000)});
  const check=await verified.json();
  if(!verified.ok||check.success!==true||check.hostname!==url.hostname||check.action!=='hec-email')return reply(403,'Verification failed; please try again');
  await sendHomeEnergyCheckCopy(env,{...safe,email:recipient,emailOnly:true,customerCopyOptIn:false},recipient);
  return reply(200);
 }catch {console.error('HEC email-only request failed.');return reply(502,'Could not send results');}
}
