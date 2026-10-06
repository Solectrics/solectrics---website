import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../config/initial-businesses.json", import.meta.url), "utf8"));
const seed = await readFile(new URL("../staging/seed-initial-businesses.sql", import.meta.url), "utf8");

test("initial business config keeps product schema generic and defines three installation businesses", () => {
  assert.equal(config.businesses.length, 3);
  assert.deepEqual(config.businesses.map(b => b.slug), ["solectrics", "sol-espresso", "yogacamp"]);
  assert.equal(config.identity_and_ownership.seed_users, false);
});

test("Solectrics enables trade and electrical modules", () => {
  const b = config.businesses.find(item => item.slug === "solectrics");
  assert.equal(b.modules.core_accounting, true);
  assert.equal(b.modules.jobs_trades, true);
  assert.equal(b.modules.electrical_solar, true);
  assert.equal(b.modules.events, false);
  assert.equal(b.modules.pos, true);
  assert.equal(b.book_strategy.link_existing_book, true);
});

test("Sol Espresso enables event and POS modules", () => {
  const b = config.businesses.find(item => item.slug === "sol-espresso");
  assert.equal(b.modules.core_accounting, true);
  assert.equal(b.modules.events, true);
  assert.equal(b.modules.pos, true);
  assert.equal(b.modules.jobs_trades, false);
  assert.equal(b.modules.electrical_solar, false);
});

test("YOGACAMP uses GBP with event and POS modules", () => {
  const b = config.businesses.find(item => item.slug === "yogacamp");
  assert.equal(b.currency, "GBP");
  assert.equal(b.timezone, "Europe/London");
  assert.equal(b.modules.core_accounting, true);
  assert.equal(b.modules.events, true);
  assert.equal(b.modules.pos, false);
});

test("seed only links a Solectrics book when exactly one active unassigned book exists", () => {
  assert.match(seed, /COUNT\(\*\).*bookkeeping_books WHERE active = 1 AND business_id IS NULL\) = 1/s);
  assert.match(seed, /business-solectrics/);
  assert.doesNotMatch(seed, /INSERT INTO jobhub_users/);
  assert.doesNotMatch(seed, /INSERT INTO jobhub_user_identities/);
  assert.doesNotMatch(seed, /INSERT INTO jobhub_business_memberships/);
  assert.doesNotMatch(seed, /INSERT INTO jobhub_business_owners/);
});
