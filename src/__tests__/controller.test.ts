import Debug from "debug";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DataSource } from "typeorm";
import { Controller } from "../controller.js";
import { getDataSource } from "../entity/data-source.js";
import { Range } from "../utils/range.js";

const debug = Debug("test");
describe("controller", () => {
  let temporaryDirectory: string;
  let connectionString: string;
  let dataSource: DataSource;

  beforeAll(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "upload-"));
    connectionString = join(temporaryDirectory, "database.sqlite");
    dataSource = await getDataSource("sqlite", connectionString, true);
    debug("database initialized");
    await dataSource.synchronize();
    debug("database synchronized");
  });
  afterAll(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const n = "test";

  it("can add and retrieve part", async () => {
    expect(dataSource.isInitialized).toBe(true);
    const controller = new Controller(dataSource);

    const checksumMD5 = randomBytes(16).toString("hex");
    expect(checksumMD5.length).toBe(32);

    const path = "part-path";
    const size = 100;

    const range = new Range(0, 10);
    const filePart = { path, range, checksumMD5, size };
    expect(controller.addFilePart(n, filePart)).resolves.toBeTruthy();
    const part = await controller.getPart(checksumMD5, range);
    expect(part).not.toBeFalsy();
    expect(part).toMatchObject({ range });
    expect(part!.file).toMatchObject({ path });

    expect(controller.completePart(n, filePart)).resolves.toMatchObject({
      path,
      size,
    });

    expect(controller.addFilePart(n, filePart)).resolves.toBeFalsy();
  });

  it("can add and retrieve file by checksum", async () => {
    expect(dataSource.isInitialized).toBe(true);
    const controller = new Controller(dataSource);

    const checksumSHA256 = randomBytes(32).toString("hex");
    expect(checksumSHA256.length).toBe(64);

    const path = "file-checksum-path";

    expect(
      controller.setChecksumSHA256(n, path, checksumSHA256)
    ).resolves.toBeUndefined();
    let file = await controller.getFile(n, path);
    expect(file).not.toBeFalsy();
    expect(file).toMatchObject({ path, checksumSHA256, verified: false });

    const files = await controller.getFilesToVerify();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path, checksumSHA256, verified: false });

    await controller.setVerified(n, path);
    file = await controller.getFile(n, path);
    expect(file).not.toBeFalsy();
    expect(file).toMatchObject({ path, checksumSHA256, verified: true });
  });

  it("can add and retrieve file by parts", async () => {
    expect(dataSource.isInitialized).toBe(true);
    const controller = new Controller(dataSource);

    let checksumMD5 = randomBytes(16).toString("hex");
    expect(checksumMD5.length).toBe(32);

    const path = "file-parts-path";
    const range = new Range(0, 10);
    const size = 100;
    expect(
      controller.addFilePart(n, { path, range, checksumMD5, size })
    ).resolves.toBeTruthy();

    const file = await controller.getFile(n, path);
    expect(file).not.toBeNull();
    expect(file).toMatchObject({ path, size });

    const parts = await file?.parts;
    expect(parts).not.toBeFalsy();
    expect(parts).toHaveLength(1);
    debug(parts);
    expect(parts![0]).toMatchObject({ range });

    let _file = await controller.getFileById(file!.id);
    expect(_file).not.toBeNull();
    expect(_file).toMatchObject({ path, size });

    // Update checksum
    checksumMD5 = randomBytes(16).toString("hex");
    expect(
      controller.addFilePart(n, { path, range, checksumMD5, size })
    ).resolves.toBeTruthy();
  });

  it("can add a large file", async () => {
    expect(dataSource.isInitialized).toBe(true);
    const controller = new Controller(dataSource);

    const size = 313203334286;

    const checksumMD5 = randomBytes(16).toString("hex");
    expect(checksumMD5.length).toBe(32);

    const path = "large-file";

    const range = new Range(65037519650, 65105980196);
    expect(
      controller.addFilePart(n, {
        path,
        range,
        checksumMD5,
        size,
      })
    ).resolves.toBeTruthy();

    const file = await controller.getFile(n, path);
    expect(file).not.toBeNull();
    expect(file!.size).toBe(size);
  });

  it("can modify part in new database connection", async () => {
    expect(dataSource.isInitialized).toBe(true);
    const checksumMD5 = randomBytes(16).toString("hex");
    expect(checksumMD5.length).toBe(32);

    const path = "part-modify";
    const size = 100;

    const range = new Range(0, 10);
    const filePart = { path, range, checksumMD5, size };
    await expect(
      new Controller(dataSource).addFilePart(n, filePart)
    ).resolves.toBeTruthy();

    const dataSource_ = await getDataSource("sqlite", connectionString, true);
    expect(dataSource_.isInitialized).toBe(true);

    expect(
      new Controller(dataSource_).addFilePart(n, filePart)
    ).resolves.toBeTruthy();
  });
});
