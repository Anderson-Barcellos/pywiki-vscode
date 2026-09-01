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
