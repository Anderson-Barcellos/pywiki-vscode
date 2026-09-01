# Changelog

## 0.6.2 — 2026-09-01
- Teto no hover do language server (`selwiki.maxHoverChars`, 2500) — era o único trecho do contexto sem cap.
- Usos reais com ±2 linhas de contexto (antes ±1) e quantidade configurável (`selwiki.maxUsages`, padrão 3).

## 0.6.1 — 2026-09-01
- `selwiki.autoExplain` agora vem **desligado** de fábrica: o gatilho principal é `Ctrl+Alt+W`.
- "O que faz" em prosa narrativa simples; "Parâmetros" ganhou um parágrafo sobre como os argumentos se combinam.
- Ícone novo (livro aberto + grafo de links) para Activity Bar e marketplace.
- README e CHANGELOG.

## 0.6.0 — 2026-08-29
- Tetos e higiene do contexto (`maxSelectedChars`, `maxDefinitionChars`, stubs em 1500).
- Usos reais do projeto (até 3) como evidência dos exemplos (`maxUsageChars`).
- Perguntas de seguimento sobre o símbolo atual.

## 0.1.0 → 0.5.0 — agosto/2026
- Sidebar com wiki do símbolo via LSP + OpenAI Responses API, cache local, chave no SecretStorage,
  landing de onboarding, syntax highlight, seleção expandida por `SelectionRange`.
