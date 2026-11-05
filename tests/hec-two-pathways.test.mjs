import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { renderHomeEnergyCheckCopy } from "../functions/api/_hec-customer-copy.js";

const page=readFileSync(new URL("../home-energy-check.html",import.meta.url),"utf8");

test("HEC shows just the two agreed options without Solar Start",()=>{
  const pathways=page.slice(page.indexOf("<h3>Explore more with Solectrics</h3>"),page.indexOf('<p class="ss-note">'));
  assert.match(pathways,/<h4>1 — SOLAR SMART<\/h4>/);
  assert.match(pathways,/<h4>2 — SOLAR SMART \+ BATTERY<\/h4>/);
  assert.equal((pathways.match(/<h4>/g)||[]).length,2);
  assert.doesNotMatch(pathways,/SOLAR START|Three pathways/i);
});

test("HEC graph has two solar series and matches its two-item legend",()=>{
  const graphSource=page.slice(page.indexOf("function graph("),page.indexOf("/* =========================================================\n   FINAL REPORT"));
  assert.equal((graphSource.match(/d="\$\{path\(model\./g)||[]).length,2);
  assert.match(graphSource,/path\(model\.smartCost\)/);
  assert.match(graphSource,/path\(model\.batteryCost\)/);
  assert.doesNotMatch(graphSource,/path\(model\.currentCost\)|path\(model\.passiveCost\)/);
  const legend=page.slice(page.indexOf('<div class="ss-legend">'),page.indexOf('<div class="ss-smart-box">'));
  assert.equal((legend.match(/ss-legend-item/g)||[]).length,2);
});

test("HEC results email agrees for households with and without bills",()=>{
  for(const uploadedBillCount of [0,2]){
    const output=renderHomeEnergyCheckCopy({name:"Test",uploadedBillCount});
    assert.match(output,/Explore more with Solectrics/);
    assert.match(output,/<strong>1\. Solar Smart:<\/strong>/);
    assert.match(output,/<strong>2\. Solar Smart \+ Battery:<\/strong>/);
    assert.equal((output.match(/<strong>[12]\. Solar Smart/g)||[]).length,2);
    assert.doesNotMatch(output,/Solar Start|Three pathways/);
  }
});
