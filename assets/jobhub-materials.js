(function () {
  const materialsJobId = new URLSearchParams(location.search).get("id");
  const byId = id => document.getElementById(id);

  function money(value) {
    return (Number(value) || 0).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function updateSourceFields() {
    const stock = byId("materialsSource")?.value === "stock";
    ["materialsSupplierWrap", "materialsInvoiceWrap", "materialsInvoiceNumberWrap", "materialsInvoiceDateWrap"]
      .forEach(id => { if (byId(id)) byId(id).hidden = stock; });
  }

  async function refreshInvoices() {
    const select = byId("materialsInvoiceFile");
    if (!select) return;
    try {
      const response = await fetch("/api/job-files?job_id=" + encodeURIComponent(materialsJobId));
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load invoices");
      const current = select.value;
      const invoices = (data.files || []).filter(file => file.document_role === "supplier_invoice");
      select.innerHTML = '<option value="">Choose an uploaded supplier invoice</option>' +
        invoices.map(file => '<option value="' + escapeHtml(file.id) + '">' + escapeHtml(file.original_name) + '</option>').join("");
      if (invoices.some(file => file.id === current)) select.value = current;
    } catch (error) {
      select.innerHTML = '<option value="">Could not load invoices — refresh the page</option>';
    }
  }

  let materialRecords = [];
  let activeMaterialId = null;
  let materialAutosaveTimer = null;
  let materialSavePromise = null;
  let materialRevision = 0;
  let invoiceReadResult = null;

  function hideInvoicePreview() {
    invoiceReadResult = null;
    const preview = byId("materialsInvoicePreview");
    if (preview) preview.hidden = true;
    if (byId("materialsInvoiceImportMessage")) byId("materialsInvoiceImportMessage").textContent = "";
  }

  function invoicePreviewValue(id) {
    return byId(id)?.value?.trim() || "";
  }

  function renderInvoicePreview(invoice) {
    invoiceReadResult = invoice;
    const summary = byId("materialsInvoiceSummary");
    const warnings = byId("materialsInvoiceWarnings");
    const lines = byId("materialsInvoiceLines");
    const preview = byId("materialsInvoicePreview");
    const documentLabel = invoice.document_type === "credit_note" ? "Credit note" : "Invoice";

    summary.innerHTML = `
      <div><label>Supplier</label><input id="invoicePreviewSupplier" value="${escapeHtml(invoice.supplier || "J.A. Russell")}"></div>
      <div><label>Document</label><input value="${documentLabel}" disabled></div>
      <div><label>Invoice / credit number</label><input id="invoicePreviewNumber" value="${escapeHtml(invoice.invoice_number || "")}"></div>
      <div><label>Date</label><input id="invoicePreviewDate" type="date" value="${escapeHtml(invoice.invoice_date || "")}"></div>
      <div><label>Order reference</label><input id="invoicePreviewReference" value="${escapeHtml(invoice.purchase_order_reference || "")}"></div>
      <div><label>Subtotal ex GST</label><input id="invoicePreviewSubtotal" type="number" step="0.01" value="${invoice.subtotal_ex_gst ?? ""}"></div>
      <div><label>GST</label><input id="invoicePreviewGst" type="number" step="0.01" value="${invoice.gst ?? ""}"></div>
      <div><label>Total incl GST</label><input id="invoicePreviewTotal" type="number" step="0.01" value="${invoice.total_incl_gst ?? ""}"></div>`;

    warnings.innerHTML = (invoice.warnings || []).map(warning =>
      `<div class="error" style="margin-top:10px;">Check: ${escapeHtml(warning)}</div>`
    ).join("");
    if (invoice.confidence < 0.8) {
      warnings.insertAdjacentHTML("beforeend", '<div class="error" style="margin-top:10px;">The scan was not fully certain. Check all figures against the PDF.</div>');
    }

    if (!invoice.lines?.length) {
      lines.innerHTML = '<div class="placeholder">No individual product lines were found. You can still use the checked ex-GST total above.</div>';
    } else {
      lines.innerHTML = invoice.lines.map((line, index) => `
        <div class="answer-box invoice-import-line" data-invoice-line="${index}">
          <label style="display:flex;align-items:center;gap:10px;font-weight:800;">
            <input type="checkbox" class="invoice-line-selected" checked style="width:auto;"> Add this line
          </label>
          <div class="grid" style="margin-top:10px;">
            <div><label>Description</label><input class="invoice-line-description" value="${escapeHtml(line.description)}"></div>
            <div><label>Supplier code</label><input class="invoice-line-sku" value="${escapeHtml(line.stock_code || "")}"></div>
            <div><label>Quantity</label><input class="invoice-line-quantity" type="number" min="0.01" step="0.01" value="${line.quantity}"></div>
            <div><label>Unit</label><input class="invoice-line-unit" value="${escapeHtml(line.unit || "each")}"></div>
            <div><label>Unit cost ex GST</label><input class="invoice-line-cost" type="number" step="0.0001" value="${line.unit_price_ex_gst}"></div>
            <div><label>Printed line total ex GST</label><input value="${line.extension_ex_gst}" disabled></div>
          </div>
        </div>`).join("");
    }
    preview.hidden = false;
    preview.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function readSelectedInvoice() {
    const fileId = byId("materialsInvoiceFile").value;
    const message = byId("materialsInvoiceReadMessage");
    if (!fileId) {
      message.textContent = "Select an uploaded PDF invoice first.";
      return;
    }
    const button = byId("readMaterialsInvoice");
    button.disabled = true;
    hideInvoicePreview();
    message.textContent = "Reading invoice — this can take a little while…";
    try {
      const response = await fetch("/api/supplier-invoice-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: Number(materialsJobId), file_id: fileId })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.detail || data.error || "Could not read invoice");
      renderInvoicePreview(data.invoice);
      message.textContent = "✓ Invoice read. Check the figures below before adding them.";
    } catch (error) {
      message.textContent = `Could not read invoice: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  async function postImportedMaterial(payload) {
    const response = await fetch("/api/job-materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.detail || data.error || "Could not add material");
  }

  function invoiceImportBase() {
    return {
      job_id: Number(materialsJobId),
      source: "supplier_invoice",
      supplier_name: invoicePreviewValue("invoicePreviewSupplier") || "J.A. Russell",
      invoice_file_id: byId("materialsInvoiceFile").value,
      invoice_number: invoicePreviewValue("invoicePreviewNumber"),
      invoice_date: invoicePreviewValue("invoicePreviewDate")
    };
  }

  function invoiceAlreadyImported(fileId) {
    return materialRecords.some(record => record.invoice_file_id === fileId);
  }

  async function importInvoiceLines() {
    const base = invoiceImportBase();
    const message = byId("materialsInvoiceImportMessage");
    if (invoiceAlreadyImported(base.invoice_file_id)) {
      message.textContent = "This invoice already has recorded material entries. Remove those entries before importing it again.";
      return;
    }
    const selected = Array.from(document.querySelectorAll(".invoice-import-line")).filter(row =>
      row.querySelector(".invoice-line-selected")?.checked
    );
    if (!selected.length) {
      message.textContent = "Tick at least one material line, or choose ADD TOTAL ONLY.";
      return;
    }
    const button = byId("importMaterialsInvoiceLines");
    button.disabled = true;
    try {
      message.textContent = `Adding ${selected.length} checked material line${selected.length === 1 ? "" : "s"}…`;
      const items = selected.map(row => ({
          description: row.querySelector(".invoice-line-description").value.trim(),
          supplier_sku: row.querySelector(".invoice-line-sku").value.trim(),
          quantity: row.querySelector(".invoice-line-quantity").value,
          unit_code: row.querySelector(".invoice-line-unit").value.trim(),
          unit_cost_ex_gst: row.querySelector(".invoice-line-cost").value
      }));
      const response = await fetch("/api/job-materials-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, items })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.detail || data.error || "Could not add invoice lines");
      message.textContent = `✓ ${selected.length} material line${selected.length === 1 ? "" : "s"} added`;
      await loadMaterials();
      hideInvoicePreview();
      byId("materialsInvoiceReadMessage").textContent = "✓ Invoice lines added after confirmation.";
    } catch (error) {
      message.textContent = `Could not finish importing: ${error.message}`;
      await loadMaterials();
    } finally {
      button.disabled = false;
    }
  }

  async function importInvoiceTotal() {
    const base = invoiceImportBase();
    const message = byId("materialsInvoiceImportMessage");
    if (invoiceAlreadyImported(base.invoice_file_id)) {
      message.textContent = "This invoice already has recorded material entries. Remove those entries before importing it again.";
      return;
    }
    const subtotalText = invoicePreviewValue("invoicePreviewSubtotal");
    const subtotal = Number(subtotalText);
    if (!subtotalText || !Number.isFinite(subtotal)) {
      message.textContent = "Check and enter the ex-GST subtotal first.";
      return;
    }
    const button = byId("importMaterialsInvoiceTotal");
    button.disabled = true;
    message.textContent = "Adding checked invoice total…";
    try {
      const kind = invoiceReadResult?.document_type === "credit_note" ? "credit note" : "invoice";
      const number = base.invoice_number ? ` ${base.invoice_number}` : "";
      await postImportedMaterial({
        ...base,
        description: `${base.supplier_name} materials — ${kind}${number}`,
        supplier_sku: "",
        quantity: 1,
        unit_code: "invoice",
        unit_cost_ex_gst: subtotal
      });
      await loadMaterials();
      hideInvoicePreview();
      byId("materialsInvoiceReadMessage").textContent = "✓ Checked ex-GST invoice total added.";
    } catch (error) {
      message.textContent = `Could not add invoice total: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  function render(materials) {
    materialRecords = materials || [];
    const list = byId("jobMaterialsList");
    const total = (materials || []).reduce((sum, item) =>
      sum + (Number(item.quantity) || 0) * (Number(item.unit_cost_ex_gst) || 0), 0);
    byId("jobMaterialsTotal").textContent = money(total);
    window.jobActualMaterialsCost = total;
    window.dispatchEvent(new CustomEvent("jobhub:materials-updated", { detail: { total } }));
    if (!materials?.length) {
      list.className = "placeholder";
      list.textContent = "No material items recorded yet.";
      return;
    }
    list.className = "";
    list.innerHTML = materials.map(item => {
      const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_cost_ex_gst) || 0);
      const source = item.source === "stock" ? "Solectrics stock" : escapeHtml(item.supplier_name || "Supplier");
      const invoice = item.invoice_file_name ? " · " + escapeHtml(item.invoice_file_name) : "";
      const sku = item.supplier_sku ? " · Code " + escapeHtml(item.supplier_sku) : "";
      const unit = item.unit_code ? " " + escapeHtml(item.unit_code) : "";
      const invoiceNo = item.invoice_number ? " · Invoice " + escapeHtml(item.invoice_number) : "";
      return '<div class="answer-box"><strong>' + escapeHtml(item.description) + '</strong>' +
        '<div class="placeholder">' + source + invoice + invoiceNo + sku + '</div>' +
        '<div class="placeholder">' + escapeHtml(item.quantity) + unit + ' × $' + money(item.unit_cost_ex_gst) +
        ' = <strong>$' + money(lineTotal) + ' ex GST</strong></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" class="editJobMaterial" data-material-id="' + escapeHtml(item.id) + '">EDIT</button><button type="button" class="costing-remove removeJobMaterial" data-material-id="' + escapeHtml(item.id) + '">REMOVE</button></div></div>';
    }).join("");
  }

  async function loadMaterials() {
    const list = byId("jobMaterialsList");
    try {
      const response = await fetch("/api/job-materials?job_id=" + encodeURIComponent(materialsJobId));
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load materials");
      render(data.materials || []);
    } catch (error) {
      list.className = "error";
      list.textContent = error.message;
    }
  }

  function materialPayload() {
    const source = byId("materialsSource").value;
    return {
      id: activeMaterialId || undefined,
      job_id: Number(materialsJobId), source,
      supplier_name: byId("materialsSupplier").value,
      invoice_file_id: byId("materialsInvoiceFile").value,
      invoice_number: byId("materialsInvoiceNumber").value,
      invoice_date: byId("materialsInvoiceDate").value,
      description: byId("materialsDescription").value.trim(),
      supplier_sku: byId("materialsSku").value,
      quantity: byId("materialsQuantity").value,
      unit_code: byId("materialsUnit").value,
      unit_cost_ex_gst: byId("materialsUnitCost").value
    };
  }

  function scheduleMaterialAutosave() {
    materialRevision += 1;
    clearTimeout(materialAutosaveTimer);
    const payload = materialPayload();
    const message = byId("jobMaterialsMessage");
    if (!payload.description || (payload.source === "supplier_invoice" && !payload.invoice_file_id)) {
      if (payload.description) message.textContent = payload.source === "supplier_invoice" ? "Select the uploaded supplier invoice to finish saving." : "Enter a description to save this material.";
      return;
    }
    message.textContent = "Changes pending…";
    materialAutosaveTimer = setTimeout(saveMaterialAutomatically, 900);
  }

  async function saveMaterialAutomatically() {
    if (materialSavePromise) { await materialSavePromise; return; }
    const revision = materialRevision;
    const payload = materialPayload();
    if (!payload.description || (payload.source === "supplier_invoice" && !payload.invoice_file_id)) return;
    const message = byId("jobMaterialsMessage");
    message.textContent = "Saving…";
    materialSavePromise = (async () => {
      try {
        const response = await fetch("/api/job-materials", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.detail || data.error || "Could not save material");
        if (revision === materialRevision) {
          activeMaterialId = data.id;
          message.textContent = "✓ Saved automatically";
          await loadMaterials();
        }
      } catch (error) {
        message.textContent = `Could not save: ${error.message}`;
      } finally {
        materialSavePromise = null;
        if (revision !== materialRevision) {
          clearTimeout(materialAutosaveTimer);
          materialAutosaveTimer = setTimeout(saveMaterialAutomatically, 250);
        }
      }
    })();
    await materialSavePromise;
  }

  function editMaterial(id) {
    materialRevision += 1;
    clearTimeout(materialAutosaveTimer);
    const item = materialRecords.find(record => record.id === id);
    if (!item) return;
    activeMaterialId = item.id;
    byId("materialsSource").value = item.source || "supplier_invoice";
    byId("materialsSupplier").value = item.supplier_name || "";
    updateSourceFields();
    byId("materialsInvoiceNumber").value = item.invoice_number || "";
    byId("materialsInvoiceDate").value = item.invoice_date || "";
    byId("materialsDescription").value = item.description || "";
    byId("materialsSku").value = item.supplier_sku || "";
    byId("materialsQuantity").value = item.quantity || 1;
    byId("materialsUnit").value = item.unit_code || "";
    byId("materialsUnitCost").value = item.unit_cost_ex_gst || 0;
    byId("jobMaterialsMessage").textContent = "Editing saved material. Changes save automatically.";
    refreshInvoices().then(() => { byId("materialsInvoiceFile").value = item.invoice_file_id || ""; });
    byId("jobMaterialsSection").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function newMaterial() {
    materialRevision += 1;
    clearTimeout(materialAutosaveTimer);
    activeMaterialId = null;
    byId("materialsSource").value = "supplier_invoice";
    byId("materialsSupplier").value = "";
    byId("materialsInvoiceFile").value = "";
    byId("materialsInvoiceNumber").value = "";
    byId("materialsInvoiceDate").value = "";
    ["materialsDescription", "materialsSku", "materialsUnit"].forEach(id => { byId(id).value = ""; });
    byId("materialsQuantity").value = "1";
    byId("materialsUnitCost").value = "0";
    updateSourceFields();
    byId("jobMaterialsMessage").textContent = "New material entry ready. Enter a description and select its invoice to save.";
    byId("materialsDescription").scrollIntoView({ behavior: "smooth", block: "center" });
    byId("materialsDescription").focus({ preventScroll: true });
  }

  async function removeMaterial(id) {
    const response = await fetch("/api/job-materials?job_id=" + encodeURIComponent(materialsJobId) +
      "&id=" + encodeURIComponent(id), { method: "DELETE" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not remove material");
    await loadMaterials();
  }

  let materialsInitialised = false;

  function initialiseMaterials() {
    if (materialsInitialised || !byId("jobMaterialsSection")) return false;
    materialsInitialised = true;

    byId("materialsSource").addEventListener("change", updateSourceFields);
    byId("newJobMaterial").addEventListener("click", newMaterial);
    byId("readMaterialsInvoice").addEventListener("click", readSelectedInvoice);
    byId("importMaterialsInvoiceLines").addEventListener("click", importInvoiceLines);
    byId("importMaterialsInvoiceTotal").addEventListener("click", importInvoiceTotal);
    byId("cancelMaterialsInvoiceImport").addEventListener("click", hideInvoicePreview);
    byId("materialsInvoiceFile").addEventListener("change", () => {
      hideInvoicePreview();
      byId("materialsInvoiceReadMessage").textContent = byId("materialsInvoiceFile").value
        ? "Ready to read this invoice."
        : "Select an uploaded PDF invoice first.";
    });
    ["materialsSource", "materialsSupplier", "materialsInvoiceFile", "materialsInvoiceNumber", "materialsInvoiceDate", "materialsDescription", "materialsSku", "materialsQuantity", "materialsUnit", "materialsUnitCost"].forEach(id => {
      byId(id)?.addEventListener("input", scheduleMaterialAutosave);
      byId(id)?.addEventListener("change", scheduleMaterialAutosave);
    });
    byId("jobMaterialsList").addEventListener("click", event => {
      const edit = event.target.closest(".editJobMaterial");
      if (edit) editMaterial(edit.dataset.materialId);
    });
    byId("uploadMaterialsInvoice").addEventListener("click", () => {
      byId("jobFileCategory").value = "supplier";
      byId("jobFileRole").value = "supplier_invoice";
      byId("jobFileInput").click();
    });
    updateSourceFields();
    updateCommercialRouteVisibility();
    refreshInvoices();
    loadMaterials();

    const fileList = byId("jobFilesList");
    if (fileList) new MutationObserver(refreshInvoices).observe(fileList, { childList: true, subtree: true });
    return true;
  }

  document.addEventListener("click", async event => {
    const button = event.target.closest(".removeJobMaterial");
    if (!button) return;
    try {
      await removeMaterial(button.dataset.materialId);
      byId("jobMaterialsMessage").textContent = "Material removed.";
    } catch (error) {
      byId("jobMaterialsMessage").textContent = error.message;
    }
  });

  document.addEventListener("change", event => {
    if (event.target?.id === "general_billing_route") updateCommercialRouteVisibility();
  });

  if (!initialiseMaterials()) {
    const page = byId("page");
    if (page) {
      const observer = new MutationObserver(() => {
        if (initialiseMaterials()) observer.disconnect();
      });
      observer.observe(page, { childList: true, subtree: true });
    }
  }
})();
