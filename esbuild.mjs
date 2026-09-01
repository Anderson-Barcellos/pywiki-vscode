import * as esbuild from "esbuild";
import { argv } from "node:process";

const watch = argv.includes("--watch");

const common = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
};

const extension = {
  ...common,
  entryPoints: ["src/extension.ts"],
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
};

const webview = {
  ...common,
  entryPoints: ["src/webview/main.ts"],
  outfile: "media/main.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
};

if (watch) {
  const extCtx = await esbuild.context(extension);
  const webCtx = await esbuild.context(webview);
  await Promise.all([extCtx.watch(), webCtx.watch()]);
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
}
