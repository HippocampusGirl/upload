import Debug from "debug";
import { Stats } from "fs";
import net from "net";
import { exec } from "node:child_process";
import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { jest } from "@jest/globals";
import { LocalstackContainer, StartedLocalStackContainer } from "@testcontainers/localstack";
import { decode, verify } from "@tsndr/cloudflare-worker-jwt";

import { downloadClient } from "../client/download-client.js";
import { command } from "../index.js";
import { server } from "../server/serve.js";
import { calculateChecksum } from "../utils/fs.js";

const debug = Debug("test");

const getPort = (): Promise<number> => {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, () => {
      const addressInfo = server.address();
      if (addressInfo === null || typeof addressInfo === "string") {
        return reject("Did not receive a net.AddressInfo object");
      }
      const port = addressInfo.port;
      server.close(() => resolve(port));
    });
  });
};

describe("application", () => {
  const abortController = new AbortController();

  let container: StartedLocalStackContainer | undefined;

  let port: number;
  let temporaryDirectory: string;
  let serverConnectionString: string;
  let downloadConnectionString: string;
  let privateKeyFile: string;
  let publicKeyFile: string;
  let publicKey: string;
  let uploadToken: string;
  let downloadToken: string;
  let uploadFile: string;
  let uploadFileChecksumSHA256: string;
  let downloadFile: string;

  const storageProviderId = "local";
  const accessKeyId = "does-not-matter";
  const tokenName = "download";
  const uploadFileName = "upload-file";

  const runShellCommand = promisify(exec);
  const runCommand = async (argv: string[]) => {
    return command.parseAsync(["node", "script-path", ...argv]);
  };

  beforeAll(async () => {
    port = await getPort();

    debug("starting localstack container");
    container = await new LocalstackContainer().start();
    debug("started localstack container");

    temporaryDirectory = await mkdtemp(join(tmpdir(), "upload-"));
    serverConnectionString = join(temporaryDirectory, "server.sqlite");
    downloadConnectionString = join(temporaryDirectory, "download.sqlite");

    const privateKeyEcFile = join(temporaryDirectory, "private.key");
    await runShellCommand(
      `openssl ecparam -genkey -name prime256v1 -out ${privateKeyEcFile}`
    );
    privateKeyFile = join(temporaryDirectory, "private.pem");
    await runShellCommand(
      `openssl pkcs8 -topk8 -nocrypt -in ${privateKeyEcFile} -out ${privateKeyFile}`
    );
    publicKeyFile = join(temporaryDirectory, "public.pem");
    await runShellCommand(
      `openssl ec -in ${privateKeyFile} -pubout -out ${publicKeyFile}`
    );

    publicKey = await readFile(publicKeyFile, "utf8");

    uploadFile = join(temporaryDirectory, uploadFileName);
    await runShellCommand(`dd if=/dev/urandom of=${uploadFile} bs=64M count=1`);
    uploadFileChecksumSHA256 = await calculateChecksum(uploadFile, "sha256");

    downloadFile = join(temporaryDirectory, tokenName, uploadFileName);
  }, 10 * 60 * 1000);
  afterAll(async () => {
    abortController.abort();
    downloadClient?.terminate();
    await server?.terminate();
    if (container) {
      await container.stop();
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("can create upload token", async () => {
    const spy = jest.spyOn(process.stdout, "write");
    await runCommand([
      "create-token",
      "--name",
      tokenName,
      "--type",
      "upload",
      "--storage-id",
      storageProviderId,
      "--private-key-file",
      privateKeyFile,
    ]);
    uploadToken = spy.mock.calls[0]![0] as string;
    spy.mockRestore();

    expect(verify(uploadToken, publicKey)).toBeTruthy();
    const decoded = decode(uploadToken);
    expect(decoded.payload).toMatchObject({
      n: tokenName,
      t: "u",
      s: storageProviderId,
    });
  });

  it("can create download token", async () => {
    const spy = jest.spyOn(process.stdout, "write");
    await runCommand([
      "create-token",
      "--type",
      "download",
      "--storage-id",
      storageProviderId,
      "--private-key-file",
      privateKeyFile,
    ]);
    downloadToken = spy.mock.calls[0]![0] as string;
    spy.mockRestore();

    expect(verify(downloadToken, publicKey)).toBeTruthy();
    const decoded = decode(downloadToken);
    expect(decoded.payload).toMatchObject({
      t: "d",
    });
  });

  it("can synchronize", async () => {
    await Promise.all([
      runCommand([
        "synchronize",
        "--database-type",
        "sqlite",
        "--connection-string",
        serverConnectionString,
      ]),
      runCommand([
        "synchronize",
        "--database-type",
        "sqlite",
        "--connection-string",
        downloadConnectionString,
      ]),
    ]);
  });

  it("can add storage provider", async () => {
    if (!container) {
      throw new Error("Container is not defined");
    }
    return runCommand([
      "add-storage-provider",
      "--database-type",
      "sqlite",
      "--connection-string",
      serverConnectionString,
      "--id",
      storageProviderId,
      "--endpoint",
      container.getConnectionUri(),
      "--region",
      "us-east-1",
      "--accessKeyId",
      accessKeyId,
      "--secretAccessKey",
      "does-not-matter",
    ]);
  });
  const check = async (): Promise<string | null> => {
    let isRunning = true;
    abortController.signal.addEventListener("abort", () => {
      isRunning = false;
    });
    while (isRunning) {
      await promisify(setTimeout)(1000);
      let stats: Stats;
      try {
        stats = await lstat(downloadFile);
      } catch {
        debug("file %o not available yet", downloadFile);
        continue;
      }
      expect(stats.isFile()).toBeTruthy();
      if (downloadClient === undefined) {
        debug("database not available yet");
        continue;
      }
      const file = await downloadClient.controller.getFile(
        tokenName,
        uploadFileName
      );
      if (file === null) {
        debug("file %o not in database yet", downloadFile);
        continue;
      }
      if (file.verified) {
        return calculateChecksum(downloadFile, "sha256");
      }
      debug("file %o not verified yet", downloadFile);
    }
    return null;
  };
  it(
    "can transfer file",
    async (): Promise<void> => {
      await runCommand([
        "serve",
        "--database-type",
        "sqlite",
        "--connection-string",
        serverConnectionString,
        "--port",
        port.toString(10),
        "--public-key-file",
        publicKeyFile,
        "--num-threads",
        "1",
        "--interval",
        "1000",
      ]);
      await promisify(setTimeout)(1000);
      await runCommand([
        "upload-client",
        "--endpoint",
        `http://localhost:${port}`,
        "--token",
        uploadToken,
        "--path",
        uploadFile,
        "--base-path",
        temporaryDirectory,
        "--num-threads",
        "1",
      ]);
      debug("started upload-client");
      await runCommand([
        "download-client",
        "--database-type",
        "sqlite",
        "--connection-string",
        downloadConnectionString,
        "--endpoint",
        `http://localhost:${port}`,
        "--token",
        downloadToken,
        "--base-path",
        temporaryDirectory,
        "--num-threads",
        "1",
      ]);
      debug("started download-client");

      return expect(check()).resolves.toBe(uploadFileChecksumSHA256);
    },
    1 * 60 * 1000
  );

  it(
    "can transfer modified file",
    async () => {
      await runShellCommand(
        `dd if=/dev/urandom of=${uploadFile} conv=notrunc bs=1M count=1`
      );
      const modifiedUploadFileChecksumSHA256 = await calculateChecksum(
        uploadFile,
        "sha256"
      );
      expect(modifiedUploadFileChecksumSHA256).not.toBe(
        uploadFileChecksumSHA256
      );

      await runCommand([
        "upload-client",
        "--endpoint",
        `http://localhost:${port}`,
        "--token",
        uploadToken,
        "--path",
        uploadFile,
        "--base-path",
        temporaryDirectory,
        "--num-threads",
        "1",
      ]);
      debug("uploaded modified file");

      return expect(check()).resolves.toBe(modifiedUploadFileChecksumSHA256);
    },
    1 * 60 * 1000
  );
});
