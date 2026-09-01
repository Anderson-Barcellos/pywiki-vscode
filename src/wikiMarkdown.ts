import { Marked } from "marked";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function languageName(raw: string | undefined): string {
  return (raw?.trim().split(/\s+/)[0] ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_+-]/g, "") || "texto";
}

const wikiMarked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    heading({ tokens, depth }) {
      const title = this.parser.parseInline(tokens);
      if (depth === 1) {
        return `<section class="wiki-hero"><span class="wiki-eyebrow">PyWiki</span><h1>${title}</h1></section>\n`;
      }
      return `<h${depth} class="${depth === 2 ? "section-title" : "subsection-title"}">${title}</h${depth}>\n`;
    },
    code({ text, lang }) {
      const language = languageName(lang);
      return [
        `<div class="code-shell">`,
        `<div class="code-toolbar"><span>${escapeHtml(language)}</span><button type="button" data-copy-code>Copiar</button></div>`,
        `<pre><code class="language-${escapeHtml(language)}">${escapeHtml(text)}\n</code></pre>`,
        `</div>\n`,
      ].join("");
    },
  },
});

export function renderWikiMarkdown(markdown: string): string {
  return wikiMarked.parse(markdown, { async: false });
}
