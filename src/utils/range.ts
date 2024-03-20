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
    return this.end + 1 >= that.start && this.start - 1 <= that.end;
  }

  toString(): string {
    return `${this.start}-${this.end}`;
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
    } else {
      array.push(range);
    }
    return array;
  }, new Array<Range>());
