const json=(status,message)=>Response.json({ok:status===200,...(message?{message}:{})},{status,headers:{"Cache-Control":"no-store"}});
const escape=s=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export async function onRequestGet({env}){return Response.json({siteKey:env.HEC_TURNSTILE_SITE_KEY||null},{headers:{"Cache-Control":"no-store"}})}
export async function onRequestPost({request,env}){
 try{
  const url=new URL(request.url);
  if(request.headers.get("Origin")!==url.origin)return json(403,"Invalid origin");
  if(!request.headers.get("Content-Type")?.startsWith("application/json"))return json(415,"JSON required");
  if(!env.RESEND_API_KEY||!env.HEC_TURNSTILE_SECRET||!env.HEC_EMAIL_GUARD?.fetch)return json(503,"Contact form is temporarily unavailable. Please email Jane directly.");
  const raw=await request.text();if(raw.length>5000)return json(413,"Message too long");
  let data;try{data=JSON.parse(raw)}catch{return json(400,"Invalid message")}
  const name=typeof data.name==="string"?data.name.trim():"",email=typeof data.email==="string"?data.email.trim():"",message=typeof data.message==="string"?data.message.trim():"";
  if(!name||name.length>120||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)||email.length>254||!message||message.length>2000)return json(400,"Please enter your name, a valid email and a message (maximum 2,000 characters).");
  if(typeof data.token!=="string"||!data.token||data.token.length>2048)return json(400,"Please complete verification");
  const ip=request.headers.get("CF-Connecting-IP");if(!ip)return json(503,"Verification unavailable");
  const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,"0")).join("");
  const guard=await env.HEC_EMAIL_GUARD.fetch("https://hec-guard/check",{method:"POST",body:JSON.stringify({ip:await hash(ip),recipient:await hash(email.toLowerCase())})});
  if(guard.status===429)return json(429,"Please wait before sending another message");
  if(!guard.ok)return json(503,"Verification unavailable");
  const verification=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({secret:env.HEC_TURNSTILE_SECRET,response:data.token,remoteip:ip}),signal:AbortSignal.timeout(10000)});
  const result=await verification.json();
  if(!verification.ok||result.success!==true||result.hostname!==url.hostname||result.action!=="contact")return json(403,"Verification failed. Please try again.");
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:"Jane at Solectrics <jane@solectrics.co.nz>",to:["jane@solectrics.co.nz"],reply_to:email,subject:"Website enquiry from "+name.replace(/[\r\n]/g," "),html:"<h2>New website enquiry</h2><p><strong>Name:</strong> "+escape(name)+"</p><p><strong>Email:</strong> "+escape(email)+"</p><p><strong>Message:</strong></p><p style=\"white-space:pre-wrap\">"+escape(message)+"</p>"})});
  if(!response.ok){console.error("Contact email delivery failed",response.status);return json(502,"Could not deliver your message. Please email Jane directly.")}
  return json(200,"Thanks, your message has been sent.");
 }catch(e){console.error("Contact form request failed");return json(502,"Could not deliver your message. Please email Jane directly.")}
}
