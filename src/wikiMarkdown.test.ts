import assert from "node:assert/strict";
import { test } from "node:test";

async function loadRenderer(): Promise<{
  renderWikiMarkdown?: (markdown: string) => string;
}> {
  try {
    return await import("./wikiMarkdown.ts");
  } catch {
    return {};
  }
}

test("título principal vira hero e seções recebem hierarquia própria", async () => {
  const { renderWikiMarkdown } = await loadRenderer();
  assert.equal(typeof renderWikiMarkdown, "function", "renderWikiMarkdown ainda não existe");

  const html = renderWikiMarkdown?.("# calcular_total\n\n## Parâmetros\n\nExplicação.") ?? "";
  assert.match(html, /class="wiki-hero"/);
  assert.match(html, /<h1>calcular_total<\/h1>/);
  assert.match(html, /class="section-title"/);
});

test("bloco de código ganha linguagem, ação de copiar e conteúdo escapado", async () => {
  const { renderWikiMarkdown } = await loadRenderer();
  assert.equal(typeof renderWikiMarkdown, "function", "renderWikiMarkdown ainda não existe");

  const html = renderWikiMarkdown?.("```python\nprint('<seguro>')\n```") ?? "";
  assert.match(html, /class="code-shell"/);
  assert.match(html, />python<\/span>/);
  assert.match(html, /data-copy-code/);
  assert.match(html, /&lt;seguro&gt;/);
  assert.doesNotMatch(html, /<seguro>/);
});
