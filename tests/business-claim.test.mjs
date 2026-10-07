import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../functions/api/business-config.js", import.meta.url), "utf8");
const ui = await readFile(new URL("../mini-fergus-business-settings.html", import.meta.url), "utf8");

test("seeded business claim requires verified identity and no active membership", () => {
  assert.match(api, /action === "claim_business"/);
  assert.match(api, /WHERE business_id = \? AND status = 'active' LIMIT 1/);
  assert.match(api, /already has an active owner or member/);
  assert.match(api, /'owner', 'active'/);
});

test("business settings surfaces only unclaimed businesses", () => {
  assert.match(api, /available_unclaimed_businesses/);
  assert.match(api, /NOT EXISTS/);
  assert.match(ui, /CLAIM BUSINESS/);
});
