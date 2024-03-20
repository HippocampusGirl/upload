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
