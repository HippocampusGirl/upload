import { Range, reduceRanges } from "../range.js";

describe("range", () => {
  it("can be reduced", () => {
    const ranges = [new Range(11, 20), new Range(0, 10)];
    const reduced = reduceRanges(ranges);
    expect(reduced).toHaveLength(1);
    expect(reduced[0]).toMatchObject(new Range(0, 20));
  });
  it("can detect overlapping ranges", () => {
    const a = new Range(0, 10);
    const b = new Range(5, 15);
    expect(a.overlaps(b)).toBe(true);

    const c = new Range(0, 16783122);
    const d = new Range(67132492, 83915614);
    expect(c.overlaps(d)).toBe(false);
  });
  it("throws an error when reducing overlapping ranges", () => {
    const ranges = [new Range(0, 10), new Range(5, 15)];
    expect(() => reduceRanges(ranges)).toThrow();
  });
});
