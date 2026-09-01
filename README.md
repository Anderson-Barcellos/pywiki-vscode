# PyWiki

**An evidence-based wiki for the symbol under your cursor — right in the VS Code sidebar.**

*[Versão em português](README.pt-BR.md)*

Select a function, class or snippet (or just leave the cursor on it), press `Ctrl+Alt+W`, and PyWiki
builds a compact article: signature, what it does in plain prose, parameters, return value, examples
taken from **real usages in your project**, and where the symbol lives. Then ask follow-up questions
about that same symbol without leaving the editor.

The difference from "asking the chat" is evidence: PyWiki **does not read the whole file or guess** —
it asks the language server (Pylance, Jedi, …) what it already knows, packs that up, and instructs the
model to use **only** that context. Anything not in the code or its documentation is marked
"not determined by the context", not invented.

## How it works

1. **You select** — a word, a call, a block. With the cursor resting on a word, PyWiki expands to the
   whole symbol via the LSP `SelectionRange` request.
2. **The LSP provides the evidence** — hover, signature, definition (preferring workspace code over
   library stubs), and a few real references from the project (5 by default) to serve as examples.
3. **The model writes the wiki** — in markdown, following a fixed hierarchy and strict
   anti-hallucination rules. Rendered with syntax highlighting in the sidebar.
4. **Local cache** — the same symbol with the same context never triggers a new call. A typical query
   costs a fraction of a cent — the header shows the running total for the current VS Code session.

## Install and API key

Install the `.vsix` from the [latest release](../../releases/latest)
(`Extensions → ⋯ → Install from VSIX…`), open the **PyWiki** tab in the Activity Bar and paste your
OpenAI key on the welcome screen. The key goes into VS Code's **SecretStorage** — never into
`settings.json`, never into the workspace.

Alternatives: the *Use `OPENAI_API_KEY` from the environment* button (if VS Code was launched from a
shell that exports it), or the `PyWiki: Set OpenAI key` command from the palette. Use the same command
to replace the key.

## Usage

| Action | How |
|---|---|
| Explain selection / symbol under cursor | `Ctrl+Alt+W` (`Cmd+Alt+W` on Mac), or right-click → *PyWiki: Explain selection* |
| Follow-up question | *Ask about this symbol…* field at the bottom of the wiki |
| Re-explain, bypassing the cache | `Ctrl+Alt+W` again on the same symbol |
| Clear the cache | Palette → `PyWiki: Clear cache` |

By default the sidebar **only updates when you ask**. If you prefer it to follow your selection on
its own, enable `selwiki.autoExplain` (and optionally `selwiki.explainOnCursor`).

## Settings

| Setting | Default | What it does |
|---|---|---|
| `selwiki.model` | `gpt-5.6-luna` | OpenAI model (Responses API). Must be available on your account |
| `selwiki.reasoningEffort` | `low` | Reasoning effort. `low` is fast and cheap; `medium`/`high` for denser code |
| `selwiki.autoExplain` | `false` | Update the wiki automatically when the selection changes (debounced), if the panel is visible |
| `selwiki.explainOnCursor` | `false` | With `autoExplain`, also trigger on plain cursor moves |
| `selwiki.debounceMs` | `500` | Wait after the last selection change in automatic mode |
| `selwiki.maxSelectedChars` | `16000` | Cap on the selected text sent to the model |
| `selwiki.maxDefinitionChars` | `10000` | Cap on the definition body (library stubs are cut at 3000) |
| `selwiki.maxUsageChars` | `500` | Cap on each real project usage (±2 lines around the call) used as evidence for examples |
| `selwiki.maxUsages` | `5` | How many real usages are included as evidence (1–15) |
| `selwiki.maxHoverChars` | `6000` | Cap on the language server hover — huge library docstrings are cut here |

## What the wiki contains

```
# symbol_name
One direct sentence saying what it is.
## Signature       ## What it does (plain prose, from what goes in to what comes out)
## Parameters      (one item per parameter + how the arguments combine in practice)
## Returns         ## Examples (built from real project usages)
## Where it lives  ## Caveats (only pitfalls visible in the context)
```

Sections without evidence are omitted, not filled with guesses.

## Privacy

The only thing that leaves your machine is the context bundle built from the LSP: the selected
snippet, hover, signature, the definition (with the caps above) and 5 lines of each chosen usage.
Nothing is sent unless you press the shortcut (or deliberately enable automatic mode). The key stays
in SecretStorage.

## Development

```bash
npm install && npm test        # test suite with node --test (no VS Code needed)
npm run watch                  # esbuild in watch mode; F5 opens the Extension Host
npm run package                # builds selwiki-<version>.vsix
```

Made with care in Rio Grande do Sul, Brazil. 🧉
