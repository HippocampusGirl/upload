import { Range, reduceRanges } from "../range.js";

describe("range", () => {
    it("can be reduced", async () => {
        const ranges = [
            new Range(11, 20),
            new Range(0, 10),
        ];
        const reduced = reduceRanges(ranges);
        expect(reduced).toHaveLength(1);
        expect(reduced[0]).toMatchObject(new Range(0, 20));
    });
})
