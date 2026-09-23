(function () {
  const IMPORTED_SUPPLIER_PREFIX = "J.A. Russell / Fletcher quote";
  const SOLAR_OPTION_NAME = "Solar Now, Battery Later";
  const BATTERY_OPTION_NAME = "Solar + Battery Now";
  let previewQuote = null;

  function html(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function money(value) {
    return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(Number(value) || 0);
  }

  function importerMarkup() {
    return Number(document.getElementById("costingDefaultMarkup")?.value) || 30;
  }

  function setMessage(message, isError = false) {
    const element = document.getElementById("fletcherImportMessage");
    if (!element) return;
    element.textContent = message;
    element.className = isError ? "error" : "";
  }

  function installImporter() {
    const section = document.getElementById("internalCostingSection");
    const toolbar = section?.querySelector(".costing-toolbar");
    if (!section || !toolbar || document.getElementById("fletcherQuoteImporter")) return;

    const wrapper = document.createElement("div");
    wrapper.id = "fletcherQuoteImporter";
    wrapper.className = "fletcher-importer";
    wrapper.innerHTML = `
      <style>
        .fletcher-importer{margin:18px 0 24px;padding:18px;border:1px solid #eadfce;border-radius:12px;background:#fffaf4}
        .fletcher-importer h3{margin-top:0}
        .fletcher-import-controls{display:grid;grid-template-columns:minmax(240px,1fr) auto auto;gap:10px;align-items:end}
        .fletcher-import-controls select{width:100%}
        .fletcher-import-summary{display:flex;gap:18px;flex-wrap:wrap;margin:14px 0;padding:12px;background:#fff;border-radius:9px}
        .fletcher-import-table{width:100%;border-collapse:collapse;background:#fff;font-size:13px}
        .fletcher-import-table th,.fletcher-import-table td{padding:8px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
        .fletcher-import-table th:nth-last-child(-n+2),.fletcher-import-table td:nth-last-child(-n+2){text-align:right}
        .fletcher-import-table select{min-width:150px}
        .fletcher-import-preview{overflow-x:auto;margin-top:14px}
        .fletcher-import-exclusions{margin:12px 0;color:#73520c}
        .fletcher-import-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px}
        @media(max-width:760px){.fletcher-import-controls{grid-template-columns:1fr}.fletcher-import-table{min-width:760px}}
      </style>
      <h3>Import Fletcher supplier quote</h3>
      <p class="placeholder">Read an uploaded J.A. Russell / Fletcher PDF, review every line, then create the two costing options as drafts. Nothing is imported until you approve the preview.</p>
      <div class="fletcher-import-controls">
        <div><label for="fletcherQuoteFile">Uploaded supplier quote</label><select id="fletcherQuoteFile"><option value="">Loading supplier quotes...</option></select></div>
        <button type="button" id="refreshFletcherQuotes">REFRESH FILES</button>
        <button type="button" id="readFletcherQuote">READ &amp; PREVIEW QUOTE</button>
      </div>
      <div id="fletcherImportMessage" class="placeholder" style="margin-top:10px"></div>
      <div id="fletcherImportPreview" class="fletcher-import-preview" hidden></div>
    `;
    toolbar.before(wrapper);
    loadSupplierQuoteFiles();
  }

  async function loadSupplierQuoteFiles() {
    const select = document.getElementById("fletcherQuoteFile");
    if (!select) return;
    try {
      const response = await fetch(`/api/job-files?job_id=${encodeURIComponent(jobId)}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not load supplier quotes");
      const files = (data.files || []).filter(file =>
        file.document_role === "supplier_quote" &&
        (file.content_type === "application/pdf" || String(file.original_name).toLowerCase().endsWith(".pdf"))
      );
      select.innerHTML = files.length
        ? `<option value="">Select a Fletcher PDF...</option>${files.map(file => `<option value="${html(file.id)}">${html(file.original_name)}</option>`).join("")}`
        : `<option value="">No supplier-quote PDFs uploaded</option>`;
      setMessage(files.length ? `${files.length} supplier quote PDF${files.length === 1 ? "" : "s"} available.` : "Upload the PDF under Job Photos & Documents with Document use set to Supplier quote.");
    } catch (error) {
      select.innerHTML = `<option value="">Could not load files</option>`;
      setMessage(error.message, true);
    }
  }

  async function readQuote() {
    const fileId = document.getElementById("fletcherQuoteFile")?.value;
    if (!fileId) {
      setMessage("Choose an uploaded Fletcher supplier quote first.", true);
      return;
    }
    const button = document.getElementById("readFletcherQuote");
    button.disabled = true;
    setMessage("Reading all quote pages and checking the totals...");
    try {
      const response = await fetch("/api/fletcher-quote-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: Number(jobId), file_id: fileId })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.detail || data.error || "Could not read this quote");
      previewQuote = data.quote;
      renderPreview();
      setMessage("Quote read. Review the line assignments before importing.");
    } catch (error) {
      previewQuote = null;
      document.getElementById("fletcherImportPreview").hidden = true;
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  function selectedPreviewLines() {
    const rows = Array.from(document.querySelectorAll("[data-fletcher-line]"));
    return rows.filter(row => row.querySelector("[data-include]")?.checked).map(row => ({
      ...previewQuote.lines[Number(row.dataset.fletcherLine)],
      assignment: row.querySelector("[data-assignment]").value
    }));
  }

  function updatePreviewTotals() {
    const lines = selectedPreviewLines();
    const solar = lines.filter(line => line.assignment === "shared").reduce((sum, line) => sum + line.extension_ex_gst, 0);
    const battery = lines.reduce((sum, line) => sum + line.extension_ex_gst, 0);
    const solarTotal = document.getElementById("fletcherSolarSubtotal");
    const batteryTotal = document.getElementById("fletcherBatterySubtotal");
    if (solarTotal) solarTotal.textContent = money(solar);
    if (batteryTotal) batteryTotal.textContent = money(battery);
  }

  function renderPreview() {
    const target = document.getElementById("fletcherImportPreview");
    const quote = previewQuote;
    if (!target || !quote) return;
    const warnings = quote.warnings || [];
    target.innerHTML = `
      <div class="fletcher-import-summary">
        <span><strong>Quote:</strong> ${html(quote.quote_number || "Not shown")}</span>
        <span><strong>Project:</strong> ${html(quote.project || "Not shown")}</span>
        <span><strong>Printed subtotal:</strong> ${money(quote.subtotal_ex_gst)}</span>
        <span><strong>Lines found:</strong> ${quote.lines.length}</span>
      </div>
      ${warnings.length ? `<div class="error">${warnings.map(html).join(" ")}</div>` : ""}
      ${quote.exclusions.length ? `<div class="fletcher-import-exclusions"><strong>Supplier exclusions:</strong> ${quote.exclusions.map(html).join(" · ")}</div>` : ""}
      <table class="fletcher-import-table">
        <thead><tr><th>Use</th><th>Stock code / description</th><th>Costing options</th><th>Qty</th><th>Unit cost</th><th>Extension</th></tr></thead>
        <tbody>${quote.lines.map((line, index) => `
          <tr data-fletcher-line="${index}">
            <td><input type="checkbox" data-include checked aria-label="Include ${html(line.description)}"></td>
            <td><strong>${html(line.stock_code || "")}</strong><br>${html(line.description)}</td>
            <td><select data-assignment><option value="shared" ${line.assignment === "shared" ? "selected" : ""}>Both options</option><option value="battery_now" ${line.assignment === "battery_now" ? "selected" : ""}>Solar + Battery only</option></select></td>
            <td>${line.quantity} ${html(line.unit || "")}</td>
            <td>${money(line.unit_price_ex_gst)}</td>
            <td>${money(line.extension_ex_gst)}</td>
          </tr>`).join("")}</tbody>
      </table>
      <div class="fletcher-import-summary">
        <span><strong>${SOLAR_OPTION_NAME} materials:</strong> <span id="fletcherSolarSubtotal"></span> ex GST</span>
        <span><strong>${BATTERY_OPTION_NAME} materials:</strong> <span id="fletcherBatterySubtotal"></span> ex GST</span>
      </div>
      <div class="fletcher-import-actions">
        <button type="button" id="importFletcherQuote">APPROVE PREVIEW &amp; CREATE DRAFT OPTIONS</button>
        <span class="placeholder">Existing non-Fletcher costing lines will be kept.</span>
      </div>
    `;
    target.hidden = false;
    updatePreviewTotals();
  }

  function findOrCreateOptions() {
    const byName = name => costingState.options.find(option =>
      String(option.name || "").trim().toLowerCase() === name.toLowerCase()
    );
    let solar = byName(SOLAR_OPTION_NAME);
    let battery = byName(BATTERY_OPTION_NAME);
    const blankDefault = costingState.options.find(option =>
      /^option\s+1$/i.test(option.name || "") &&
      !costingState.allLines.some(line => line.option_id === option.id)
    );
    if (!solar) solar = blankDefault || { id: crypto.randomUUID() };
    if (!battery || battery.id === solar.id) battery = { id: crypto.randomUUID() };
    const markup = importerMarkup();
    return {
      solar: { ...solar, name: SOLAR_OPTION_NAME, status: "draft", default_markup_percent: markup },
      battery: { ...battery, name: BATTERY_OPTION_NAME, status: "draft", default_markup_percent: markup }
    };
  }

  function existingNonImportedLines(optionId) {
    return costingState.allLines
      .filter(line => line.option_id === optionId || !line.option_id)
      .filter(line => !String(line.supplier_name || "").startsWith(IMPORTED_SUPPLIER_PREFIX))
      .map(line => ({
        ...line,
        id: line.option_id ? line.id : crypto.randomUUID(),
        option_id: optionId,
        scope: "option"
      }));
  }

  function costingLine(line, optionId, markup, quoteNumber) {
    // Fletcher's printed unit price can be rounded while its extension is exact.
    // Derive the stored unit cost from the extension so costing totals reconcile.
    const exactUnitCost = line.quantity > 0
      ? Number((line.extension_ex_gst / line.quantity).toFixed(6))
      : line.unit_price_ex_gst;
    return {
      id: crypto.randomUUID(),
      option_id: optionId,
      scope: "option",
      supplier_product_id: "",
      supplier_name: `${IMPORTED_SUPPLIER_PREFIX} ${quoteNumber || ""}`.trim(),
      supplier_sku: line.stock_code || "",
      description: line.description,
      unit_code: line.unit || "EA",
      quantity: line.quantity,
      unit_cost: exactUnitCost,
      markup_percent: markup,
      customer_unit_price: Number((exactUnitCost * (1 + markup / 100)).toFixed(6)),
      category: "materials",
      display_mode: "show",
      combine_label: ""
    };
  }

  async function saveImportedOption(option, importedLines) {
    const preserved = existingNonImportedLines(option.id);
    const response = await fetch("/api/job-costing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: Number(jobId), option, lines: [...preserved, ...importedLines] })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `Could not save ${option.name}`);
    return data;
  }

  async function importQuote() {
    if (!previewQuote) return;
    const selected = selectedPreviewLines();
    if (!selected.length) {
      setMessage("Select at least one supplier line to import.", true);
      return;
    }
    const button = document.getElementById("importFletcherQuote");
    button.disabled = true;
    setMessage("Creating the two draft costing options...");
    try {
      const options = findOrCreateOptions();
      const markup = importerMarkup();
      const quoteNumber = previewQuote.quote_number;
      const sharedLines = selected.filter(line => line.assignment === "shared");
      const solarLines = sharedLines.map(line => costingLine(line, options.solar.id, markup, quoteNumber));
      const batteryLines = selected.map(line => costingLine(line, options.battery.id, markup, quoteNumber));
      await saveImportedOption(options.solar, solarLines);
      await saveImportedOption(options.battery, batteryLines);
      await loadCosting(options.solar.id);
      setMessage(`Imported ${selected.length} supplier lines. Both options are Draft so you can add exclusions, labour and certification before approval.`);
      document.getElementById("internalCostingSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener("click", event => {
    if (event.target?.id === "refreshFletcherQuotes") loadSupplierQuoteFiles();
    if (event.target?.id === "readFletcherQuote") readQuote();
    if (event.target?.id === "importFletcherQuote") importQuote();
  });
  document.addEventListener("change", event => {
    if (event.target?.matches?.("[data-include], [data-assignment]")) updatePreviewTotals();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installImporter);
  else installImporter();
})();
