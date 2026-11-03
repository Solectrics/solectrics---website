import { verifyVisitToken } from "./_hec-visit-token.js";

const response=(status,message,ok=false)=>Response.json(
  {ok,...(message?{message}:{})},
  {status,headers:{"Cache-Control":"no-store"}}
);

export async function onRequestPost({request,env}) {
  try {
    const url=new URL(request.url);
    if (request.headers.get("origin")!==url.origin) return response(403,"Invalid request origin");
    if (!request.headers.get("content-type")?.startsWith("application/json")) return response(415,"JSON required");
    if (Number(request.headers.get("content-length")||"0")>1024) return response(413,"Request too large");
    if (!env.DB || !env.HEC_TURNSTILE_SECRET) return response(503,"Booking is temporarily unavailable");

    const {token}=await request.json();
    const enquiryId=await verifyVisitToken(env,token);
    if (!enquiryId) return response(403,"This booking link has expired or is invalid");

    const enquiry=await env.DB.prepare("SELECT answers_json FROM enquiries WHERE id = ?").bind(enquiryId).first();
    const job=await env.DB.prepare("SELECT id FROM jobs WHERE enquiry_id = ?").bind(enquiryId).first();
    if (!enquiry || !job) return response(404,"We could not locate this enquiry");

    const answers=JSON.parse(enquiry.answers_json||"{}");
    if (!answers || typeof answers!=="object" || Array.isArray(answers))
      return response(503,"Booking information is unavailable");

    if (answers.followUpRequest!=="free_site_visit") {
      answers.followUpRequest="free_site_visit";
      answers.siteVisitRequestedAt=new Date().toISOString();
    }
    // Both records update transactionally; re-clicking the link is idempotent.
    await env.DB.batch([
      env.DB.prepare("UPDATE enquiries SET answers_json = ? WHERE id = ?").bind(JSON.stringify(answers),enquiryId),
      env.DB.prepare("UPDATE jobs SET next_action = ? WHERE id = ?").bind(
        "Contact customer to arrange free site visit",job.id)
    ]);
    return response(200,"Your free home solar visit request has been received.",true);
  } catch(error) {
    console.error("HEC free visit request failed.");
    return response(503,"We could not save your visit request. Please try again.");
  }
}
