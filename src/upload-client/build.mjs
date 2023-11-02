import * as esbuild from "esbuild";
import { open } from "node:fs/promises";

const { outputFiles } = await esbuild.build({
  entryPoints: ["src/index.ts"],
  platform: "node",
  target: "node20",
  bundle: true,
  write: false,
});
const [outputFile] = outputFiles;
const { contents } = outputFile;
let fileHandle;
try {
  fileHandle = await open("upload-client.cjs", "w", 0o755);
  await fileHandle.writeFile(`#!/usr/bin/env node\n`);
  await fileHandle.writeFile(contents);
} finally {
  await fileHandle?.close();
}
