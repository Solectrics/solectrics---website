export const MODULE_CODES = Object.freeze([
  "core_accounting",
  "jobs_trades",
  "events",
  "pos",
  "electrical_solar"
]);

export const ROLE_PERMISSIONS = Object.freeze({
  owner: ["business.manage", "members.manage", "books.manage", "accounting.write", "operations.write", "reports.read"],
  admin: ["members.manage", "books.manage", "accounting.write", "operations.write", "reports.read"],
  bookkeeper: ["books.read", "accounting.write", "reports.read"],
  manager: ["books.read", "accounting.read", "operations.write", "reports.read"],
  operator: ["books.read", "operations.write"],
  viewer: ["books.read", "accounting.read", "operations.read", "reports.read"]
});

export function normalizeVerifiedIdentity(identity = {}) {
  const provider = String(identity.provider || "").trim().toLowerCase();
  const subject = String(identity.subject || identity.provider_subject || "").trim();
  const email = String(identity.email || "").trim().toLowerCase();
  const verified = identity.email_verified === true || identity.email_verified === 1 || identity.email_verified === "true";
  if (!provider || !subject || !email || !verified) return null;
  return { provider, subject, email };
}

export function membershipPermissions(membership = {}) {
  if (membership.status !== "active") return new Set();
  const base = ROLE_PERMISSIONS[membership.role] || [];
  let extra = [];
  try {
    const parsed = Array.isArray(membership.permissions) ? membership.permissions : JSON.parse(membership.permissions_json || "[]");
    extra = Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : [];
  } catch {}
  return new Set([...base, ...extra]);
}

export function hasPermission(membership, permission) {
  return membershipPermissions(membership).has(permission);
}

export function moduleEnabled(modules, moduleCode) {
  if (!MODULE_CODES.includes(moduleCode)) return false;
  return (modules || []).some(module => module.module_code === moduleCode && Number(module.enabled) === 1);
}
