import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/supplier-invoice-inbox.js";

test("multipart inbox handler preserves multiple PDF bytes without posting or invoicing", async () => {
  const pdfs = [
    { field: "attachment", name: "first.pdf", bytes: new TextEncoder().encode("%PDF-1.4\nfirst test invoice") },
    { field: "attachments", name: "second.pdf", bytes: new Uint8Array([37,80,68,70,45,49,46,52,10,0,255]) }
  ];
  const form = new FormData();
  form.set("book_id", "staging-test-book");
  for (const pdf of pdfs) form.append(pdf.field, new File([pdf.bytes], pdf.name, { type: "application/pdf" }));
  const uploaded = [], inserts = [];
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() { return sql.includes("FROM bookkeeping_books") ? { id: "staging-test-book", active: 1 } : null; },
            async run() { inserts.push({ sql, values }); return { success: true }; }
          };
        }
      };
    }
  };
  const bucket = {
    async put(key, bytes, options) { uploaded.push({ key, bytes, options }); },
    async delete() { assert.fail("Successful upload must not delete storage"); }
  };
  const response = await onRequestPost({
    request: new Request("https://staging.example.invalid/api/supplier-invoice-inbox", { method: "POST", body: form }),
    env: { DB: db, JOB_FILES: bucket }
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(uploaded.length, 2);
  for (let i = 0; i < pdfs.length; i++) {
    assert.deepEqual(uploaded[i].bytes, pdfs[i].bytes);
    assert.equal(uploaded[i].options.customMetadata.originalName, pdfs[i].name);
    assert.match(uploaded[i].key, /^supplier-inbox\/staging-test-book\//);
  }
  assert.equal(inserts.length, 4);
  assert.ok(inserts.every(({ sql }) => /INSERT INTO bookkeeping_supplier_invoice_(inbox|events)/.test(sql)));
});
