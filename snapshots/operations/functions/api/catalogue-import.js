import { ensureSupplierCatalogueSchema } from "./_schema.js";

const MAX_PRODUCTS = 5000;

function text(value, maxLength = 500) {
  const result = String(value ?? "").trim();
  return result ? result.slice(0, maxLength) : null;
}

function price(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normaliseProduct(product) {
  return {
    supplier_sku: text(product.supplier_sku, 100),
    description: text(product.description, 1000),
    unit_code: text(product.unit_code, 40),
    category_code: text(product.category_code, 100),
    barcode: text(product.barcode, 100),
    list_price: price(product.list_price),
    buy_price: price(product.buy_price),
    gst_treatment: product.gst_treatment === "inclusive" ? "inclusive" : "exclusive",
    brand: text(product.brand, 200),
    manufacturer_sku: text(product.manufacturer_sku, 150),
    price_class: text(product.price_class, 100),
    source_price_date: text(product.source_price_date, 40)
  };
}

export async function onRequestPost(context) {
  try {
    const db = context.env.DB;
    if (!db) return Response.json({ ok: false, error: "D1 database binding DB is not available" }, { status: 500 });

    const body = await context.request.json();
    const supplierName = text(body.supplier_name, 200);
    if (!supplierName) return Response.json({ ok: false, error: "Supplier name is required" }, { status: 400 });
    if (!Array.isArray(body.products) || !body.products.length) {
      return Response.json({ ok: false, error: "No catalogue products were supplied" }, { status: 400 });
    }
    if (body.products.length > MAX_PRODUCTS) {
      return Response.json({ ok: false, error: `A single import is limited to ${MAX_PRODUCTS} products` }, { status: 400 });
    }

    await ensureSupplierCatalogueSchema(db);

    let supplier = await db.prepare("SELECT id, name FROM suppliers WHERE name = ? COLLATE NOCASE").bind(supplierName).first();
    if (!supplier) {
      supplier = { id: crypto.randomUUID(), name: supplierName };
      await db.prepare("INSERT INTO suppliers (id, name) VALUES (?, ?)").bind(supplier.id, supplier.name).run();
    }

    const uniqueProducts = new Map();
    let skipped = 0;
    for (const rawProduct of body.products) {
      const product = normaliseProduct(rawProduct || {});
      if (!product.supplier_sku || !product.description) {
        skipped += 1;
        continue;
      }
      uniqueProducts.set(product.supplier_sku.toUpperCase(), product);
    }
    skipped += body.products.length - skipped - uniqueProducts.size;
    const products = [...uniqueProducts.values()];
    if (!products.length) {
      return Response.json({ ok: false, error: "No valid products had both a product code and description" }, { status: 400 });
    }

    const existing = new Set();
    for (let index = 0; index < products.length; index += 80) {
      const chunk = products.slice(index, index + 80);
      const placeholders = chunk.map(() => "?").join(",");
      const { results } = await db.prepare(
        `SELECT supplier_sku FROM supplier_products WHERE supplier_id = ? AND UPPER(supplier_sku) IN (${placeholders})`
      ).bind(supplier.id, ...chunk.map(product => product.supplier_sku.toUpperCase())).all();
      for (const row of results || []) existing.add(String(row.supplier_sku).toUpperCase());
    }

    const importedAt = new Date().toISOString();
    for (let index = 0; index < products.length; index += 50) {
      const statements = products.slice(index, index + 50).map(product => db.prepare(`
        INSERT INTO supplier_products (
          id, supplier_id, supplier_sku, description, unit_code, category_code, barcode,
          list_price, buy_price, gst_treatment, brand, manufacturer_sku, price_class,
          source_price_date, last_imported_at, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT (supplier_id, supplier_sku) DO UPDATE SET
          description = excluded.description,
          unit_code = excluded.unit_code,
          category_code = excluded.category_code,
          barcode = excluded.barcode,
          list_price = excluded.list_price,
          buy_price = excluded.buy_price,
          gst_treatment = excluded.gst_treatment,
          brand = excluded.brand,
          manufacturer_sku = excluded.manufacturer_sku,
          price_class = excluded.price_class,
          source_price_date = excluded.source_price_date,
          last_imported_at = excluded.last_imported_at,
          active = 1
      `).bind(
        crypto.randomUUID(), supplier.id, product.supplier_sku, product.description,
        product.unit_code, product.category_code, product.barcode, product.list_price,
        product.buy_price, product.gst_treatment, product.brand, product.manufacturer_sku,
        product.price_class, product.source_price_date, importedAt
      ));
      await db.batch(statements);
    }

    const createdCount = products.filter(product => !existing.has(product.supplier_sku.toUpperCase())).length;
    const updatedCount = products.length - createdCount;
    await db.prepare(`
      INSERT INTO catalogue_imports (
        id, supplier_id, source_filename, mapping_json, row_count,
        created_count, updated_count, skipped_count, imported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), supplier.id, text(body.source_filename, 300),
      JSON.stringify(body.mapping || {}), body.products.length,
      createdCount, updatedCount, skipped, importedAt
    ).run();

    return Response.json({
      ok: true,
      supplier: { id: supplier.id, name: supplier.name },
      summary: { received: body.products.length, imported: products.length, created: createdCount, updated: updatedCount, skipped }
    });
  } catch (error) {
    console.error("Catalogue import error:", error);
    return Response.json({ ok: false, error: error.message || "Catalogue import failed" }, { status: 500 });
  }
}
