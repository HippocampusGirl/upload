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

    it("can add and retrieve part", async () => {
        const controller = new Controller(dataSource);

        const path = "path";
        const range = new Range(0, 10);
        await controller.addFilePart("bucket", {
            path,
            range,
            checksumMD5: "checksumMD5",
            size: 100,
        });
        const part = await controller.getPart("checksumMD5", range);
        expect(part).not.toBeNull();
        expect(part).toMatchObject({ range });
        expect(part!.file).toMatchObject({ path });
    });
})
