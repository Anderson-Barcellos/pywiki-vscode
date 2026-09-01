import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFishValue, parseFishOpenAiKey } from "./fishKey.ts";

test("decodeFishValue resolve \\x2d e aspas", () => {
  assert.equal(decodeFishValue("sk\\x2dproj\\x2dabc"), "sk-proj-abc");
  assert.equal(decodeFishValue("'sk-proj-abc'"), "sk-proj-abc");
});

test("parseFishOpenAiKey prefere OPENAI_API_KEY e ignora OPENAI_api_key", () => {
  const text = [
    "SETUVAR --export OPENAI_api_key:sk\\x2dproj\\x2dDEAD",
    "SETUVAR --export OPENAI_API_KEY:sk\\x2dproj\\x2dLIVE",
  ].join("\n");
  assert.equal(parseFishOpenAiKey(text), "sk-proj-LIVE");
});

test("parseFishOpenAiKey lê set -Ux do config.fish", () => {
  const text = "    set -Ux OPENAI_API_KEY 'sk-proj-FROMCONFIG'\n";
  assert.equal(parseFishOpenAiKey(text), "sk-proj-FROMCONFIG");
});
