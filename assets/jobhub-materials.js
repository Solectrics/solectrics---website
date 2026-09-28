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
    ["materialsDescription", "materialsSku", "materialsUnit"].forEach(id => { byId(id).value = ""; });
    byId("materialsQuantity").value = "1";
    byId("materialsUnitCost").value = "0";
    byId("jobMaterialsMessage").textContent = "New material. Changes save automatically once the description and invoice are selected.";
  }

  async function removeMaterial(id) {
    const response = await fetch("/api/job-materials?job_id=" + encodeURIComponent(materialsJobId) +
      "&id=" + encodeURIComponent(id), { method: "DELETE" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || "Could not remove material");
    await loadMaterials();
  }

  byId("materialsSource")?.addEventListener("change", updateSourceFields);
  byId("newJobMaterial")?.addEventListener("click", newMaterial);
  ["materialsSource", "materialsSupplier", "materialsInvoiceFile", "materialsInvoiceNumber", "materialsInvoiceDate", "materialsDescription", "materialsSku", "materialsQuantity", "materialsUnit", "materialsUnitCost"].forEach(id => {
    byId(id)?.addEventListener("input", scheduleMaterialAutosave);
    byId(id)?.addEventListener("change", scheduleMaterialAutosave);
  });
  byId("jobMaterialsList")?.addEventListener("click", event => {
    const edit = event.target.closest(".editJobMaterial");
    if (edit) editMaterial(edit.dataset.materialId);
  });
  byId("uploadMaterialsInvoice")?.addEventListener("click", () => {
    byId("jobFileCategory").value = "supplier";
    byId("jobFileRole").value = "supplier_invoice";
    byId("jobFilesSection").scrollIntoView({ behavior: "smooth", block: "start" });
    byId("jobFileInput").click();
  });
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
  updateSourceFields();
  updateCommercialRouteVisibility();
  refreshInvoices();
  loadMaterials();

  const fileList = byId("jobFilesList");
  if (fileList) new MutationObserver(refreshInvoices).observe(fileList, { childList: true, subtree: true });
})();
