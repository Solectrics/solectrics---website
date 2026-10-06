import test from "node:test";
import assert from "node:assert/strict";
import { hasPermission, membershipPermissions, moduleEnabled, normalizeVerifiedIdentity } from "../functions/api/business-access.js";

test("verified identities require provider subject, email and verification", () => {
  assert.deepEqual(normalizeVerifiedIdentity({provider:"Cloudflare Access", subject:"abc", email:"Jane@Example.com", email_verified:true}), {
    provider:"cloudflare access", subject:"abc", email:"jane@example.com"
  });
  assert.equal(normalizeVerifiedIdentity({provider:"cloudflare", subject:"abc", email:"jane@example.com", email_verified:false}), null);
});

test("membership permissions are role based and additive", () => {
  const membership = {status:"active", role:"operator", permissions_json:'["reports.read"]'};
  assert.equal(hasPermission(membership, "operations.write"), true);
  assert.equal(hasPermission(membership, "reports.read"), true);
  assert.equal(hasPermission(membership, "members.manage"), false);
  assert.equal(membershipPermissions({...membership, status:"suspended"}).size, 0);
});

test("module checks are opt-in and reject unknown module names", () => {
  const modules = [{module_code:"core_accounting", enabled:1}, {module_code:"pos", enabled:0}];
  assert.equal(moduleEnabled(modules, "core_accounting"), true);
  assert.equal(moduleEnabled(modules, "pos"), false);
  assert.equal(moduleEnabled(modules, "made_up"), false);
});
