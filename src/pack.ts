export type RangeLike = {
  start: { line: number; character: number };
  end: { line: number; character: number };
};

export type SymbolLike = {
  name: string;
  range: RangeLike;
  selectionRange?: RangeLike;
  children?: SymbolLike[];
};

export type DefinitionPack = {
  path: string;
  uri: string;
  range: RangeLike;
  text: string;
  isStub: boolean;
  name: string;
};

export type ExplanationProfile = {
  model: string;
  reasoningEffort: string;
};

export type UsageRef = { path: string; line: number };

export type UsagePack = UsageRef & { text: string };

export type LspPack = {
  languageId: string;
  fileName: string;
  selectedText: string;
  hoverText: string;
  signatureText: string;
  definition: DefinitionPack | null;
  /** Chamadas reais no workspace (fora de stub e fora do arquivo da definição). */
  usages?: UsagePack[];
};

export const SYSTEM_PROMPT = `Você é um wiki de código no editor. Documenta o símbolo ou trecho que o engenheiro selecionou.

Regras:
- Use SOMENTE o contexto fornecido (hover, assinatura e definição). Não invente parâmetros, tipos, efeitos ou restrições.
- Se o contexto for de stub/typeshed/site-packages, trate como documentação da biblioteca, não como código do projeto.
- Quando o status for "inferida", explique o que o corpo e o LSP sustentam, mas não apresente inferências como docstring nem como garantia externa.
- Se um parâmetro não tiver descrição explícita, descreva apenas seu papel observável no corpo; se nem isso for possível, escreva "Não determinado pelo contexto".
- Se faltar informação, diga compactamente o que não dá para afirmar. Não crie seção vazia.
- Quando houver "Usos no projeto", prefira esses usos reais como base dos exemplos e cite o arquivo; não invente chamadas que o projeto não faz.
- Responda em português brasileiro, markdown compacto, sem prefácio.
- Use exatamente esta hierarquia, omitindo apenas seções sem evidência:
  # <nome>
  Uma frase direta dizendo o que é.
  ## Assinatura
  Um bloco de código com a linguagem correta.
  ## O que faz
  Explicação objetiva do fluxo e efeitos observáveis.
  ## Parâmetros
  Tabela markdown: Parâmetro | Tipo | Obrigatório | Descrição. Inclua defaults na descrição.
  ## Retorno
  Tipo e significado do retorno; mencione exceções somente se visíveis.
  ## Exemplos
  Para função, método ou classe chamável, inclua sempre um exemplo básico curto usando somente assinatura, tipos e defaults visíveis. Acrescente um segundo exemplo somente quando o contexto mostrar um default, variação ou caso de uso diferente. Para símbolo não chamável, omita se não houver exemplo seguro.
  ## Onde vive
  Caminho ou módulo.
  ## Cuidados
  Somente armadilhas realmente mostradas pelo contexto.

Para classes, adapte Parâmetros ao construtor e acrescente Atributos ou Métodos principais apenas quando estiverem visíveis. Para trechos livres, mantenha formato de artigo compacto sem forçar tabela.`;

export function cap(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n\n…[cortado, ${text.length - max} chars]`;
}

export function isStubPath(filePath: string): boolean {
  const p = filePath.replace(/\\/g, "/").toLowerCase();
  return (
    p.endsWith(".pyi") ||
    p.endsWith(".d.ts") ||
    p.includes("/node_modules/") ||
    p.includes("/site-packages/") ||
    p.includes("/dist-packages/") ||
    p.includes("/typeshed/") ||
    p.includes("/stdlib/") ||
    p.includes(".pylance/") ||
    /\/lib\/python\d/.test(p) ||
    /\/python\d+(\.\d+)*\/lib\//.test(p)
  );
}

export function preferWorkspaceDefinitions<T>(items: T[], pathOf: (item: T) => string): T[] {
  const workspace = items.filter((item) => !isStubPath(pathOf(item)));
  const stubs = items.filter((item) => isStubPath(pathOf(item)));
  return [...workspace, ...stubs];
}

/** Referências úteis como evidência: fora de stub, fora do arquivo da definição, sem repetição. */
export function selectUsages<T extends UsageRef>(
  refs: T[],
  opts: { definitionPath: string; max: number },
): T[] {
  const definition = opts.definitionPath.replace(/\\/g, "/");
  const seen = new Set<string>();
  const out: T[] = [];
  for (const ref of refs) {
    const path = ref.path.replace(/\\/g, "/");
    const key = `${path}:${ref.line}`;
    if (path === definition || isStubPath(path) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(ref);
    if (out.length >= opts.max) {
      break;
    }
  }
  return out;
}

const SIGNATURE_MAX_LINES = 8;

function signatureLines(lines: string[], from: number): string[] {
  const out: string[] = [];
  for (let i = from; i < lines.length && out.length < SIGNATURE_MAX_LINES; i += 1) {
    out.push(lines[i]);
    if (/[:{]\s*$/.test(lines[i]) || /\)\s*(->\s*[^:]+)?:?\s*$/.test(lines[i]) && !/,\s*$/.test(lines[i])) {
      break;
    }
  }
  return out;
}

/** Corpo de classe que estoura o teto vira cabeçalho + assinaturas dos filhos. */
export function summarizeDefinition(text: string, symbol: SymbolLike, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const children = (symbol.children ?? [])
    .filter((child) => child.range)
    .sort((a, b) => a.range.start.line - b.range.start.line);
  if (!children.length) {
    return cap(text, max);
  }
  const lines = text.split("\n");
  const base = symbol.range.start.line;
  const firstChildLine = Math.max(0, children[0].range.start.line - base);
  const header = lines.slice(0, firstChildLine).join("\n").trimEnd();
  const signatures = children.map((child) => {
    const start = child.range.start.line - base;
    if (start < 0 || start >= lines.length) {
      return "";
    }
    return signatureLines(lines, start).join("\n");
  }).filter(Boolean);
  const summary = [header, ...signatures].join("\n\n");
  const note = `\n\n…[corpo resumido: ${children.length} membros, só assinaturas; original ${text.length} chars]`;
  return cap(summary, Math.max(0, max - note.length)) + note;
}

function uniqueJoin(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.join("\n\n");
}

export function flattenHover(hovers: unknown): string {
  if (!hovers) {
    return "";
  }
  const list = Array.isArray(hovers) ? hovers : [hovers];
  const parts: string[] = [];
  for (const hover of list) {
    const contents = (hover as { contents?: unknown })?.contents ?? hover;
    const chunks = Array.isArray(contents) ? contents : [contents];
    for (const chunk of chunks) {
      if (typeof chunk === "string") {
        parts.push(chunk);
      } else if (chunk && typeof chunk === "object" && "value" in chunk) {
        const value = String((chunk as { value: unknown }).value ?? "");
        const language = (chunk as { language?: string }).language;
        if (language) {
          parts.push("```" + language + "\n" + value + "\n```");
        } else {
          parts.push(value);
        }
      }
    }
  }
  return uniqueJoin(parts);
}

export function formatSignature(sig: unknown): string {
  if (!sig || typeof sig !== "object") {
    return "";
  }
  const help = sig as {
    signatures?: Array<{
      label?: string;
      documentation?: string | { value?: string };
    }>;
    activeSignature?: number;
  };
  if (!help.signatures?.length) {
    return "";
  }
  const active = help.signatures[help.activeSignature ?? 0] ?? help.signatures[0];
  const docs =
    typeof active.documentation === "string"
      ? active.documentation
      : active.documentation?.value ?? "";
  return uniqueJoin([active.label ?? "", docs]);
}

function contains(range: RangeLike, line: number, character: number): boolean {
  const beforeStart =
    line < range.start.line ||
    (line === range.start.line && character < range.start.character);
  const afterEnd =
    line > range.end.line ||
    (line === range.end.line && character > range.end.character);
  return !beforeStart && !afterEnd;
}

export function findInnermostSymbol(
  symbols: SymbolLike[] | undefined,
  line: number,
  character: number,
): SymbolLike | undefined {
  if (!symbols?.length) {
    return undefined;
  }
  let best: SymbolLike | undefined;
  const walk = (items: SymbolLike[]) => {
    for (const item of items) {
      if (!item.range || !contains(item.range, line, character)) {
        continue;
      }
      best = item;
      if (item.children?.length) {
        walk(item.children);
      }
    }
  };
  walk(symbols);
  return best;
}

export function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function cacheKey(pack: LspPack, profile?: ExplanationProfile): string {
  return hashString(
    [
      SYSTEM_PROMPT,
      profile?.model ?? "",
      profile?.reasoningEffort ?? "",
      pack.languageId,
      pack.selectedText,
      pack.hoverText,
      pack.signatureText,
      pack.definition?.path ?? "",
      pack.definition?.uri ?? "",
      pack.definition?.text ?? "",
      ...(pack.usages ?? []).map((usage) => `${usage.path}:${usage.line}:${usage.text}`),
    ].join("\u0001"),
  );
}

export function isEmptyPack(pack: LspPack): boolean {
  return !pack.selectedText.trim() && !pack.hoverText.trim() && !pack.definition?.text.trim();
}

export type DocumentationSource = "explicit" | "inferred";

export function documentationSource(pack: LspPack): DocumentationSource {
  const definition = pack.definition?.text ?? "";
  const hasPythonDocstring =
    /^(?:[ \t]*@[^\n]+\r?\n)*[ \t]*(?:async[ \t]+)?(?:def|class)[\s\S]*?:[ \t]*\r?\n[ \t]+(?:[rubf]{0,2})?(?:"""|''')/im.test(
      definition,
    );
  const hasBlockDocs = /\/\*\*[\s\S]*?\*\//.test(definition);
  const hoverProse = pack.hoverText
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\s*(?:\((?:function|method|class|variable|module|property|parameter|constant)\)\s*)?(?:async\s+)?(?:def|class|function|interface|type)\b[^\n]*$/gim, "")
    .replace(/^\s*\((?:function|method|class|variable|module|property|parameter|constant)\)[^\n]*$/gim, "")
    .trim();

  return hasPythonDocstring || hasBlockDocs || hoverProse.length >= 12
    ? "explicit"
    : "inferred";
}

export function titleFromPack(pack: LspPack): string {
  const selected = pack.selectedText.trim().split(/\s+/)[0] ?? "";
  if (pack.definition?.name) {
    return pack.definition.name;
  }
  if (selected && selected.length < 80) {
    return selected;
  }
  return pack.languageId || "símbolo";
}

export function buildMessages(pack: LspPack): Array<{ role: "system" | "user"; content: string }> {
  const source = documentationSource(pack);
  const definitionBlock = pack.definition
    ? [
        `Caminho da definição: ${pack.definition.path}`,
        pack.definition.isStub ? "Origem: stub/biblioteca (não é código do projeto)" : "Origem: código do workspace",
        pack.definition.name ? `Nome no LSP: ${pack.definition.name}` : "",
        "```",
        pack.definition.text,
        "```",
      ]
        .filter(Boolean)
        .join("\n")
    : "(sem definição resolvida)";

  const user = [
    `Linguagem: ${pack.languageId}`,
    `Arquivo atual: ${pack.fileName}`,
    `Status da documentação: ${source === "explicit" ? "explícita no código/LSP" : "inferida do código/LSP — não apresente inferências como docstring"}`,
    "",
    "## Seleção",
    pack.selectedText.trim() || "(vazio — usar hover/definição)",
    "",
    "## Hover do language server (Pylance/Jedi/etc.)",
    pack.hoverText.trim() || "(vazio)",
    "",
    "## Assinatura",
    pack.signatureText.trim() || "(vazia)",
    "",
    "## Definição",
    definitionBlock,
    ...(pack.usages?.length
      ? [
          "",
          "## Usos no projeto",
          ...pack.usages.map((usage) => `${usage.path}:${usage.line + 1}\n\`\`\`\n${usage.text}\n\`\`\``),
        ]
      : []),
  ].join("\n");

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}
