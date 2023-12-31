import Joi from "joi";

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

const byStart = (a: Range, b: Range): number => a.start - b.start;
export const reduceRanges = (ranges: Range[]): Range[] =>
  ranges.sort(byStart).reduce((array: Range[], range: Range): Range[] => {
    if (array.length === 0) {
      array.push(range);
      return array;
    }
    const { start, end } = range;
    const previous = array[array.length - 1];
    if (previous.touches(range)) {
      previous.start = Math.min(previous.start, start);
      previous.end = Math.max(previous.end, end);
    } else {
      array.push(range);
    }
    return array;
  }, new Array<Range>());

export const rangeSchema = Joi.object().keys({
  start: Joi.number().required(),
  end: Joi.number().required(),
});
