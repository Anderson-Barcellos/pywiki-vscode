import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function decodeFishValue(raw: string): string {
  return raw
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\(.)/g, "$1")
    .trim()
    .replace(/^['"]|['"]$/g, "");
}

export function parseFishOpenAiKey(text: string): string | undefined {
  let fromConfig: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const setuvar = line.match(/^SETUVAR --export (OPENAI_[A-Za-z_]+):(.*)$/);
    if (setuvar) {
      const name = setuvar[1];
      const value = decodeFishValue(setuvar[2] ?? "");
      if (name === "OPENAI_API_KEY" && value.startsWith("sk-")) {
        return value;
      }
    }
    const setUx = line.match(/set\s+-Ux\s+OPENAI_API_KEY\s+(.+)$/);
    if (setUx) {
      const value = decodeFishValue(setUx[1] ?? "");
      if (value.startsWith("sk-")) {
        fromConfig = value;
      }
    }
  }
  return fromConfig;
}

export function readFishOpenAiKey(home = os.homedir()): string | undefined {
  const candidates = [
    path.join(home, ".config/fish/fish_variables"),
    path.join(home, ".config/fish/config.fish"),
  ];
  for (const file of candidates) {
    try {
      const key = parseFishOpenAiKey(fs.readFileSync(file, "utf8"));
      if (key) {
        return key;
      }
    } catch {
      // arquivo ausente ou ilegível — tenta o próximo
    }
  }
  return undefined;
}
