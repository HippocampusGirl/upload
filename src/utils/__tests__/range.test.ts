import { Range, reduceRanges } from "../range.js";

describe("range", () => {
  it("can be reduced", async () => {
    const ranges = [new Range(11, 20), new Range(0, 10)];
    const reduced = reduceRanges(ranges);
    expect(reduced).toHaveLength(1);
    expect(reduced[0]).toMatchObject(new Range(0, 20));
  });
  it("can detect overlapping ranges", async () => {
    const a = new Range(0, 10);
    const b = new Range(5, 15);
    expect(a.overlaps(b)).toBe(true);
  });
  it("throws an error when reducing overlapping ranges", async () => {
    const ranges = [new Range(0, 10), new Range(5, 15)];
    expect(() => reduceRanges(ranges)).toThrow();
  });
});
