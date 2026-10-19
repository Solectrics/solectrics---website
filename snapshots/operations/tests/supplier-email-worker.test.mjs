import test from "node:test";
import assert from "node:assert/strict";
import { extractPdfAttachments } from "../workers/supplier-invoice-email-worker.js";

test("direct email adapter extracts PDF attachments and preserves attachment bytes", () => {
  const base64 = btoa("%PDF-1.4 real-invoice-fixture");
  const raw = [
    "From: invoices@jarussell.co.nz",
    "To: invoices@solectrics.example",
    "Message-ID: <abc123@example.test>",
    "Subject: J.A. Russell Tax Invoice 43357185",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=invoice-boundary",
    "",
    "--invoice-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 7bit",
    "",
    "Please find invoice attached.",
    "--invoice-boundary",
    "Content-Type: application/pdf; name=43357185.pdf",
    "Content-Disposition: attachment; filename=43357185.pdf",
    "Content-Transfer-Encoding: base64",
    "",
    base64,
    "--invoice-boundary--",
    ""
  ].join("\r\n");
  const parsed = extractPdfAttachments(raw);
  assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0].filename, "43357185.pdf");
  assert.equal(parsed.attachments[0].content_type, "application/pdf");
  assert.equal(atob(parsed.attachments[0].content_base64), "%PDF-1.4 real-invoice-fixture");
});

test("direct email adapter ignores non-PDF message parts", () => {
  const raw = "From: a@b.nz\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nhello\r\n--x--\r\n";
  assert.equal(extractPdfAttachments(raw).attachments.length, 0);
});
