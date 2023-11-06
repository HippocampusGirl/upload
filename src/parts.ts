import { stat } from "node:fs/promises";

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
}

export interface UploadOptions {
  path: string;
  ranges: Range[];
}

export interface UploadJob {
  path: string;
  range: Range;
  url: string;
}

export interface RangeOptions {
  minPartSize: number;
  maxPartCount: number;
}

export async function* generateUploadOptions(
  paths: string[],
  { minPartSize, maxPartCount }: RangeOptions
): AsyncGenerator<UploadOptions, void, void> {
  for (let path of paths) {
    const stats = await stat(path);
    const size = stats.size;

    const partCount = Math.min(
      maxPartCount,
      Math.floor(Number(size) / Number(minPartSize))
    );
    const partSize = Math.ceil(Number(size) / partCount);

    const ranges: Range[] = new Array();
    for (let i = 0; i < partCount; i++) {
      const start = i * partSize;
      let end = start + partSize;

      // Last part cannot go beyond the end of the file
      end = (end > size ? size : end) - 1;

      const range = new Range(start, end);

      // Last part cannot be smaller than `minPartSize`
      if (range.size() < minPartSize) {
        ranges[ranges.length - 1].end = end;
        continue;
      }

      ranges.push(range);
    }

    yield { path, ranges };
  }
}
