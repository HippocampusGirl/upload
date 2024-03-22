import { randomBytes } from "node:crypto";
import { DataSource } from "typeorm";

import { Controller } from "../controller.js";
import { getDataSource } from "../data-source.js";
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

    const range = new Range(0, 10);
    await controller.addFilePart(n, {
      path,
      range,
      checksumMD5,
      size: 100,
    });
    const part = await controller.getPart(checksumMD5, range);
    expect(part).not.toBeFalsy();
    expect(part).toMatchObject({ range });
    expect(part!.file).toMatchObject({ path });
  });

  it("can add and retrieve file by checksum", async () => {
    const controller = new Controller(dataSource);

    const checksumSHA256 = randomBytes(32).toString("hex");
    expect(checksumSHA256.length).toBe(64);

    const path = "file-checksum-path";

    await controller.setChecksumSHA256(n, path, checksumSHA256);
    const file = await controller.getFile(n, path);
    expect(file).not.toBeFalsy();
    expect(file).toMatchObject({ path, checksumSHA256 });
  });

  it("can add and retrieve file by parts", async () => {
    const controller = new Controller(dataSource);

    const checksumMD5 = randomBytes(16).toString("hex");
    expect(checksumMD5.length).toBe(32);

    const path = "file-parts-path";

    const range = new Range(0, 10);
    await controller.addFilePart(n, {
      path,
      range,
      checksumMD5,
      size: 100,
    });

    const file = await controller.getFile(n, path);
    expect(file).not.toBeNull();
    const parts = file?.parts;
    expect(parts).not.toBeFalsy();
    expect(parts).toHaveLength(1);
    expect(parts![0]).toMatchObject({ range });
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
