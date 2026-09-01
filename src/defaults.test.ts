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

test("tetos do contexto (0.6.5: chamadas custam < US$ 0,01, então os caps são generosos)", () => {
  assert.equal(props["selwiki.maxSelectedChars"].default, 16000);
  assert.equal(props["selwiki.maxDefinitionChars"].default, 10000);
  assert.equal(props["selwiki.maxUsageChars"].default, 500);
  assert.equal(props["selwiki.maxHoverChars"].default, 6000);
  assert.equal(props["selwiki.maxUsages"].default, 5);
  assert.equal(props["selwiki.maxUsages"].minimum, 1);
  assert.equal(props["selwiki.maxUsages"].maximum, 15);
});

test("contador de custo acumulado da sessão: extension soma, provider mostra, webview renderiza", () => {
  const ext = readFileSync(new URL("./extension.ts", import.meta.url), "utf8");
  assert.match(ext, /sessionCostUsd \+= /);
  assert.match(ext, /provider\.showSessionCost\(/);
  const provider = readFileSync(new URL("./viewProvider.ts", import.meta.url), "utf8");
  assert.match(provider, /showSessionCost\(/);
  assert.match(provider, /id="session-cost"/);
  const webview = readFileSync(new URL("./webview/main.ts", import.meta.url), "utf8");
  assert.match(webview, /case "session-cost"/);
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
  assert.match(src, /cfg\.get\("maxSelectedChars",\s*16000\)/);
  assert.match(src, /cfg\.get\("maxDefinitionChars",\s*10000\)/);
  assert.match(src, /cfg\.get\("maxUsageChars",\s*500\)/);
  assert.match(src, /cfg\.get\("maxHoverChars",\s*6000\)/);
  assert.match(src, /cfg\.get\("maxUsages",\s*5\)/);
});
