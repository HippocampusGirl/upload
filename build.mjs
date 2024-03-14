#!/usr/bin/env node

import { Command } from "commander";
import * as esbuild from "esbuild";
import esbuildPluginTsc from "esbuild-plugin-tsc";

let nodeExecutable = process.argv[0];
if (nodeExecutable.includes("nix")) {
  nodeExecutable = `${nodeExecutable} --enable-source-maps`;
} else {
  // We are not running in a Nix shell, so we can use `env` to find the node executable
  nodeExecutable = "/usr/bin/env node";
}

const context = await esbuild.context({
  entryPoints: ["src/index.ts"],
  sourcemap: "inline",
  platform: "node",
  target: "node20",
  format: "cjs",
  bundle: true,
  treeShaking: true,
  write: true,
  outfile: "upload.cjs",
  banner: {
    js: `#!${nodeExecutable}`,
  },
  plugins: [esbuildPluginTsc({ force: true })],
});

const rebuildCommand = new Command();
rebuildCommand.name(`rebuild`).action(async () => {
  await context.rebuild();
  context.dispose();
});

const watchCommand = new Command();
watchCommand.name(`watch`).action(async () => {
  await context.watch();
});

const command = new Command()
  .name(`build.mjs`)
  .showHelpAfterError()
  .addCommand(rebuildCommand, { isDefault: true })
  .addCommand(watchCommand);

await command.parseAsync(process.argv);
