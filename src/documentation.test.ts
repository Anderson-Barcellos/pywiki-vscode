import assert from "node:assert/strict";
import { test } from "node:test";
import type { LspPack } from "./pack.ts";

const bareFunction: LspPack = {
  languageId: "python",
  fileName: "/workspace/math_utils.py",
  selectedText: "calcular_total",
  hoverText: "```python\ndef calcular_total(valor: float, taxa: float = 0.1) -> float\n```",
  signatureText: "calcular_total(valor: float, taxa: float = 0.1) -> float",
  definition: {
    path: "/workspace/math_utils.py",
    uri: "file:///workspace/math_utils.py",
    range: { start: { line: 1, character: 4 }, end: { line: 1, character: 19 } },
    text: "def calcular_total(valor: float, taxa: float = 0.1) -> float:\n    return valor * (1 + taxa)",
    isStub: false,
    name: "calcular_total",
  },
};

test("função sem docstring é identificada como documentação inferida", async () => {
  const module = await import("./pack.ts");
  const documentationSource = (module as typeof module & {
    documentationSource?: (pack: LspPack) => string;
  }).documentationSource;

  assert.equal(typeof documentationSource, "function", "documentationSource ainda não existe");
  assert.equal(documentationSource?.(bareFunction), "inferred");
});

test("docstring Python e prosa do hover são identificadas como documentação explícita", async () => {
  const module = await import("./pack.ts");
  const documentationSource = (module as typeof module & {
    documentationSource?: (pack: LspPack) => string;
  }).documentationSource;
  assert.equal(typeof documentationSource, "function", "documentationSource ainda não existe");

  const withDocstring: LspPack = {
    ...bareFunction,
    definition: {
      ...bareFunction.definition!,
      text: 'def calcular_total(valor: float) -> float:\n    """Aplica a taxa configurada ao valor."""\n    return valor * 1.1',
    },
  };
  const withHoverDocs: LspPack = {
    ...bareFunction,
    languageId: "typescript",
    hoverText: "```typescript\nfunction calcularTotal(valor: number): number\n```\nCalcula o total com a taxa vigente.",
    definition: { ...bareFunction.definition!, text: "function calcularTotal(valor: number) { return valor * 1.1; }" },
  };

  assert.equal(documentationSource?.(withDocstring), "explicit");
  assert.equal(documentationSource?.(withHoverDocs), "explicit");
});

test("prompt informa ao modelo quando a explicação deve ser marcada como inferida", async () => {
  const { buildMessages } = await import("./pack.ts");
  const prompt = buildMessages(bareFunction)[1]?.content ?? "";

  assert.match(prompt, /Status da documentação: inferida do código\/LSP/);
  assert.match(prompt, /não apresente inferências como docstring/);
});

test("prompt exige exemplo básico para símbolos chamáveis e limita exemplos adicionais à evidência", async () => {
  const { buildMessages } = await import("./pack.ts");
  const systemPrompt = buildMessages(bareFunction)[0]?.content ?? "";

  assert.match(systemPrompt, /## Exemplos/);
  assert.match(systemPrompt, /exemplo básico/);
  assert.match(systemPrompt, /segundo exemplo somente/);
});

test("cabeçalho '(function) def ...' do Pylance não conta como prosa explícita", async () => {
  const { documentationSource } = await import("./pack.ts");
  const pylance: LspPack = {
    ...bareFunction,
    hoverText: "(function) def calcular_total(valor: float, taxa: float = 0.1) -> float",
  };
  assert.equal(documentationSource(pylance), "inferred");
  const pylanceClass: LspPack = {
    ...bareFunction,
    hoverText: "(class) Foo\n(method) def bar(self) -> None",
  };
  assert.equal(documentationSource(pylanceClass), "inferred");
});
