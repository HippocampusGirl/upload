const delimiter = ".";
export class Range {
  start: number; // inclusive
  end: number; // inclusive

  constructor(start: number, end: number) {
    this.start = start;
    this.end = end;
  }

  size(): number {
    return this.end - this.start + 1;
  }

  equals(that: Range): boolean {
    return this.start === that.start && this.end === that.end;
  }
  touches(that: Range): boolean {
    return this.end + 1 == that.start || that.end + 1 == this.start;
  }
  overlaps(that: Range): boolean {
    return this.end + 1 > that.start || that.end + 1 > this.start;
  }

  toString(): string {
    return `${this.start}-${this.end}`;
  }

  toSuffix(size: number): string {
    const digits = size.toString(10).length;

    const [start, end] = [this.start, this.end].map((n) =>
      n.toString(10).padStart(digits, "0")
    );
    return `${delimiter}${start}-${end}`;
  }

  static parse(path: string): Range {
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
    return new Range(start, end);
  }
}

const byStart = (a: Range, b: Range): number => Number(a.start - b.start);
export const reduceRanges = (ranges: Range[]): Range[] =>
  ranges.sort(byStart).reduce((array: Range[], range: Range): Range[] => {
    const previous = array[array.length - 1];
    if (previous === undefined) {
      array.push(range);
      return array;
    }
    const { start, end } = range;
    if (previous.touches(range)) {
      if (start < previous.start) {
        previous.start = start;
      }
      if (end > previous.end) {
        previous.end = end;
      }
    } else if (previous.overlaps(range)) {
      throw new Error(`Overlapping ranges: ${previous} ${range}`);
    } else {
      array.push(range);
    }
    return array;
  }, new Array<Range>());
