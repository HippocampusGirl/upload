import { randomBytes } from "node:crypto";
import { DataSource } from "typeorm";

import { Controller } from "../controller.js";
import { getDataSource } from "../entity/data-source.js";
import { Range } from "../utils/range.js";

describe("controller", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await getDataSource("sqlite", ":memory:", true);
    dataSource.synchronize();
  });

  const n = "test";

  it("can add and retrieve part", async () => {
    const controller = new Controller(dataSource);

    const checksumMD5 = randomBytes(16).toString("hex");
    expect(checksumMD5.length).toBe(32);

    const path = "part-path";
    const size = 100;

    const range = new Range(0, 10);
    const filePart = { path, range, checksumMD5, size };
    await controller.addFilePart(n, filePart);
    const part = await controller.getPart(checksumMD5, range);
    expect(part).not.toBeFalsy();
    expect(part).toMatchObject({ range });
    expect(part!.file).toMatchObject({ path });

    const file = await controller.completePart(n, filePart);
    expect(file).toMatchObject({ path, size });
  });

  it("can add and retrieve file by checksum", async () => {
    const controller = new Controller(dataSource);

    const checksumSHA256 = randomBytes(32).toString("hex");
    expect(checksumSHA256.length).toBe(64);

    const path = "file-checksum-path";

    await controller.setChecksumSHA256(n, path, checksumSHA256);
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
    const controller = new Controller(dataSource);

    const checksumMD5 = randomBytes(16).toString("hex");
    expect(checksumMD5.length).toBe(32);

    const path = "file-parts-path";
    const range = new Range(0, 10);
    const size = 100;
    await controller.addFilePart(n, { path, range, checksumMD5, size });

    const file = await controller.getFile(n, path);
    expect(file).not.toBeNull();
    expect(file).toMatchObject({ path, size });

    const parts = await file?.parts;
    expect(parts).not.toBeFalsy();
    expect(parts).toHaveLength(1);
    console.log(parts);
    expect(parts![0]).toMatchObject({ range });

    let _file = await controller.getFileById(file!.id);
    expect(_file).not.toBeNull();
    expect(_file).toMatchObject({ path, size });
  });

  it("can add a large file", async () => {
    const controller = new Controller(dataSource);

    const size = 313203334286;

    const checksumMD5 = randomBytes(16).toString("hex");
    expect(checksumMD5.length).toBe(32);

    const path = "large-file";

    const range = new Range(65037519650, 65105980196);
    await controller.addFilePart(n, {
      path,
      range,
      checksumMD5,
      size,
    });

    const file = await controller.getFile(n, path);
    expect(file).not.toBeNull();
    expect(file!.size).toBe(size);
  });
});
