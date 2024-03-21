import { delimiter } from "../config.js";
import { Range } from "../utils/range.js";

export const getRangeFromPathname = (pathname: string): Range => {
  const tokens = pathname.split(delimiter);
  const suffix = tokens.pop();
  if (suffix === undefined) {
    throw new Error(`Invalid path: ${pathname}`);
  }
  const [start, end]: (number | undefined)[] = suffix
    .split("-")
    .map((n) => parseInt(n, 10));
  if (start === undefined || Number.isNaN(start) || start < 0) {
    throw new Error(`Invalid start: ${pathname}`);
  }
  if (end === undefined || Number.isNaN(end) || end < start || end < 0) {
    throw new Error(`Invalid end: ${pathname}`);
  }
  return new Range(start, end);
};
