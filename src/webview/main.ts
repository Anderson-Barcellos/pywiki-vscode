import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import { renderWikiMarkdown } from "../wikiMarkdown";

declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
};

const vscode = acquireVsCodeApi();
const content = document.getElementById("content") as HTMLElement;
const setup = document.getElementById("setup") as HTMLElement;
const idle = document.getElementById("idle") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const keyInput = document.getElementById("key") as HTMLInputElement | null;
const saveBtn = document.getElementById("save") as HTMLButtonElement | null;
const envBtn = document.getElementById("env") as HTMLButtonElement | null;
const evidence = document.getElementById("evidence") as HTMLElement;
const evidenceTitle = document.getElementById("evidence-title") as HTMLElement;
const originEl = document.getElementById("origin") as HTMLElement;
const documentationEl = document.getElementById("documentation") as HTMLElement;
const signalsEl = document.getElementById("signals") as HTMLElement;
const costEl = document.getElementById("cost") as HTMLElement;
const openDefinitionBtn = document.getElementById("open-definition") as HTMLButtonElement;
const refreshBtn = document.getElementById("refresh") as HTMLButtonElement;
const copyBtn = document.getElementById("copy") as HTMLButtonElement;
const cancelBtn = document.getElementById("cancel") as HTMLButtonElement;
const thread = document.getElementById("thread") as HTMLElement;
const askForm = document.getElementById("ask") as HTMLFormElement;
const questionInput = document.getElementById("question") as HTMLInputElement;
const sendBtn = document.getElementById("send") as HTMLButtonElement;

let buffer = "";
let renderTimer: number | undefined;
let threadBuffer = "";
let threadTimer: number | undefined;
let threadAnswer: HTMLElement | undefined;
let canFollowUp = false;

for (const [name, language] of Object.entries({
  bash,
  css,
  javascript,
  json,
  markdown,
  python,
  sql,
  typescript,
})) {
  hljs.registerLanguage(name, language);
}
hljs.registerAliases(["js", "jsx"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["sh", "shell"], { languageName: "bash" });

function show(el: HTMLElement, on: boolean): void {
  el.classList.toggle("hidden", !on);
}

function renderInto(el: HTMLElement, markdown: string): void {
  el.innerHTML = DOMPurify.sanitize(renderWikiMarkdown(markdown));
  for (const code of el.querySelectorAll<HTMLElement>("pre code")) {
    const language = [...code.classList]
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length);
    if (language && language !== "texto" && hljs.getLanguage(language)) {
      hljs.highlightElement(code);
    }
  }
}

function render(markdown: string): void {
  renderInto(content, markdown);
}

function scheduleThreadRender(): void {
  if (threadTimer !== undefined || !threadAnswer) {
    return;
  }
  threadTimer = window.setTimeout(() => {
    threadTimer = undefined;
    if (threadAnswer) {
      renderInto(threadAnswer, threadBuffer);
    }
  }, 40);
}

function resetThread(): void {
  thread.innerHTML = "";
  threadBuffer = "";
  threadAnswer = undefined;
  canFollowUp = false;
  show(thread, false);
  show(askForm, false);
}

function setAskEnabled(on: boolean): void {
  show(askForm, on && canFollowUp);
}

function scheduleRender(): void {
  if (renderTimer !== undefined) {
    return;
  }
  renderTimer = window.setTimeout(() => {
    renderTimer = undefined;
    render(buffer);
  }, 40);
}

saveBtn?.addEventListener("click", () => {
  const key = keyInput?.value.trim() ?? "";
  if (!key) {
    return;
  }
  vscode.postMessage({ type: "setKey", key });
  keyInput.value = "";
});

envBtn?.addEventListener("click", () => {
  vscode.postMessage({ type: "useEnvKey" });
});

openDefinitionBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "openDefinition" });
});

refreshBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "refresh" });
});

cancelBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "cancel" });
});

askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question || sendBtn.disabled) {
    return;
  }
  vscode.postMessage({ type: "followUp", question });
  questionInput.value = "";
});

copyBtn.addEventListener("click", () => {
  if (buffer.trim()) {
    vscode.postMessage({ type: "copy", text: buffer });
  }
});

content.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>("[data-copy-code]");
  const code = button?.closest(".code-shell")?.querySelector("code")?.textContent;
  if (button && code) {
    vscode.postMessage({ type: "copy", text: code, label: "bloco de código" });
    button.textContent = "Copiado";
    window.setTimeout(() => { button.textContent = "Copiar"; }, 1200);
  }
});

window.addEventListener("message", (event: MessageEvent) => {
  const msg = event.data as {
    type: string;
    text?: string;
    markdown?: string;
    visible?: boolean;
    value?: boolean;
    title?: string;
    origin?: string;
    fileName?: string;
    hasHover?: boolean;
    hasSignature?: boolean;
    documentation?: "explicit" | "inferred";
    canOpen?: boolean;
    canFollowUp?: boolean;
    question?: string;
  };
  switch (msg.type) {
    case "status":
      statusEl.textContent = msg.text ?? "";
      break;
    case "need-key":
      show(setup, true);
      show(content, false);
      show(idle, false);
      statusEl.textContent = "falta API key";
      break;
    case "context": {
      show(evidence, msg.visible === true);
      evidenceTitle.textContent = msg.title ?? "símbolo";
      evidenceTitle.title = msg.fileName ?? "";
      originEl.textContent = msg.origin ?? "seleção";
      const explicit = msg.documentation === "explicit";
      documentationEl.textContent = explicit ? "documentado" : "inferido";
      documentationEl.classList.toggle("explicit", explicit);
      documentationEl.classList.toggle("inferred", !explicit);
      const signals = [msg.hasHover ? "hover" : "", msg.hasSignature ? "assinatura" : ""]
        .filter(Boolean)
        .join(" + ");
      signalsEl.textContent = signals || "definição";
      show(openDefinitionBtn, msg.canOpen === true);
      break;
    }
    case "busy":
      show(cancelBtn, msg.value === true);
      show(refreshBtn, msg.value !== true);
      content.classList.toggle("streaming", msg.value === true && !threadAnswer);
      sendBtn.disabled = msg.value === true;
      questionInput.disabled = msg.value === true;
      if (msg.value !== true && threadAnswer) {
        // cancelamento no meio do seguimento: mantém o parcial, tira o pulso
        threadAnswer.classList.remove("streaming");
        threadAnswer = undefined;
      }
      break;
    case "cost":
      costEl.textContent = msg.text ?? "";
      costEl.title = msg.title ?? "";
      show(costEl, msg.visible === true && Boolean(msg.text));
      break;
    case "ready":
      show(setup, false);
      show(idle, false);
      show(content, true);
      break;
    case "idle":
      show(setup, false);
      show(content, false);
      show(idle, true);
      resetThread();
      break;
    case "clear":
      buffer = "";
      content.innerHTML = "";
      resetThread();
      show(setup, false);
      show(idle, false);
      show(content, true);
      break;
    case "delta":
      buffer += msg.text ?? "";
      show(content, true);
      show(idle, false);
      scheduleRender();
      break;
    case "done":
      buffer = msg.markdown ?? buffer;
      show(content, true);
      show(idle, false);
      render(buffer);
      resetThread();
      canFollowUp = msg.canFollowUp === true;
      setAskEnabled(true);
      break;
    case "error":
      show(setup, false);
      show(idle, false);
      show(content, true);
      content.innerHTML = `<p class="error"></p>`;
      content.firstElementChild!.textContent = msg.text ?? "erro";
      resetThread();
      break;
    case "thread-start": {
      threadAnswer = undefined;
      threadBuffer = "";
      const item = document.createElement("div");
      item.className = "thread-item";
      const q = document.createElement("p");
      q.className = "thread-q";
      q.textContent = msg.question ?? "";
      const a = document.createElement("div");
      a.className = "thread-a streaming";
      item.append(q, a);
      thread.append(item);
      threadAnswer = a;
      content.classList.remove("streaming");
      show(thread, true);
      a.scrollIntoView({ block: "nearest" });
      break;
    }
    case "thread-delta":
      threadBuffer += msg.text ?? "";
      scheduleThreadRender();
      break;
    case "thread-done":
      if (threadAnswer) {
        renderInto(threadAnswer, threadBuffer);
        threadAnswer.classList.remove("streaming");
        threadAnswer.scrollIntoView({ block: "nearest" });
      }
      threadAnswer = undefined;
      questionInput.focus();
      break;
    case "thread-error":
      if (threadAnswer) {
        threadAnswer.classList.remove("streaming");
        threadAnswer.innerHTML = `<p class="error"></p>`;
        threadAnswer.firstElementChild!.textContent = msg.text ?? "erro";
      }
      threadAnswer = undefined;
      break;
    default:
      break;
  }
});
