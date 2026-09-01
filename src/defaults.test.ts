import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const props = pkg.contributes.configuration.properties;

test("auto-explicação vem desligada de fábrica: o atalho é o gatilho principal", () => {
  assert.equal(props["selwiki.autoExplain"].default, false);
  assert.equal(props["selwiki.explainOnCursor"].default, false);
});

test("fallback do extension.ts concorda com o package.json", () => {
  const src = readFileSync(new URL("./extension.ts", import.meta.url), "utf8");
  assert.match(src, /cfg\.get\("autoExplain",\s*false\)/);
});

test("tetos novos do contexto: hover com cap e número de usos configurável", () => {
  assert.equal(props["selwiki.maxHoverChars"].default, 2500);
  assert.equal(props["selwiki.maxUsages"].default, 3);
  assert.equal(props["selwiki.maxUsages"].minimum, 1);
  assert.equal(props["selwiki.maxUsages"].maximum, 10);
});

test("collect.ts aplica o cap no hover e lê ±2 linhas de cada uso", () => {
  const src = readFileSync(new URL("./collect.ts", import.meta.url), "utf8");
  assert.match(src, /cap\(flattenHover\(hovers\),\s*\w+/);
  assert.match(src, /ref\.line - 2/);
  assert.match(src, /ref\.line \+ 2/);
  assert.doesNotMatch(src, /const USAGE_MAX = 3/);
});

test("extension.ts repassa maxHoverChars e maxUsages da configuração", () => {
  const src = readFileSync(new URL("./extension.ts", import.meta.url), "utf8");
  assert.match(src, /cfg\.get\("maxHoverChars",\s*2500\)/);
  assert.match(src, /cfg\.get\("maxUsages",\s*3\)/);
});
