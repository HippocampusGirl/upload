import type { Range } from "../range.js";
import { overlaps, reduceRanges } from "../range.js";

describe("range", () => {
  it("can be reduced", () => {
    const ranges: Range[] = [
      { start: 11, end: 20 },
      { start: 0, end: 10 },
    ];
    const reduced = reduceRanges(ranges);
    expect(reduced).toHaveLength(1);
    expect(reduced[0]).toMatchObject({ start: 0, end: 20 });
  });
  it("can detect overlapping ranges", () => {
    const a = { start: 0, end: 10 };
    const b = { start: 5, end: 15 };
    expect(overlaps(a, b)).toBe(true);

    const c = { start: 0, end: 16783122 };
    const d = { start: 67132492, end: 83915614 };
    expect(overlaps(c, d)).toBe(false);
  });
  it("throws an error when reducing overlapping ranges", () => {
    const ranges = [
      { start: 0, end: 10 },
      { start: 5, end: 15 },
    ];
    expect(() => reduceRanges(ranges)).toThrow();
  });
});
