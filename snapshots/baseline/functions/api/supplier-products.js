import { ensureSupplierCatalogueSchema } from "./_schema.js";

export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    if (!db) return Response.json({ ok: false, error: "D1 database binding DB is not available" }, { status: 500 });
    await ensureSupplierCatalogueSchema(db);

    const url = new URL(context.request.url);
    const query = (url.searchParams.get("query") || "").trim().slice(0, 200);
    const supplierId = (url.searchParams.get("supplier_id") || "").trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 250);
    const pattern = `%${query}%`;

    const where = ["supplier_products.active = 1"];
    const values = [];
    if (query) {
      where.push("(supplier_products.supplier_sku LIKE ? OR supplier_products.description LIKE ? OR supplier_products.brand LIKE ?)");
      values.push(pattern, pattern, pattern);
    }
    if (supplierId) {
      where.push("supplier_products.supplier_id = ?");
      values.push(supplierId);
    }

    const { results } = await db.prepare(`
      SELECT supplier_products.*, suppliers.name AS supplier_name
      FROM supplier_products
      JOIN suppliers ON suppliers.id = supplier_products.supplier_id
      WHERE ${where.join(" AND ")}
      ORDER BY supplier_products.description COLLATE NOCASE
      LIMIT ?
    `).bind(...values, limit).all();

    const imports = await db.prepare(`
      SELECT catalogue_imports.*, suppliers.name AS supplier_name
      FROM catalogue_imports
      JOIN suppliers ON suppliers.id = catalogue_imports.supplier_id
      ORDER BY catalogue_imports.imported_at DESC
      LIMIT 10
    `).all();
    const suppliers = await db.prepare("SELECT id, name, is_default FROM suppliers WHERE active = 1 ORDER BY is_default DESC, name COLLATE NOCASE").all();

    const supplierRows = suppliers.results || [];
    return Response.json({
      ok: true,
      products: results || [],
      suppliers: supplierRows,
      default_supplier_id: supplierRows.find(supplier => Number(supplier.is_default) === 1)?.id || "",
      imports: imports.results || []
    });
  } catch (error) {
    console.error("Supplier product search error:", error);
    return Response.json({ ok: false, error: error.message || "Could not load supplier products" }, { status: 500 });
  }
}
