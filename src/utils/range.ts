const delimiter = ".";

export interface Range {
  start: number; // inclusive
  end: number; // inclusive
}

export const size = (range: Range): number => {
  return range.end - range.start + 1;
};

export const equals = (a: Range, b: Range): boolean => {
  return a.start === b.start && a.end === b.end;
};
export const touches = (a: Range, b: Range): boolean => {
  return a.end + 1 == b.start || b.end + 1 == a.start;
};
export const overlaps = (a: Range, b: Range): boolean => {
  return a.end + 1 > b.start && b.end + 1 > a.start;
};

export const toString = (range: Range): string => {
  return `${range.start}-${range.end}`;
};

export const toSuffix = (range: Range, size: number): string => {
  const digits = size.toString(10).length;

  const [start, end] = [range.start, range.end].map((n) =>
    n.toString(10).padStart(digits, "0")
  );
  return `${delimiter}${start}-${end}`;
};

export const parse = (path: string): [string, Range] => {
  const tokens = path.split(delimiter);
  const suffix = tokens.pop();
  if (suffix === undefined) {
    throw new Error(`Invalid path: ${path}`);
  }
  const [start, end]: (number | undefined)[] = suffix
    .split("-")
    .map((n) => parseInt(n, 10));
  if (start === undefined || Number.isNaN(start) || start < 0) {
    throw new Error(`Invalid start: ${path}`);
  }
  if (end === undefined || Number.isNaN(end) || end < start || end < 0) {
    throw new Error(`Invalid end: ${path}`);
  }
  return [tokens.join(delimiter), { start, end }];
};

const byStart = (a: Range, b: Range): number => Number(a.start - b.start);
export const reduceRanges = (ranges: Range[]): Range[] =>
  ranges.sort(byStart).reduce((array: Range[], range: Range): Range[] => {
    const previous = array[array.length - 1];
    if (previous === undefined) {
      array.push(range);
      return array;
    }
    const { start, end } = range;

    if (touches(previous, range) || overlaps(previous, range)) {
      if (start < previous.start) {
        previous.start = start;
      }
      if (end > previous.end) {
        previous.end = end;
      }
    } else {
      array.push(range);
    }
    return array;
  }, new Array<Range>());
