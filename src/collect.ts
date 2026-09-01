import * as vscode from "vscode";
import {
  cap,
  findInnermostSymbol,
  flattenHover,
  formatSignature,
  isStubPath,
  preferWorkspaceDefinitions,
  selectUsages,
  summarizeDefinition,
  type DefinitionPack,
  type LspPack,
  type RangeLike,
  type UsagePack,
  type SymbolLike,
} from "./pack";
import { resolveSelectionRange } from "./selectionRange";

function asRange(range: RangeLike | vscode.Range): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  );
}

function locationOf(
  item: vscode.Location | vscode.LocationLink,
): { uri: vscode.Uri; range: vscode.Range } | undefined {
  if ("targetUri" in item && item.targetUri) {
    return {
      uri: item.targetUri,
      range: item.targetSelectionRange ?? item.targetRange,
    };
  }
  if ("uri" in item && item.uri) {
    return { uri: item.uri, range: item.range };
  }
  return undefined;
}

async function extractDefinition(
  defs: Array<vscode.Location | vscode.LocationLink> | undefined,
  maxChars: number,
): Promise<DefinitionPack | null> {
  if (!defs?.length) {
    return null;
  }
  const located = defs
    .map(locationOf)
    .filter((item): item is { uri: vscode.Uri; range: vscode.Range } => Boolean(item));
  const loc = preferWorkspaceDefinitions(located, (item) => item.uri.fsPath)[0];
  if (!loc) {
    return null;
  }
  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(loc.uri);
  } catch {
    return null;
  }
  const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    "vscode.executeDocumentSymbolProvider",
    loc.uri,
  );
  const inner = findInnermostSymbol(
    symbols as unknown as SymbolLike[] | undefined,
    loc.range.start.line,
    loc.range.start.character,
  );
  const stub = isStubPath(loc.uri.fsPath);
  const limit = stub ? Math.min(maxChars, 1500) : maxChars;
  const text = inner
    ? summarizeDefinition(doc.getText(asRange(inner.range)), inner, limit)
    : cap(doc.getText(loc.range), limit);
  return {
    path: loc.uri.fsPath,
    uri: loc.uri.toString(),
    range: {
      start: { line: loc.range.start.line, character: loc.range.start.character },
      end: { line: loc.range.end.line, character: loc.range.end.character },
    },
    text,
    isStub: stub,
    name: inner?.name ?? "",
  };
}

const USAGE_MAX = 3;

async function collectUsages(
  uri: vscode.Uri,
  pos: vscode.Position,
  definitionPath: string,
  maxChars: number,
): Promise<UsagePack[]> {
  let refs: vscode.Location[] | undefined;
  try {
    refs = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      uri,
      pos,
    );
  } catch {
    return [];
  }
  const candidates = (refs ?? [])
    .filter((ref) => ref?.uri && ref.range)
    .map((ref) => ({ path: ref.uri.fsPath, line: ref.range.start.line, uri: ref.uri }));
  const picked = selectUsages(candidates, { definitionPath, max: USAGE_MAX });
  const out: UsagePack[] = [];
  for (const ref of picked) {
    try {
      const doc = await vscode.workspace.openTextDocument(ref.uri);
      const from = Math.max(0, ref.line - 1);
      const to = Math.min(doc.lineCount - 1, ref.line + 1);
      const text = doc.getText(new vscode.Range(from, 0, to, doc.lineAt(to).text.length));
      out.push({ path: ref.path, line: ref.line, text: cap(text, maxChars) });
    } catch {
      // arquivo não abre (binário, removido): segue para o próximo
    }
  }
  return out;
}

export async function collectSelectionContext(
  editor: vscode.TextEditor,
  maxSelected: number,
  maxDefinition: number,
  maxUsageChars = 300,
): Promise<LspPack> {
  const doc = editor.document;
  const sel = editor.selection;
  let range: vscode.Range = sel.isEmpty
    ? (doc.getWordRangeAtPosition(sel.active) ?? new vscode.Range(sel.active, sel.active))
    : new vscode.Range(sel.start, sel.end);

  if (range.isEmpty) {
    const selectionRange = await resolveSelectionRange(
      doc.uri,
      sel.active,
      (uri, positions) => vscode.commands.executeCommand<vscode.SelectionRange[]>(
        "vscode.executeSelectionRangeProvider",
        uri,
        positions,
      ),
    );
    if (selectionRange) {
      range = selectionRange;
    }
  }

  const pos = range.isEmpty ? sel.active : range.start;
  const [hovers, defs, typeDefs, sig, symbols] = await Promise.all([
    vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", doc.uri, pos),
    vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
      "vscode.executeDefinitionProvider",
      doc.uri,
      pos,
    ),
    vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
      "vscode.executeTypeDefinitionProvider",
      doc.uri,
      pos,
    ),
    vscode.commands.executeCommand<vscode.SignatureHelp>(
      "vscode.executeSignatureHelpProvider",
      doc.uri,
      pos,
    ),
    vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      doc.uri,
    ),
  ]);

  let definition = await extractDefinition(defs, maxDefinition);
  if (!definition) {
    definition = await extractDefinition(typeDefs, maxDefinition);
  }
  if (!definition) {
    const inner = findInnermostSymbol(
      symbols as unknown as SymbolLike[] | undefined,
      pos.line,
      pos.character,
    );
    if (inner) {
      definition = {
        path: doc.uri.fsPath,
        uri: doc.uri.toString(),
        range: inner.selectionRange ?? inner.range,
        text: summarizeDefinition(doc.getText(asRange(inner.range)), inner, maxDefinition),
        isStub: isStubPath(doc.uri.fsPath),
        name: inner.name,
      };
    }
  }

  const usages = definition
    ? await collectUsages(doc.uri, pos, definition.path, maxUsageChars)
    : [];

  return {
    languageId: doc.languageId,
    fileName: doc.uri.fsPath,
    selectedText: cap(doc.getText(range), maxSelected),
    hoverText: flattenHover(hovers),
    signatureText: formatSignature(sig),
    definition,
    usages,
  };
}
