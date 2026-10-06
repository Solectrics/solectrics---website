import { MODULE_CODES, hasPermission, normalizeVerifiedIdentity } from "./business-access.js";
import { accessIdentityFromRequest, findVerifiedUser, loadBusinessContexts } from "./business-context.js";

function fail(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}
function clean(value, limit = 500) {
  return String(value ?? "").trim().slice(0, limit);
}
function slugify(value) {
  return clean(value, 100).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
async function requireIdentity(context) {
  const raw = accessIdentityFromRequest(context.request);
  const identity = normalizeVerifiedIdentity(raw || {});
  if (!identity) return { error: fail("Verified Cloudflare Access identity is required", 401) };
  return { identity };
}
async function membershipFor(db, userId, businessId) {
  return db.prepare(`SELECT * FROM jobhub_business_memberships
    WHERE user_id = ? AND business_id = ? AND status = 'active' LIMIT 1`)
    .bind(userId, businessId).first();
}
async function requirePermission(db, userId, businessId, permission) {
  const membership = await membershipFor(db, userId, businessId);
  if (!membership || !hasPermission(membership, permission)) return null;
  return membership;
}

export async function onRequestGet(context) {
  const db = context.env.DB;
  if (!db) return fail("D1 database binding DB is not available", 500);
  try {
    const auth = await requireIdentity(context);
    if (auth.error) return auth.error;
    const user = await findVerifiedUser(db, auth.identity);
    if (!user) return Response.json({ ok: true, identity: auth.identity, user: null, businesses: [] });
    const businesses = await loadBusinessContexts(db, user.id);
    return Response.json({ ok: true, identity: auth.identity, user, businesses });
  } catch (error) {
    console.error("Business config GET error:", error);
    if (/no such table|no such column/i.test(String(error?.message || error))) return fail("Business configuration migration is not applied", 409);
    return fail("Unable to load business configuration", 500);
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  if (!db) return fail("D1 database binding DB is not available", 500);
  try {
    const auth = await requireIdentity(context);
    if (auth.error) return auth.error;
    const body = await context.request.json();
    const action = clean(body.action, 80);

    if (action === "bootstrap_business") {
      let user = await findVerifiedUser(db, auth.identity);
      const userId = user?.id || crypto.randomUUID();
      const businessId = clean(body.business_id, 100) || crypto.randomUUID();
      const name = clean(body.name, 160);
      const slug = slugify(body.slug || name);
      if (!name || !slug) return fail("Business name is required");
      if (!user) {
        await db.prepare(`INSERT INTO jobhub_users (id, primary_email, display_name)
          VALUES (?, ?, ?)`).bind(userId, auth.identity.email, clean(body.display_name, 160) || null).run();
        await db.prepare(`INSERT INTO jobhub_user_identities
          (id, user_id, provider, provider_subject, email, email_verified, verified_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
          .bind(crypto.randomUUID(), userId, auth.identity.provider, auth.identity.subject, auth.identity.email).run();
      }
      const existingMemberships = await db.prepare(`SELECT COUNT(*) AS count FROM jobhub_business_memberships
        WHERE user_id = ? AND status = 'active'`).bind(userId).first();
      if (Number(existingMemberships?.count || 0) > 0) {
        return fail("Use an existing owner/admin business to add another business", 403);
      }
      await db.batch([
        db.prepare(`INSERT INTO jobhub_businesses
          (id, slug, name, legal_name, business_type, currency, timezone)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(businessId, slug, name, clean(body.legal_name, 200) || null,
            ["company","sole_trader","partnership","trust","charity","other"].includes(body.business_type) ? body.business_type : "other",
            clean(body.currency, 3).toUpperCase() || "NZD", clean(body.timezone, 100) || "Pacific/Auckland"),
        db.prepare(`INSERT INTO jobhub_business_memberships
          (id, business_id, user_id, role, status, joined_at)
          VALUES (?, ?, ?, 'owner', 'active', CURRENT_TIMESTAMP)`)
          .bind(crypto.randomUUID(), businessId, userId),
        db.prepare(`INSERT INTO jobhub_business_owners
          (id, business_id, user_id, ownership_percent, ownership_type, is_primary)
          VALUES (?, ?, ?, ?, 'owner', 1)`)
          .bind(crypto.randomUUID(), businessId, userId,
            body.ownership_percent === null || body.ownership_percent === undefined ? null : Number(body.ownership_percent)),
        db.prepare(`INSERT INTO jobhub_business_modules (id, business_id, module_code, enabled)
          VALUES (?, ?, 'core_accounting', 1)`).bind(crypto.randomUUID(), businessId),
        db.prepare(`INSERT INTO jobhub_business_book_settings (business_id) VALUES (?)`).bind(businessId)
      ]);
      return Response.json({ ok: true, business_id: businessId }, { status: 201 });
    }

    const user = await findVerifiedUser(db, auth.identity);
    if (!user) return fail("This identity has not been configured in Job Hub", 403);
    const businessId = clean(body.business_id, 100);
    if (!businessId) return fail("business_id is required");

    if (action === "set_modules") {
      if (!(await requirePermission(db, user.id, businessId, "business.manage"))) return fail("Business owner permission is required", 403);
      const requested = Array.isArray(body.modules) ? body.modules : [];
      const map = new Map(requested.filter(item => MODULE_CODES.includes(item.module_code))
        .map(item => [item.module_code, item.enabled ? 1 : 0]));
      map.set("core_accounting", 1);
      const statements = [...map.entries()].map(([moduleCode, enabled]) =>
        db.prepare(`INSERT INTO jobhub_business_modules (id, business_id, module_code, enabled, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(business_id, module_code) DO UPDATE SET enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP`)
          .bind(crypto.randomUUID(), businessId, moduleCode, enabled));
      if (statements.length) await db.batch(statements);
      return Response.json({ ok: true });
    }

    if (action === "link_book") {
      if (!(await requirePermission(db, user.id, businessId, "books.manage"))) return fail("Book management permission is required", 403);
      const bookId = clean(body.book_id, 100);
      const book = await db.prepare("SELECT id, business_id FROM bookkeeping_books WHERE id = ? AND active = 1").bind(bookId).first();
      if (!book) return fail("Book not found", 404);
      if (book.business_id && book.business_id !== businessId) return fail("This book is already linked to another business", 409);
      await db.prepare(`UPDATE bookkeeping_books SET business_id = ?, book_code = COALESCE(?, book_code),
        book_role = COALESCE(?, book_role), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(businessId, clean(body.book_code, 60) || null,
          ["primary","management","historical","other"].includes(body.book_role) ? body.book_role : null, bookId).run();
      return Response.json({ ok: true, book_id: bookId });
    }

    if (action === "set_book_settings") {
      if (!(await requirePermission(db, user.id, businessId, "books.manage"))) return fail("Book management permission is required", 403);
      const fields = ["default_book_id", "supplier_inbox_book_id", "sales_book_id"];
      const values = {};
      for (const field of fields) {
        values[field] = clean(body[field], 100) || null;
        if (values[field]) {
          const linked = await db.prepare("SELECT id FROM bookkeeping_books WHERE id = ? AND business_id = ? AND active = 1")
            .bind(values[field], businessId).first();
          if (!linked) return fail(`${field} must be a book linked to this business`, 409);
        }
      }
      await db.prepare(`INSERT INTO jobhub_business_book_settings
        (business_id, default_book_id, supplier_inbox_book_id, sales_book_id, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(business_id) DO UPDATE SET
          default_book_id = excluded.default_book_id,
          supplier_inbox_book_id = excluded.supplier_inbox_book_id,
          sales_book_id = excluded.sales_book_id,
          updated_at = CURRENT_TIMESTAMP`)
        .bind(businessId, values.default_book_id, values.supplier_inbox_book_id, values.sales_book_id).run();
      return Response.json({ ok: true });
    }

    return fail("Unsupported business configuration action");
  } catch (error) {
    console.error("Business config POST error:", error);
    if (/no such table|no such column/i.test(String(error?.message || error))) return fail("Business configuration migration is not applied", 409);
    if (/unique constraint/i.test(String(error?.message || error))) return fail("This business, identity or membership already exists", 409);
    return fail("Unable to update business configuration", 500);
  }
}
