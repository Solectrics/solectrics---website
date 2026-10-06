import { membershipPermissions } from "./business-access.js";

function clean(value, limit = 500) {
  return String(value ?? "").trim().slice(0, limit);
}

function decodeBase64Url(value) {
  const normal = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normal + "=".repeat((4 - normal.length % 4) % 4);
  return atob(padded);
}

export function parseAccessJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(decodeURIComponent([...decodeBase64Url(parts[1])]
      .map(char => "%" + char.charCodeAt(0).toString(16).padStart(2, "0")).join("")));
  } catch {
    return null;
  }
}

export function accessIdentityFromRequest(request) {
  const email = clean(request.headers.get("cf-access-authenticated-user-email"), 254).toLowerCase();
  const assertion = clean(request.headers.get("cf-access-jwt-assertion"), 12000);
  if (!email || !assertion) return null;
  const payload = parseAccessJwtPayload(assertion);
  const subject = clean(payload?.sub, 500);
  const jwtEmail = clean(payload?.email, 254).toLowerCase();
  if (!subject || (jwtEmail && jwtEmail !== email)) return null;
  return {
    provider: "cloudflare_access",
    provider_subject: subject,
    email,
    email_verified: true
  };
}

export async function findVerifiedUser(db, identity) {
  if (!identity?.provider || !identity?.provider_subject || !identity?.email_verified) return null;
  return db.prepare(`SELECT u.id, u.primary_email, u.display_name, u.active
    FROM jobhub_user_identities i
    JOIN jobhub_users u ON u.id = i.user_id
    WHERE i.provider = ? AND i.provider_subject = ? AND i.email_verified = 1 AND u.active = 1
    LIMIT 1`).bind(identity.provider, identity.provider_subject).first();
}

export async function loadBusinessContexts(db, userId) {
  const memberships = await db.prepare(`SELECT
      m.id AS membership_id, m.business_id, m.role, m.permissions_json, m.status,
      b.slug, b.name, b.legal_name, b.business_type, b.currency, b.timezone,
      s.default_book_id, s.supplier_inbox_book_id, s.sales_book_id
    FROM jobhub_business_memberships m
    JOIN jobhub_businesses b ON b.id = m.business_id
    LEFT JOIN jobhub_business_book_settings s ON s.business_id = b.id
    WHERE m.user_id = ? AND m.status = 'active' AND b.active = 1
    ORDER BY b.name`).bind(userId).all();

  const businesses = [];
  for (const row of memberships.results || []) {
    const modules = await db.prepare(`SELECT module_code, enabled, settings_json
      FROM jobhub_business_modules WHERE business_id = ? ORDER BY module_code`)
      .bind(row.business_id).all();
    const books = await db.prepare(`SELECT id, name, legal_name, currency, gst_registered, gst_number,
      gst_basis, commencement_date, book_code, book_role, active
      FROM bookkeeping_books WHERE business_id = ? AND active = 1 ORDER BY name`)
      .bind(row.business_id).all();
    businesses.push({
      id: row.business_id,
      slug: row.slug,
      name: row.name,
      legal_name: row.legal_name,
      business_type: row.business_type,
      currency: row.currency,
      timezone: row.timezone,
      membership: {
        id: row.membership_id,
        role: row.role,
        permissions: [...membershipPermissions(row)]
      },
      modules: (modules.results || []).map(module => ({
        module_code: module.module_code,
        enabled: Number(module.enabled) === 1
      })),
      books: books.results || [],
      book_settings: {
        default_book_id: row.default_book_id || null,
        supplier_inbox_book_id: row.supplier_inbox_book_id || null,
        sales_book_id: row.sales_book_id || null
      }
    });
  }
  return businesses;
}

export function selectBusinessContext(businesses, requestedBusinessId) {
  const list = Array.isArray(businesses) ? businesses : [];
  const requested = clean(requestedBusinessId, 100);
  if (requested) return list.find(item => item.id === requested || item.slug === requested) || null;
  return list.length === 1 ? list[0] : null;
}

export async function resolveBusinessContext(context, requestedBusinessId = "") {
  const db = context.env.DB;
  if (!db) return { mode: "unavailable", identity: null, user: null, businesses: [], selected_business: null };
  const identity = accessIdentityFromRequest(context.request);
  if (!identity) return { mode: "legacy", identity: null, user: null, businesses: [], selected_business: null };
  try {
    const user = await findVerifiedUser(db, identity);
    if (!user) return { mode: "unconfigured_identity", identity, user: null, businesses: [], selected_business: null };
    const businesses = await loadBusinessContexts(db, user.id);
    return {
      mode: businesses.length ? "configured" : "unconfigured_business",
      identity,
      user,
      businesses,
      selected_business: selectBusinessContext(businesses, requestedBusinessId)
    };
  } catch (error) {
    if (/no such table|no such column/i.test(String(error?.message || error))) {
      return { mode: "legacy", identity, user: null, businesses: [], selected_business: null };
    }
    throw error;
  }
}
