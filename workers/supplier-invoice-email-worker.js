function splitHeadersAndBody(entity) {
  const match = /\r?\n\r?\n/.exec(entity);
  if (!match) return { headers: "", body: entity };
  return { headers: entity.slice(0, match.index), body: entity.slice(match.index + match[0].length) };
}

function headerMap(text) {
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  return Object.fromEntries(unfolded.split(/\r?\n/).map(line => {
    const index = line.indexOf(":");
    return index > 0 ? [line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim()] : null;
  }).filter(Boolean));
}

function dispositionFilename(value = "") {
  const encoded = value.match(/filename\*\s*=\s*[^']*''([^;]+)/i)?.[1];
  if (encoded) { try { return decodeURIComponent(encoded.trim().replace(/^"|"$/g, "")); } catch {} }
  return value.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean)?.trim() || "";
}

export function extractPdfAttachments(rawEmail) {
  const source = String(rawEmail || "");
  const top = splitHeadersAndBody(source);
  const topHeaders = headerMap(top.headers);
  const attachments = [];
  function visit(entity, contentType = "") {
    const split = splitHeadersAndBody(entity);
    const headers = headerMap(split.headers);
    const partType = headers["content-type"] || contentType;
    const boundary = partType.match(/boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i)?.slice(1).find(Boolean);
    if (boundary) {
      for (const piece of split.body.split(`--${boundary}`).slice(1)) {
        const trimmed = piece.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
        if (!trimmed || trimmed === "--") continue;
        if (trimmed.startsWith("--")) continue;
        visit(trimmed);
      }
      return;
    }
    const disposition = headers["content-disposition"] || "";
    const filename = dispositionFilename(disposition) || dispositionFilename(partType);
    const mime = String(partType).split(";")[0].trim().toLowerCase();
    if (!filename.toLowerCase().endsWith(".pdf") && mime !== "application/pdf") return;
    const transfer = (headers["content-transfer-encoding"] || "").toLowerCase();
    if (transfer !== "base64") return;
    const encoded = split.body.replace(/\s/g, "");
    try { atob(encoded.slice(0, Math.min(encoded.length, 16))); } catch { return; }
    attachments.push({ filename: filename || "supplier-invoice.pdf", content_type: "application/pdf", content_base64: encoded });
  }
  visit(source, topHeaders["content-type"] || "");
  return { headers: topHeaders, attachments };
}

function senderAllowed(from, configured) {
  const allowed = String(configured || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return false;
  const sender = String(from || "").trim().toLowerCase();
  return allowed.some(value => value.startsWith("@") ? sender.endsWith(value) : sender === value);
}

function emailHeader(message, name) {
  try { return message.headers.get(name) || ""; } catch { return ""; }
}

async function readRawEmail(message) {
  const response = new Response(message.raw);
  return new TextDecoder().decode(await response.arrayBuffer());
}

export default {
  async email(message, env) {
    try {
      if (!env.SUPPLIER_INBOX_API_URL || !env.SUPPLIER_INBOX_SECRET) throw new Error("Supplier inbox API is not configured");
      if (!senderAllowed(message.from, env.SUPPLIER_ALLOWED_SENDERS)) throw new Error("Sender is not on the supplier allowlist");
      const parsed = extractPdfAttachments(await readRawEmail(message));
      if (!parsed.attachments.length) throw new Error("No PDF invoice attachment found");
      if (parsed.attachments.length > 10) throw new Error("Email contains more than 10 PDF attachments");
      const subject = emailHeader(message, "subject");
      const messageId = emailHeader(message, "message-id");
      const response = await fetch(env.SUPPLIER_INBOX_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${env.SUPPLIER_INBOX_SECRET}`
        },
        body: JSON.stringify({
          source_type: "direct_email",
          sender_email: message.from,
          recipient_email: message.to,
          email_subject: subject,
          email_message_id: messageId,
          attachments: parsed.attachments
        })
      });
      if (!response.ok) throw new Error(`Job Hub intake returned ${response.status}`);
    } catch (error) {
      console.error("Supplier email intake failed:", error.message);
      if (env.SUPPLIER_INBOX_FAILURE_EMAIL) await message.forward(env.SUPPLIER_INBOX_FAILURE_EMAIL);
      else message.setReject("Supplier invoice could not be delivered to Job Hub. Please contact Solectrics.");
    }
  }
};
