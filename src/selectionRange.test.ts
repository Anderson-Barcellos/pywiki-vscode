import assert from "node:assert/strict";
import { test } from "node:test";

type PositionLike = { line: number; character: number };
type RangeLike = { start: PositionLike; end: PositionLike };

async function loadSelectionRange(): Promise<{
  resolveSelectionRange?: (
    uri: string,
    position: PositionLike,
    execute: (uri: string, positions: PositionLike[]) => Promise<Array<{ range: RangeLike }> | undefined>,
  ) => Promise<RangeLike | undefined>;
}> {
  try {
    return await import("./selectionRange.ts");
  } catch {
    return {};
  }
}

test("adapta o contrato do comando de selection range do VS Code", async () => {
  const { resolveSelectionRange } = await loadSelectionRange();
  assert.equal(typeof resolveSelectionRange, "function", "adaptador de selection range ainda não existe");

  const position = { line: 113, character: 30 };
  const expected = {
    start: { line: 110, character: 2 },
    end: { line: 116, character: 4 },
  };
  const range = await resolveSelectionRange?.("file:///workspace/example.ts", position, async (_uri, positions) => {
    if (!Array.isArray(positions) || positions.length !== 1 || positions[0] !== position) {
      throw new TypeError("VS Code exige Position[]");
    }
    return [{ range: expected }];
  });

  assert.deepEqual(range, expected);
});
