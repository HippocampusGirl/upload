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

    const bucket = "bucket";
    const path = "path";
    const checksumMD5 = "checksumMD5";
    const checksumSHA256 = "checksumSHA256";

    it("can add and retrieve part", async () => {
        const controller = new Controller(dataSource);

        const range = new Range(0, 10);
        await controller.addFilePart(bucket, {
            path, range, checksumMD5, size: 100,
        });
        const part = await controller.getPart(checksumMD5, range);
        expect(part).not.toBeFalsy();
        expect(part).toMatchObject({ range });
        expect(part!.file).toMatchObject({ path });
    });

    it("can add and retrieve file by checksum", async () => {
        const controller = new Controller(dataSource);

        await controller.setChecksumSHA256(bucket, path, checksumSHA256);
        const file = await controller.getFile(bucket, path);
        expect(file).not.toBeFalsy();
        expect(file).toMatchObject({ path, checksumSHA256 });
    });

    it("can add and retrieve file by parts", async () => {
        const controller = new Controller(dataSource);

        const bucket = "bucket";
        const path = "path";
        const range = new Range(0, 10);
        await controller.addFilePart(bucket, {
            path, range, checksumMD5, size: 100,
        });

        const file = await controller.getFile(bucket, path);
        expect(file).not.toBeNull();
        const parts = file?.parts;
        expect(parts).not.toBeFalsy();
        expect(parts).toHaveLength(1);
        expect(parts![0]).toMatchObject({ range });
    });

})
