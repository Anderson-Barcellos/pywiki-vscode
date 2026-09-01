import * as vscode from "vscode";
import type { WikiUsage } from "./cache";
import type { LspPack } from "./pack";
import { documentationSource, titleFromPack } from "./pack";

export type ViewMessage =
  | { type: "setKey"; key?: string }
  | { type: "useEnvKey" }
  | { type: "refresh" }
  | { type: "cancel" }
  | { type: "openDefinition" }
  | { type: "copy"; text?: string; label?: string }
  | { type: "followUp"; question?: string };

export class WikiViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "selwiki.view";

  private view?: vscode.WebviewView;
  private _visible = false;
  private readonly onVisibleEmitter = new vscode.EventEmitter<boolean>();
  readonly onDidChangeVisible = this.onVisibleEmitter.event;
  private messageHandler?: (message: ViewMessage) => void;
  private messageSub?: vscode.Disposable;

  constructor(private readonly extensionUri: vscode.Uri) {}

  get visible(): boolean {
    return this._visible && !!this.view;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this._visible = webviewView.visible;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    webviewView.webview.html = this.renderHtml(webviewView.webview);
    webviewView.onDidChangeVisibility(() => {
      this._visible = webviewView.visible;
      this.onVisibleEmitter.fire(webviewView.visible);
    });
    this.bindMessages();
  }

  setMessageHandler(handler: (message: ViewMessage) => void): void {
    this.messageHandler = handler;
    this.bindMessages();
  }

  private bindMessages(): void {
    this.messageSub?.dispose();
    if (this.view && this.messageHandler) {
      this.messageSub = this.view.webview.onDidReceiveMessage(this.messageHandler);
    }
  }

  post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }

  showIdle(text: string): void {
    this.post({ type: "status", text });
    this.post({ type: "context", visible: false });
    this.post({ type: "busy", value: false });
    this.post({ type: "idle", markdown: text });
  }

  showNeedKey(): void {
    this.post({ type: "busy", value: false });
    this.post({ type: "need-key" });
  }

  showContext(pack: LspPack): void {
    const definition = pack.definition;
    const fileName = (definition?.path || pack.fileName).replace(/\\/g, "/").split("/").pop();
    this.post({
      type: "context",
      visible: true,
      title: titleFromPack(pack),
      origin: definition ? (definition.isStub ? "biblioteca" : "workspace") : "seleção",
      fileName: fileName || pack.languageId,
      hasHover: Boolean(pack.hoverText.trim()),
      hasSignature: Boolean(pack.signatureText.trim()),
      documentation: documentationSource(pack),
      canOpen: Boolean(definition?.uri),
    });
  }

  showLoading(pack: LspPack): void {
    this.showContext(pack);
    this.post({ type: "ready" });
    this.post({ type: "busy", value: true });
    this.post({ type: "cost", visible: false });
    this.post({ type: "status", text: `Consultando LSP · ${titleFromPack(pack)}` });
    this.post({ type: "clear" });
  }

  showStreaming(pack: LspPack): void {
    this.post({ type: "status", text: `Luna · ${titleFromPack(pack)}` });
  }

  showDelta(text: string): void {
    this.post({ type: "delta", text });
  }

  showDone(
    pack: LspPack,
    markdown: string,
    meta: { cached: boolean; responseId?: string; usage?: WikiUsage },
  ): void {
    this.showContext(pack);
    this.post({ type: "busy", value: false });
    this.post({
      type: "status",
      text: `${meta.cached ? "cache local" : "Luna"} · ${titleFromPack(pack)}`,
    });
    const generatedCost = meta.usage?.estimatedCostUsd;
    this.post({
      type: "cost",
      visible: meta.cached || generatedCost !== undefined,
      text: meta.cached ? "US$ 0 agora" : generatedCost === undefined ? "" : `≈ US$ ${generatedCost.toFixed(4)}`,
      title: [
        meta.cached
          ? `Resposta idêntica recuperada do cache local. Geração original: US$ ${(generatedCost ?? 0).toFixed(4)}.`
          : generatedCost === undefined
            ? "Uso não informado pela API."
            : `${meta.usage?.inputTokens ?? 0} tokens de entrada · ${meta.usage?.outputTokens ?? 0} de saída.`,
        meta.responseId ? `Response ID: ${meta.responseId}` : "",
      ].filter(Boolean).join(" "),
    });
    this.post({ type: "done", markdown, canFollowUp: Boolean(meta.responseId) });
  }

  showFollowUpStart(question: string, title: string): void {
    this.post({ type: "busy", value: true });
    this.post({ type: "status", text: `Luna · seguimento · ${title}` });
    this.post({ type: "thread-start", question });
  }

  showFollowUpDelta(text: string): void {
    this.post({ type: "thread-delta", text });
  }

  showFollowUpDone(meta: { title: string; wikiCostUsd?: number; threadCostUsd: number; turns: number }): void {
    this.post({ type: "busy", value: false });
    this.post({ type: "status", text: `Luna · ${meta.title}` });
    const total = (meta.wikiCostUsd ?? 0) + meta.threadCostUsd;
    this.post({
      type: "cost",
      visible: true,
      text: `≈ US$ ${total.toFixed(4)}`,
      title: `Wiki US$ ${(meta.wikiCostUsd ?? 0).toFixed(4)} + ${meta.turns} pergunta(s) US$ ${meta.threadCostUsd.toFixed(4)}.`,
    });
    this.post({ type: "thread-done" });
  }

  showFollowUpError(text: string): void {
    this.post({ type: "busy", value: false });
    this.post({ type: "status", text: "erro no seguimento" });
    this.post({ type: "thread-error", text });
  }

  showError(text: string): void {
    this.post({ type: "busy", value: false });
    this.post({ type: "status", text: "erro" });
    this.post({ type: "error", text });
  }

  showCancelled(): void {
    this.post({ type: "busy", value: false });
    this.post({ type: "status", text: "consulta cancelada" });
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "main.js"));
    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", "icon.png"));
    const nonce = String(Date.now()) + Math.random().toString(16).slice(2);
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      color-scheme: light dark;
      --py-accent: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #78a957));
      --py-border: var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.28));
    }
    html, body {
      height: 100%;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.25));
      position: sticky;
      top: 0;
      background: var(--vscode-sideBar-background);
      z-index: 2;
    }
    header .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 650;
    }
    header .brand img {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      display: block;
    }
    #status {
      font-size: 11px;
      opacity: .75;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #content, #setup {
      padding: 10px 14px 24px;
    }
    #evidence {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.18));
      overflow: hidden;
    }
    #evidence .summary {
      min-width: 0;
      flex: 1;
      display: flex;
      align-items: center;
      gap: 5px;
      overflow: hidden;
    }
    #evidence-title {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .badge {
      flex: 0 0 auto;
      padding: 1px 5px;
      border: 1px solid var(--vscode-badge-background, rgba(127,127,127,.4));
      border-radius: 999px;
      font-size: 10px;
      opacity: .82;
    }
    .badge.inferred {
      color: var(--vscode-editorWarning-foreground);
      border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 55%, transparent);
    }
    .badge.explicit {
      color: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
      border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, var(--vscode-charts-green)) 55%, transparent);
    }
    .badge.cost {
      color: var(--py-accent);
      border-color: color-mix(in srgb, var(--py-accent) 58%, transparent);
      font-variant-numeric: tabular-nums;
    }
    .actions { display: flex; gap: 2px; }
    .icon-button {
      margin: 0;
      padding: 3px 6px;
      min-width: 25px;
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid transparent;
      border-radius: 3px;
    }
    .icon-button:hover, .icon-button:focus-visible {
      background: var(--vscode-toolbar-hoverBackground);
      border-color: var(--vscode-focusBorder, transparent);
      outline: none;
    }
    .wiki-hero {
      position: relative;
      overflow: hidden;
      margin: -10px -14px 18px;
      padding: 22px 16px 18px;
      background:
        radial-gradient(circle at 92% 10%, color-mix(in srgb, var(--vscode-textLink-foreground) 25%, transparent), transparent 45%),
        linear-gradient(135deg, color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent), var(--vscode-editorWidget-background));
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 42%, transparent);
    }
    .wiki-eyebrow {
      display: block;
      margin-bottom: 5px;
      color: var(--vscode-textLink-foreground);
      font-size: 10px;
      font-weight: 750;
      letter-spacing: .13em;
      text-transform: uppercase;
    }
    #content .wiki-hero h1 {
      margin: 0;
      color: var(--vscode-foreground);
      font-size: clamp(1.45rem, 8vw, 2rem);
      line-height: 1.08;
      letter-spacing: -.025em;
      overflow-wrap: anywhere;
    }
    #content > .wiki-hero + p {
      margin: 0 0 20px;
      color: var(--vscode-descriptionForeground);
      font-size: 1.03rem;
      line-height: 1.55;
    }
    #content .section-title {
      margin: 22px 0 9px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, rgba(127,127,127,.24));
      font-size: 1.08rem;
      line-height: 1.25;
    }
    #content .subsection-title {
      margin: 18px 0 7px;
      font-size: 1rem;
    }
    #content p, #content li {
      line-height: 1.45;
    }
    #content .code-shell {
      margin: 10px 0 14px;
      overflow: hidden;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
      border-radius: 7px;
      background: var(--vscode-textCodeBlock-background);
    }
    #content .code-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 27px;
      padding: 0 7px 0 10px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.22));
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    #content .code-toolbar button {
      margin: 0;
      padding: 3px 6px;
      border-radius: 3px;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      font: inherit;
      letter-spacing: 0;
      text-transform: none;
    }
    #content .code-toolbar button:hover {
      background: var(--vscode-toolbar-hoverBackground);
      color: var(--vscode-foreground);
    }
    #content pre {
      margin: 0;
      background: var(--vscode-textCodeBlock-background);
      padding: 11px 12px;
      overflow: auto;
    }
    #content code {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.92em;
    }
    #content :not(pre) > code {
      padding: 1px 4px;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.24));
      border-radius: 4px;
      background: var(--vscode-textCodeBlock-background);
      color: var(--vscode-symbolIcon-variableForeground, var(--vscode-foreground));
    }
    #content table {
      display: block;
      width: 100%;
      margin: 8px 0 16px;
      overflow-x: auto;
      border-spacing: 0;
      border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.28));
      border-radius: 6px;
      font-size: .92em;
    }
    #content th, #content td {
      padding: 7px 9px;
      border-right: 1px solid var(--vscode-panel-border, rgba(127,127,127,.2));
      border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.2));
      text-align: left;
      vertical-align: top;
    }
    #content th {
      background: var(--vscode-sideBarSectionHeader-background);
      color: var(--vscode-sideBarSectionHeader-foreground);
      font-size: .88em;
    }
    #content tr:last-child td { border-bottom: 0; }
    #content :is(th, td):last-child { border-right: 0; }
    #content blockquote {
      margin: 10px 0;
      padding: 7px 10px;
      border-left: 3px solid var(--vscode-textLink-foreground);
      background: color-mix(in srgb, var(--vscode-textLink-foreground) 8%, transparent);
      color: var(--vscode-descriptionForeground);
    }
    #content blockquote > :first-child { margin-top: 0; }
    #content blockquote > :last-child { margin-bottom: 0; }
    .hljs-keyword, .hljs-selector-tag, .hljs-literal { color: var(--vscode-symbolIcon-keywordForeground, #c586c0); }
    .hljs-string, .hljs-attr { color: var(--vscode-symbolIcon-stringForeground, #ce9178); }
    .hljs-number { color: var(--vscode-symbolIcon-numberForeground, #b5cea8); }
    .hljs-title, .hljs-function { color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); }
    .hljs-comment { color: var(--vscode-editorLineNumber-foreground); font-style: italic; }
    .hljs-built_in, .hljs-type { color: var(--vscode-symbolIcon-classForeground, #4ec9b0); }
    #thread {
      padding: 0 14px 8px;
    }
    .thread-item {
      border-top: 1px solid var(--py-border);
      padding: 10px 0 4px;
    }
    .thread-q {
      font-weight: 600;
      margin: 0 0 6px;
    }
    .thread-q::before {
      content: "? ";
      color: var(--py-accent);
    }
    .thread-a p, .thread-a li { margin: 6px 0; line-height: 1.45; }
    .thread-a pre {
      overflow-x: auto;
      padding: 8px 10px;
      border-radius: 6px;
      background: var(--vscode-textCodeBlock-background);
    }
    .thread-a :not(pre) > code {
      padding: 1px 4px;
      border-radius: 4px;
      background: var(--vscode-textCodeBlock-background);
    }
    .thread-a.streaming { opacity: .85; }
    #ask {
      display: flex;
      gap: 6px;
      padding: 8px 14px 14px;
      position: sticky;
      bottom: 0;
      background: var(--vscode-sideBar-background);
      border-top: 1px solid var(--py-border);
    }
    #ask input {
      flex: 1;
      min-width: 0;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 6px 8px;
      font-family: inherit;
      font-size: inherit;
    }
    #ask button { margin-top: 0; white-space: nowrap; }
    .hidden, #evidence.hidden { display: none; }
    .error { color: var(--vscode-errorForeground); }
    label { display: block; margin: 8px 0 4px; }
    input[type="password"] {
      width: 100%;
      box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 6px 8px;
    }
    button {
      margin-top: 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 0;
      padding: 6px 12px;
      cursor: pointer;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      margin-left: 6px;
    }
    .hint { opacity: .7; font-size: 12px; }
    #idle {
      padding: 32px 16px 24px;
      overflow: hidden;
    }
    .landing h1 {
      max-width: 330px;
      margin: 0;
      font-size: clamp(25px, 8.5vw, 34px);
      font-weight: 720;
      line-height: 1.08;
      letter-spacing: -.035em;
      text-wrap: balance;
    }
    .landing-intro {
      margin: 14px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      line-height: 1.55;
    }
    .landing-flow {
      position: relative;
      display: grid;
      gap: 20px;
      margin: 30px 0 28px;
    }
    .landing-flow::before {
      content: "";
      position: absolute;
      top: 20px;
      bottom: 20px;
      left: 17px;
      width: 1px;
      background: color-mix(in srgb, var(--py-accent) 70%, transparent);
    }
    .landing-step {
      position: relative;
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr);
      gap: 13px;
      align-items: center;
    }
    .landing-step::after {
      content: "";
      position: absolute;
      top: 17px;
      left: 34px;
      width: 13px;
      height: 1px;
      background: color-mix(in srgb, var(--py-accent) 70%, transparent);
    }
    .step-number {
      position: relative;
      z-index: 1;
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      box-sizing: border-box;
      border: 1px solid var(--py-accent);
      border-radius: 50%;
      background: color-mix(in srgb, var(--py-accent) 15%, var(--vscode-sideBar-background));
      color: var(--py-accent);
      font-size: 12px;
      font-weight: 750;
    }
    .step-copy strong {
      display: block;
      margin-bottom: 3px;
      font-size: 13px;
      font-weight: 650;
      line-height: 1.3;
    }
    .step-copy span {
      display: block;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.4;
    }
    .landing-section-title {
      margin: 0 0 9px;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .wiki-preview {
      padding: 14px 12px 12px;
      border: 1px solid var(--py-border);
      border-radius: 6px;
      background: color-mix(in srgb, var(--vscode-editorWidget-background) 68%, transparent);
    }
    .preview-track,
    .preview-labels {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
    .preview-track {
      position: relative;
      align-items: center;
      margin: 0 4px 10px;
    }
    .preview-track::before {
      content: "";
      position: absolute;
      right: 8%;
      left: 8%;
      height: 2px;
      background: color-mix(in srgb, var(--py-accent) 74%, transparent);
    }
    .preview-track span {
      position: relative;
      z-index: 1;
      justify-self: center;
      width: 8px;
      height: 8px;
      border: 1px solid var(--py-accent);
      border-radius: 50%;
      background: color-mix(in srgb, var(--py-accent) 42%, var(--vscode-sideBar-background));
    }
    .preview-labels span {
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 9px;
      line-height: 1.25;
      text-align: center;
      overflow-wrap: anywhere;
    }
    .shortcut-callout {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 14px;
      padding: 11px 12px;
      border: 1px solid var(--py-border);
      border-radius: 6px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .shortcut-keys {
      display: flex;
      gap: 4px;
      flex: 0 0 auto;
    }
    .shortcut-callout kbd {
      min-width: 18px;
      padding: 3px 5px;
      border: 1px solid var(--vscode-keybindingLabel-border, var(--py-border));
      border-bottom-width: 2px;
      border-radius: 4px;
      background: var(--vscode-keybindingLabel-background, transparent);
      color: var(--vscode-keybindingLabel-foreground, var(--vscode-foreground));
      font-family: var(--vscode-font-family);
      font-size: 10px;
      line-height: 1;
      text-align: center;
    }
    .landing-trust {
      margin: 24px 0 0;
      padding-top: 14px;
      border-top: 1px solid var(--py-border);
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      line-height: 1.55;
    }
    .streaming::before {
      content: "";
      display: block;
      width: 34%;
      height: 2px;
      margin: -10px 0 10px;
      background: var(--vscode-progressBar-background);
      animation: scan 1.1s ease-in-out infinite alternate;
    }
    @keyframes scan { to { transform: translateX(190%); } }
    @media (prefers-reduced-motion: reduce) { .streaming::before { animation: none; width: 100%; } }
    @media (max-width: 430px) { #signals { display: none; } }
    @media (max-width: 350px) {
      #origin { display: none; }
      #idle { padding-inline: 14px; }
    }
    @media (max-width: 280px) {
      .landing h1 { font-size: 24px; }
      .preview-track { display: none; }
      .preview-labels { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 10px; }
      .preview-labels span { text-align: left; font-size: 10px; }
      .shortcut-callout { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <header>
    <span class="brand"><img src="${iconUri}" alt="" />PyWiki</span>
    <span id="status">pronto</span>
  </header>
  <div id="evidence" class="hidden">
    <div class="summary" title="Contexto usado na explicação">
      <span id="evidence-title"></span>
      <span id="origin" class="badge"></span>
      <span id="documentation" class="badge"></span>
      <span id="signals" class="badge"></span>
      <span id="cost" class="badge cost hidden"></span>
    </div>
    <div class="actions">
      <button id="open-definition" class="icon-button hidden" type="button" title="Abrir definição" aria-label="Abrir definição"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 3h4v1H4v8h8V8h1v4.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 3.5 3H4Zm5-1h5v5h-1V3.7L8.35 8.35l-.7-.7L12.3 3H9V2Z"/></svg></button>
      <button id="refresh" class="icon-button" type="button" title="Atualizar ignorando cache" aria-label="Atualizar explicação"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M13.6 4.4V1.8h-1v1.35A6 6 0 1 0 13.85 9h-1.02A5 5 0 1 1 12 4.1L10.2 6h3.9V4.4h-.5Z"/></svg></button>
      <button id="copy" class="icon-button" type="button" title="Copiar wiki" aria-label="Copiar wiki"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5 2.5A1.5 1.5 0 0 1 6.5 1h6A1.5 1.5 0 0 1 14 2.5v6a1.5 1.5 0 0 1-1.5 1.5H11v1.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 2 11.5v-6A1.5 1.5 0 0 1 3.5 4H5V2.5ZM6 4h3.5A1.5 1.5 0 0 1 11 5.5V9h1.5a.5.5 0 0 0 .5-.5v-6a.5.5 0 0 0-.5-.5h-6a.5.5 0 0 0-.5.5V4Zm-2.5 1a.5.5 0 0 0-.5.5v6a.5.5 0 0 0 .5.5h6a.5.5 0 0 0 .5-.5v-6a.5.5 0 0 0-.5-.5h-6Z"/></svg></button>
      <button id="cancel" class="icon-button hidden" type="button" title="Cancelar consulta" aria-label="Cancelar consulta"><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="m3.85 3.15 9 9-.7.7-9-9 .7-.7Zm9 0 .7.7-9 9-.7-.7 9-9Z"/></svg></button>
    </div>
  </div>
  <div id="idle" class="landing">
    <h1>Entenda qualquer símbolo sem sair do código.</h1>
    <p class="landing-intro">Selecione uma função, classe, builtin ou trecho. O PyWiki cruza LSP e fonte; o Luna escreve uma wiki verificável.</p>
    <div class="landing-flow" aria-label="Como o PyWiki funciona">
      <div class="landing-step">
        <span class="step-number">1</span>
        <div class="step-copy"><strong>Selecione no editor</strong><span>Duplo clique ou arraste</span></div>
      </div>
      <div class="landing-step">
        <span class="step-number">2</span>
        <div class="step-copy"><strong>O LSP encontra a fonte</strong><span>Hover, assinatura e definição</span></div>
      </div>
      <div class="landing-step">
        <span class="step-number">3</span>
        <div class="step-copy"><strong>O Luna organiza a wiki</strong><span>Uso, parâmetros, retorno e exemplos</span></div>
      </div>
    </div>
    <p class="landing-section-title">O que chega na wiki</p>
    <div class="wiki-preview">
      <div class="preview-track" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
      <div class="preview-labels"><span>Assinatura</span><span>Parâmetros</span><span>Retorno</span><span>Exemplo</span><span>Origem</span></div>
    </div>
    <div class="shortcut-callout">
      <span class="shortcut-keys"><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>W</kbd></span>
      <span>Explicar seleção agora</span>
    </div>
    <p class="landing-trust">Cache local · menos de R$ 0,01 por consulta típica · chave no SecretStorage</p>
  </div>
  <div id="setup" class="hidden">
    <p>Falta a chave da OpenAI. Grava no SecretStorage do VS Code (não vai pra settings.json).</p>
    <label for="key">API key</label>
    <input id="key" type="password" autocomplete="off" />
    <div>
      <button id="save" type="button">Salvar</button>
      <button id="env" class="secondary" type="button">Usar OPENAI_API_KEY do ambiente</button>
    </div>
  </div>
  <div id="content" class="hidden"></div>
  <div id="thread" class="hidden"></div>
  <form id="ask" class="hidden" autocomplete="off">
    <input id="question" type="text" placeholder="Pergunta sobre este símbolo…" aria-label="Pergunta de seguimento" />
    <button id="send" type="submit">Perguntar</button>
  </form>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
