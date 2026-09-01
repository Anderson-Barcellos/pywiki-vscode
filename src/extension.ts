import * as vscode from "vscode";
import { WikiCache } from "./cache";
import { collectSelectionContext } from "./collect";
import { readFishOpenAiKey } from "./fishKey";
import { streamLuna } from "./luna";
import { buildMessages, cacheKey, isEmptyPack, titleFromPack, type LspPack } from "./pack";
import { WikiViewProvider, type ViewMessage } from "./viewProvider";
import { shouldScheduleAutoExplain } from "./trigger";

const SECRET_KEY = "selwiki.openaiKey";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const cache = new WikiCache(context.workspaceState);
  const provider = new WikiViewProvider(context.extensionUri);
  let abort: AbortController | undefined;
  let lastKey: string | undefined;
  let generation = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let activePack: LspPack | undefined;
  // Thread de seguimento: encadeia no último response da wiki ativa.
  let activeResponseId: string | undefined;
  let wikiCostUsd: number | undefined;
  let threadCostUsd = 0;
  let threadTurns = 0;

  const resetThread = (responseId?: string, cost?: number) => {
    activeResponseId = responseId;
    wikiCostUsd = cost;
    threadCostUsd = 0;
    threadTurns = 0;
  };

  const cancelActive = (notify = false) => {
    abort?.abort();
    abort = undefined;
    generation += 1;
    if (notify) {
      provider.showCancelled();
    }
  };

  const getApiKey = async (): Promise<string | undefined> => {
    const stored = await context.secrets.get(SECRET_KEY);
    if (stored?.trim()) {
      return stored.trim();
    }
    // Fish é a fonte do Anders. O host do VS Code costuma nascer no bash,
    // então process.env pode ter outra chave (inválida) com o mesmo nome.
    const fromFish = readFishOpenAiKey();
    if (fromFish) {
      return fromFish;
    }
    const env = process.env.OPENAI_API_KEY?.trim();
    return env || undefined;
  };

  const explain = async (opts: { force: boolean }) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      cancelActive();
      activePack = undefined;
      provider.showIdle("Abre um arquivo e seleciona um símbolo.");
      return;
    }
    const cfg = vscode.workspace.getConfiguration("selwiki");
    let pack: LspPack;
    try {
      pack = await collectSelectionContext(
        editor,
        cfg.get("maxSelectedChars", 8000),
        cfg.get("maxDefinitionChars", 4000),
        cfg.get("maxUsageChars", 300),
      );
    } catch (error) {
      provider.showError(error instanceof Error ? error.message : String(error));
      return;
    }
    if (isEmptyPack(pack)) {
      cancelActive();
      activePack = undefined;
      provider.showIdle("Nada resolvido nessa seleção. Clica numa função, classe ou builtin.");
      return;
    }
    const profile = {
      model: cfg.get("model", "gpt-5.6-luna"),
      reasoningEffort: cfg.get("reasoningEffort", "low"),
    };
    const key = cacheKey(pack, profile);
    if (!opts.force && key === lastKey) {
      return;
    }
    cancelActive();
    lastKey = key;
    activePack = pack;
    const cached = opts.force ? undefined : cache.get(key);
    if (cached) {
      resetThread(cached.responseId, cached.usage?.estimatedCostUsd);
      provider.showDone(pack, cached.markdown, {
        cached: true,
        responseId: cached.responseId,
        usage: cached.usage,
      });
      return;
    }
    const apiKey = await getApiKey();
    if (!apiKey) {
      provider.showNeedKey();
      return;
    }

    const request = new AbortController();
    abort = request;
    const current = generation;
    provider.showLoading(pack);
    provider.showStreaming(pack);
    try {
      const result = await streamLuna({
        apiKey,
        model: profile.model,
        reasoningEffort: profile.reasoningEffort,
        messages: buildMessages(pack),
        maxCompletionTokens: 1400,
        signal: request.signal,
        onDelta: (text) => {
          if (current === generation) {
            provider.showDelta(text);
          }
        },
      });
      if (current !== generation) {
        return;
      }
      if (!result.markdown.trim()) {
        provider.showError("O Luna não devolveu texto. Confere o modelo e a chave.");
        return;
      }
      await cache.set(key, {
        markdown: result.markdown,
        responseId: result.responseId,
        usage: result.usage,
        createdAt: Date.now(),
      });
      resetThread(result.responseId, result.usage?.estimatedCostUsd);
      provider.showDone(pack, result.markdown, {
        cached: false,
        responseId: result.responseId,
        usage: result.usage,
      });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        return;
      }
      if (current === generation) {
        provider.showError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (abort === request) {
        abort = undefined;
      }
    }
  };

  const followUp = async (question: string) => {
    const pack = activePack;
    const previous = activeResponseId;
    if (!pack || !previous) {
      provider.showFollowUpError("Não há wiki ativa para continuar. Gera a wiki primeiro.");
      return;
    }
    const apiKey = await getApiKey();
    if (!apiKey) {
      provider.showNeedKey();
      return;
    }
    const cfg = vscode.workspace.getConfiguration("selwiki");
    cancelActive();
    const request = new AbortController();
    abort = request;
    const current = generation;
    const title = titleFromPack(pack);
    provider.showFollowUpStart(question, title);
    try {
      const result = await streamLuna({
        apiKey,
        model: cfg.get("model", "gpt-5.6-luna"),
        reasoningEffort: cfg.get("reasoningEffort", "low"),
        messages: [{ role: "user", content: question }],
        previousResponseId: previous,
        maxCompletionTokens: 1000,
        signal: request.signal,
        onDelta: (text) => {
          if (current === generation) {
            provider.showFollowUpDelta(text);
          }
        },
      });
      if (current !== generation) {
        return;
      }
      if (!result.markdown.trim()) {
        provider.showFollowUpError("O Luna não devolveu texto para a pergunta.");
        return;
      }
      activeResponseId = result.responseId ?? previous;
      threadCostUsd += result.usage?.estimatedCostUsd ?? 0;
      threadTurns += 1;
      provider.showFollowUpDone({ title, wikiCostUsd, threadCostUsd, turns: threadTurns });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        return;
      }
      if (current === generation) {
        provider.showFollowUpError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (abort === request) {
        abort = undefined;
      }
    }
  };

  provider.setMessageHandler(async (message: ViewMessage) => {
    if (message.type === "followUp" && message.question?.trim()) {
      await followUp(message.question.trim());
    }
    if (message.type === "setKey" && message.key) {
      await context.secrets.store(SECRET_KEY, message.key.trim());
      vscode.window.showInformationMessage("PyWiki: chave salva no SecretStorage.");
      void explain({ force: true });
    }
    if (message.type === "useEnvKey") {
      if (process.env.OPENAI_API_KEY?.trim()) {
        await context.secrets.store(SECRET_KEY, process.env.OPENAI_API_KEY.trim());
        vscode.window.showInformationMessage("PyWiki: copiei OPENAI_API_KEY para o SecretStorage.");
        void explain({ force: true });
      } else {
        provider.showError("OPENAI_API_KEY não está definida neste processo do VS Code.");
      }
    }
    if (message.type === "refresh") {
      void explain({ force: true });
    }
    if (message.type === "cancel") {
      cancelActive(true);
    }
    if (message.type === "copy" && message.text?.trim()) {
      await vscode.env.clipboard.writeText(message.text);
      vscode.window.showInformationMessage(`PyWiki: ${message.label ?? "wiki"} copiado.`);
    }
    if (message.type === "openDefinition" && activePack?.definition) {
      const definition = activePack.definition;
      try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(definition.uri));
        const selection = new vscode.Range(
          definition.range.start.line,
          definition.range.start.character,
          definition.range.end.line,
          definition.range.end.character,
        );
        await vscode.window.showTextDocument(document, { selection, preview: true });
      } catch (error) {
        provider.showError(`Não consegui abrir a definição: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });

  const schedule = () => {
    const cfg = vscode.workspace.getConfiguration("selwiki");
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || !shouldScheduleAutoExplain({
      autoExplain: cfg.get("autoExplain", true),
      viewVisible: provider.visible,
      selectionEmpty: editor.selection.isEmpty,
      explainOnCursor: cfg.get("explainOnCursor", false),
    })) {
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void explain({ force: false });
    }, cfg.get("debounceMs", 500));
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WikiViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("selwiki.explainSelection", () => explain({ force: true })),
    vscode.commands.registerCommand("selwiki.setApiKey", async () => {
      const key = await vscode.window.showInputBox({
        prompt: "OpenAI API key para o PyWiki",
        password: true,
        ignoreFocusOut: true,
      });
      if (key?.trim()) {
        await context.secrets.store(SECRET_KEY, key.trim());
        vscode.window.showInformationMessage("PyWiki: chave salva.");
        void explain({ force: true });
      }
    }),
    vscode.commands.registerCommand("selwiki.clearCache", async () => {
      await cache.clear();
      lastKey = undefined;
      vscode.window.showInformationMessage("PyWiki: cache limpo.");
    }),
    vscode.window.onDidChangeTextEditorSelection(schedule),
    vscode.window.onDidChangeActiveTextEditor(schedule),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("selwiki")) {
        lastKey = undefined;
        schedule();
      }
    }),
    provider.onDidChangeVisible((visible) => {
      if (visible) {
        schedule();
      } else if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
    }),
    { dispose: () => cancelActive() },
  );
}

export function deactivate(): void {
  // nada a limpar além dos subscriptions
}
