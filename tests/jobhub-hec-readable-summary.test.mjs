import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../mini-fergus-job.html",import.meta.url),"utf8");
test("HEC bills are grouped and nested instead of flattened",()=>{
  const code=html.slice(html.indexOf("function renderHecStructuredValue("),html.indexOf("function parseAnswers("));
  assert.match(code,/Electricity bills & tariffs/);
  assert.match(code,/hec-nested-row/);
  assert.match(code,/renderHecStructuredValue\(child,depth\+1\)/);
  assert.doesNotMatch(code,/join\(" • "\)/);
});
test("HEC summary uses responsive field layout and keeps original answers",()=>{
  assert.match(html,/\.hec-answer-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html,/\.hec-answer-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(html,/\$\{renderObject\(answers\)\}/);
});