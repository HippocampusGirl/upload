import { Range } from "../utils/range.js";
import { Controller } from "../controller.js";
import { getDataSource } from "../data-source.js";
import { DataSource } from "typeorm";

describe("controller", () => {
    let dataSource: DataSource;

    beforeAll(async () => {
        dataSource = await getDataSource("sqlite", ":memory:", true);
        dataSource.synchronize();
    });

    it("can add and retrieve part", async () => {
        const controller = new Controller(dataSource);

        const range = new Range(0, 10);
        await controller.addFilePart("bucket", {
            path: "path",
            range,
            checksumMD5: "checksumMD5",
            size: 100,
        });
        const part = await controller.getPart("checksumMD5", range);
        expect(part).toMatchObject({ range });
    });
})
