import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMessages,
  cacheKey,
  cap,
  findInnermostSymbol,
  flattenHover,
  formatSignature,
  isEmptyPack,
  isStubPath,
  preferWorkspaceDefinitions,
  selectUsages,
  summarizeDefinition,
  SYSTEM_PROMPT,
  titleFromPack,
  type LspPack,
  type SymbolLike,
} from "./pack.ts";

const sample: LspPack = {
  languageId: "python",
  fileName: "/proj/app.py",
  selectedText: "Path.mkdir",
  hoverText: "def mkdir(mode=511, parents=False, exist_ok=False) -> None",
  signatureText: "mkdir(mode=511, parents=False, exist_ok=False)",
  definition: {
    path: "/usr/lib/python3.12/pathlib.pyi",
    uri: "file:///usr/lib/python3.12/pathlib.pyi",
    range: { start: { line: 10, character: 4 }, end: { line: 10, character: 9 } },
    text: "def mkdir(self, mode=511, parents=False, exist_ok=False): ...",
    isStub: true,
    name: "mkdir",
  },
};

test("cap corta e anota o restante", () => {
  const out = cap("abcdef", 4);
  assert.equal(out.startsWith("abcd"), true);
  assert.match(out, /cortado, 2 chars/);
  assert.equal(cap("abcd", 4), "abcd");
});

test("isStubPath reconhece typeshed, site-packages e .pyi", () => {
  assert.equal(isStubPath("/home/u/.pyenv/versions/3.12/lib/python3.12/pathlib.py"), true);
  assert.equal(isStubPath("/venv/lib/python3.12/site-packages/numpy/__init__.py"), true);
  assert.equal(isStubPath("/usr/lib/python3/dist-packages/requests/api.py"), true);
  assert.equal(isStubPath("/typeshed/stdlib/os/__init__.pyi"), true);
  assert.equal(isStubPath("/root/CLAUDE/sonaris/app.py"), false);
});

test("flattenHover junta markdown, código e string sem repetir", () => {
  const text = flattenHover([
    { contents: [{ language: "python", value: "def foo() -> int" }, { value: "Retorna um int" }] },
    { contents: "Retorna um int" },
    { contents: ["def foo() -> int"] },
  ]);
  assert.match(text, /```python/);
  assert.match(text, /Retorna um int/);
  assert.equal(text.split("Retorna um int").length, 2);
});

test("formatSignature usa a assinatura ativa", () => {
  const text = formatSignature({
    activeSignature: 1,
    signatures: [
      { label: "foo(a)", documentation: "primeira" },
      { label: "foo(a, b=1)", documentation: { value: "segunda" } },
    ],
  });
  assert.match(text, /foo\(a, b=1\)/);
  assert.match(text, /segunda/);
  assert.equal(formatSignature(null), "");
});

test("findInnermostSymbol escolhe o filho que contém a posição", () => {
  const symbols: SymbolLike[] = [
    {
      name: "Foo",
      range: { start: { line: 0, character: 0 }, end: { line: 40, character: 0 } },
      children: [
        {
          name: "bar",
          range: { start: { line: 10, character: 4 }, end: { line: 20, character: 0 } },
          children: [],
        },
      ],
    },
  ];
  const inner = findInnermostSymbol(symbols, 12, 8);
  assert.equal(inner?.name, "bar");
  const outer = findInnermostSymbol(symbols, 3, 0);
  assert.equal(outer?.name, "Foo");
  assert.equal(findInnermostSymbol(symbols, 80, 0), undefined);
});

test("cacheKey é estável e muda se o hover muda", () => {
  const profile = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  const a = cacheKey(sample, profile);
  const b = cacheKey({ ...sample }, profile);
  const c = cacheKey({ ...sample, hoverText: "outro" }, profile);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, cacheKey(sample, { ...profile, reasoningEffort: "high" }));
  assert.notEqual(a, cacheKey(sample, { ...profile, model: "outro-modelo" }));
});

test("buildMessages começa pelo system prompt e inclui o pacote LSP", () => {
  const messages = buildMessages(sample);
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[0]?.content, SYSTEM_PROMPT);
  assert.match(messages[1]?.content ?? "", /Path\.mkdir/);
  assert.match(messages[1]?.content ?? "", /stub\/biblioteca/);
  assert.match(messages[1]?.content ?? "", /Pylance\/Jedi/);
});

test("isEmptyPack e titleFromPack", () => {
  assert.equal(isEmptyPack(sample), false);
  assert.equal(
    isEmptyPack({
      languageId: "python",
      fileName: "a.py",
      selectedText: "  ",
      hoverText: "",
      signatureText: "",
      definition: null,
    }),
    true,
  );
  assert.equal(titleFromPack(sample), "mkdir");
});

test("isStubPath reconhece node_modules e .d.ts", () => {
  assert.equal(isStubPath("/proj/node_modules/marked/lib/marked.d.ts"), true);
  assert.equal(isStubPath("/proj/types/global.d.ts"), true);
  assert.equal(isStubPath("/proj/src/pack.ts"), false);
});

test("preferWorkspaceDefinitions coloca definições fora de stub na frente", () => {
  const stub = "/venv/lib/python3.12/site-packages/lib/api.py";
  const local = "/proj/app/api.py";
  const ordered = preferWorkspaceDefinitions([stub, local], (p) => p);
  assert.deepEqual(ordered, [local, stub]);
  assert.deepEqual(preferWorkspaceDefinitions([stub], (p) => p), [stub]);
});

test("summarizeDefinition devolve o texto intacto quando cabe no teto", () => {
  const symbol: SymbolLike = {
    name: "Foo",
    range: { start: { line: 0, character: 0 }, end: { line: 2, character: 0 } },
    children: [],
  };
  assert.equal(summarizeDefinition("class Foo:\n    pass\n", symbol, 100), "class Foo:\n    pass\n");
});

test("summarizeDefinition mantém cabeçalho e assinaturas quando a classe estoura o teto", () => {
  const body = Array.from({ length: 30 }, (_, i) => `        x${i} = ${i}`).join("\n");
  const text = [
    "class Foo:",
    '    """Faz coisas."""',
    "",
    "    def a(self) -> int:",
    body,
    "        return 1",
    "",
    "    def b(",
    "        self,",
    "        x: int,",
    "    ) -> None:",
    body,
    "        return None",
  ].join("\n");
  const symbol: SymbolLike = {
    name: "Foo",
    range: { start: { line: 10, character: 0 }, end: { line: 10 + 75, character: 0 } },
    children: [
      { name: "a", range: { start: { line: 13, character: 4 }, end: { line: 44, character: 0 } } },
      { name: "b", range: { start: { line: 46, character: 4 }, end: { line: 10 + 75, character: 0 } } },
    ],
  };
  const out = summarizeDefinition(text, symbol, 400);
  assert.match(out, /class Foo:/);
  assert.match(out, /Faz coisas/);
  assert.match(out, /def a\(self\) -> int:/);
  assert.match(out, /def b\(\n\s+self,\n\s+x: int,\n\s+\) -> None:/);
  assert.doesNotMatch(out, /x5 = 5/);
  assert.match(out, /resumido/);
  assert.ok(out.length <= 400 + 80, `tamanho ${out.length}`);
});

test("selectUsages descarta stubs e o próprio arquivo da definição, sem repetir e com teto", () => {
  const refs = [
    { path: "/proj/app/service.py", line: 10 },
    { path: "/venv/lib/python3.12/site-packages/lib/x.py", line: 3 },
    { path: "/proj/lib/api.py", line: 5 },
    { path: "/proj/app/service.py", line: 10 },
    { path: "/proj/app/cli.py", line: 22 },
    { path: "/proj/app/web.py", line: 1 },
    { path: "/proj/tests/test_api.py", line: 8 },
  ];
  const picked = selectUsages(refs, { definitionPath: "/proj/lib/api.py", max: 3 });
  assert.deepEqual(picked, [
    { path: "/proj/app/service.py", line: 10 },
    { path: "/proj/app/cli.py", line: 22 },
    { path: "/proj/app/web.py", line: 1 },
  ]);
});

test("usages entram no cacheKey e no prompt como seção própria", () => {
  const withUsages: LspPack = {
    ...sample,
    usages: [{ path: "/proj/app/service.py", line: 12, text: "Path(out).mkdir(parents=True, exist_ok=True)" }],
  };
  const profile = { model: "gpt-5.6-luna", reasoningEffort: "low" };
  assert.notEqual(cacheKey(sample, profile), cacheKey(withUsages, profile));
  const prompt = buildMessages(withUsages)[1]?.content ?? "";
  assert.match(prompt, /## Usos no projeto/);
  assert.match(prompt, /service\.py:13/);
  assert.match(prompt, /exist_ok=True/);
  assert.doesNotMatch(buildMessages(sample)[1]?.content ?? "", /## Usos no projeto/);
  assert.match(SYSTEM_PROMPT, /usos reais/i);
});

test("prompt pede prosa narrativa simples no 'O que faz' e explicação dos argumentos", () => {
  assert.match(SYSTEM_PROMPT, /## O que faz\n[^\n]*prosa/i);
  assert.match(SYSTEM_PROMPT, /linguagem simples/i);
  assert.match(SYSTEM_PROMPT, /## Parâmetros\n(?:[^\n]*\n){1,3}[^\n]*(?:parágrafo|prosa)/i);
});
