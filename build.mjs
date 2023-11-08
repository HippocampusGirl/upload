#!/usr/bin/env node

import { Command } from "commander";
import * as esbuild from "esbuild";
import { open } from "node:fs/promises";

const writeWithShebang = async (result) => {
  const { outputFiles } = result;
  const [outputFile] = outputFiles;
  const { contents } = outputFile;
  let fileHandle;
  try {
    fileHandle = await open("upload.cjs", "w", 0o755);
    await fileHandle.writeFile(
      "#!/usr/bin/env -S node " +
        "--enable-source-maps " +
        "--report-uncaught-exception " +
        "--report-on-signal " +
        "--report-on-fatalerror \n"
    );
    await fileHandle.writeFile(contents);
  } finally {
    await fileHandle?.close();
  }
  console.log("✅ `upload.cjs`");
};
const plugins = [
  {
    name: "write-with-shebang",
    setup(build) {
      build.onEnd(writeWithShebang);
    },
  },
];

const context = await esbuild.context({
  entryPoints: ["src/index.ts"],
  sourcemap: "inline",
  platform: "node",
  target: "node20",
  bundle: true,
  write: false,
  plugins,
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
  .addCommand(rebuildCommand)
  .addCommand(watchCommand);

await command.parseAsync(process.argv);
