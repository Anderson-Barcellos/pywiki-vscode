import assert from "node:assert/strict";
import { test } from "node:test";

async function loadTrigger(): Promise<{
  shouldScheduleAutoExplain?: (state: {
    autoExplain: boolean;
    viewVisible: boolean;
    selectionEmpty: boolean;
    explainOnCursor: boolean;
  }) => boolean;
}> {
  try {
    return await import("./trigger.ts");
  } catch {
    return {};
  }
}

test("auto-explicação exige uma seleção explícita por padrão", async () => {
  const { shouldScheduleAutoExplain } = await loadTrigger();
  assert.equal(typeof shouldScheduleAutoExplain, "function", "gate de seleção ainda não existe");

  assert.equal(shouldScheduleAutoExplain?.({
    autoExplain: true,
    viewVisible: true,
    selectionEmpty: true,
    explainOnCursor: false,
  }), false);
  assert.equal(shouldScheduleAutoExplain?.({
    autoExplain: true,
    viewVisible: true,
    selectionEmpty: false,
    explainOnCursor: false,
  }), true);
});

test("modo cursor é opt-in e nunca ignora painel oculto ou auto-explicação desligada", async () => {
  const { shouldScheduleAutoExplain } = await loadTrigger();
  assert.equal(typeof shouldScheduleAutoExplain, "function", "gate de seleção ainda não existe");

  assert.equal(shouldScheduleAutoExplain?.({
    autoExplain: true,
    viewVisible: true,
    selectionEmpty: true,
    explainOnCursor: true,
  }), true);
  assert.equal(shouldScheduleAutoExplain?.({
    autoExplain: true,
    viewVisible: false,
    selectionEmpty: false,
    explainOnCursor: true,
  }), false);
  assert.equal(shouldScheduleAutoExplain?.({
    autoExplain: false,
    viewVisible: true,
    selectionEmpty: false,
    explainOnCursor: true,
  }), false);
});
