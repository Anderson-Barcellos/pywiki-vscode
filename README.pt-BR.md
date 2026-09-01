# PyWiki

**Uma wiki confiável do símbolo que está debaixo do teu cursor — direto na sidebar do VS Code.**

*[English version](README.md)*

Seleciona uma função, classe ou trecho (ou só deixa o cursor em cima), aperta `Ctrl+Alt+W`, e o PyWiki
monta um artigo compacto com assinatura, o que faz em prosa simples, parâmetros, retorno, exemplos
baseados em **usos reais do teu projeto** e onde o símbolo vive. Depois tu pode fazer perguntas de
seguimento sobre aquele mesmo símbolo, sem sair do editor.

A diferença para "perguntar pro chat" é a evidência: o PyWiki **não lê o arquivo inteiro nem adivinha** —
ele pergunta ao language server (Pylance, Jedi, etc.) o que ele já sabe, empacota isso e instrui o
modelo a usar **somente** esse contexto. O que não está no código ou na documentação vem marcado como
"não determinado pelo contexto", não inventado.

## Como funciona

1. **Tu seleciona** — uma palavra, uma chamada, um bloco. Com o cursor parado numa palavra, o PyWiki
   expande para o símbolo inteiro via `SelectionRange` do LSP.
2. **O LSP entrega a evidência** — hover, assinatura, definição (preferindo o código do workspace ao
   stub da biblioteca), e algumas referências reais do projeto (3 por padrão) para servir de exemplo.
3. **O modelo organiza a wiki** — em markdown, seguindo uma hierarquia fixa e regras rígidas
   anti-invenção. Renderiza com syntax highlight na sidebar.
4. **Cache local** — o mesmo símbolo com o mesmo contexto não gera nova chamada. Uma consulta típica
   custa menos de R$ 0,01.

## Instalação e chave

Instala o `.vsix` da [release mais recente](../../releases/latest) (`Extensions → ⋯ → Install from VSIX…`), abre a aba **PyWiki** na Activity Bar e
cola a tua chave da OpenAI na tela inicial. A chave vai para o **SecretStorage** do VS Code — nunca
para o `settings.json`, nunca para o workspace.

Alternativas: o botão *Usar `OPENAI_API_KEY` do ambiente* (se o VS Code foi aberto num shell que a
exporta), ou o comando `PyWiki: Definir chave OpenAI` na paleta. Para trocar a chave, é o mesmo comando.

## Uso

| Ação | Como |
|---|---|
| Explicar seleção / símbolo sob o cursor | `Ctrl+Alt+W` (`Cmd+Alt+W` no Mac), ou botão direito → *PyWiki: Explicar seleção* |
| Pergunta de seguimento | Campo *Pergunta sobre este símbolo…* no rodapé da wiki |
| Reexplicar ignorando o cache | `Ctrl+Alt+W` de novo sobre o mesmo símbolo |
| Limpar o cache | Paleta → `PyWiki: Limpar cache` |

Por padrão a sidebar **só atualiza quando tu pede**. Se preferir que ela acompanhe a seleção sozinha,
liga `selwiki.autoExplain` (e, opcionalmente, `selwiki.explainOnCursor`).

## Configurações

| Setting | Padrão | O que faz |
|---|---|---|
| `selwiki.model` | `gpt-5.6-luna` | Modelo OpenAI (Responses API). Precisa estar disponível na tua conta |
| `selwiki.reasoningEffort` | `low` | Esforço de reasoning. `low` é rápido e barato; `medium`/`high` para código mais denso |
| `selwiki.autoExplain` | `false` | Atualiza a wiki sozinha quando a seleção muda (com debounce), se o painel estiver visível |
| `selwiki.explainOnCursor` | `false` | Com `autoExplain`, também dispara ao só posicionar o cursor |
| `selwiki.debounceMs` | `500` | Espera após a última mudança de seleção no modo automático |
| `selwiki.maxSelectedChars` | `8000` | Teto do texto selecionado enviado ao modelo |
| `selwiki.maxDefinitionChars` | `4000` | Teto do corpo da definição (stubs de biblioteca são cortados em 1500) |
| `selwiki.maxUsageChars` | `300` | Teto de cada uso real do projeto (±2 linhas ao redor da chamada) usado como evidência dos exemplos |
| `selwiki.maxUsages` | `3` | Quantos usos reais entram como evidência (1–10) |
| `selwiki.maxHoverChars` | `2500` | Teto do hover do language server — docstrings gigantes de biblioteca são cortadas aqui |

## O que chega na wiki

```
# nome_do_símbolo
Uma frase direta dizendo o que é.
## Assinatura      ## O que faz (prosa simples, do que entra ao que sai)
## Parâmetros      (um item por parâmetro + como os argumentos se combinam na prática)
## Retorno         ## Exemplos (a partir dos usos reais do projeto)
## Onde vive       ## Cuidados (só armadilhas visíveis no contexto)
```

Seções sem evidência são omitidas, não preenchidas com chute.

## Privacidade

Sai da tua máquina apenas o pacote de contexto montado a partir do LSP: o trecho selecionado, hover,
assinatura, a definição (com os tetos acima) e 5 linhas de cada uso escolhido. Nada é enviado
sem tu apertar o atalho (ou ligar o modo automático de propósito). A chave fica no SecretStorage.

## Desenvolvimento

```bash
npm install && npm test        # suíte com node --test (sem VS Code)
npm run watch                  # esbuild em modo watch; F5 abre o Extension Host
npm run package                # gera selwiki-<versão>.vsix
```

Feito com carinho no Rio Grande do Sul. 🧉
