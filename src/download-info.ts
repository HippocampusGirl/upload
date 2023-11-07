import Debug from "debug";
import { open, unlink } from "node:fs/promises";

import { calculateChecksum, touch } from "./fs.js";
import { Range, reduceRanges } from "./range.js";

const debug = Debug("download-client");

export class DownloadInfo {
  basePath: string;
  infoPath: string;

  ranges?: Range[];
  size?: number;
  checksumSha256?: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    this.infoPath = `${basePath}.download-info.json`;
  }

  async addRange(range: Range): Promise<void> {
    await this.load();
    this.ranges = this.ranges ?? [];
    this.ranges.push(range);

    // Merge adjacent ranges
    this.ranges = reduceRanges(this.ranges);

    await this.save();
  }

  async verifyChecksumSha256(): Promise<void> {
    await this.load();
    const checksumSha256 = await calculateChecksum(this.basePath);
    if (checksumSha256 !== this.checksumSha256) {
      throw new Error(`Invalid checksum: ${checksumSha256}`);
    }
  }
  async setChecksumSha256(checksumSha256: string): Promise<void> {
    await this.load();
    this.checksumSha256 = checksumSha256;
    await this.save();
  }

  async setSize(size: number): Promise<void> {
    await this.load();
    this.size = size;
    await this.save();
  }

  async isComplete(): Promise<boolean> {
    await this.load();
    if (this.size === undefined) {
      return false;
    }
    if (this.ranges === undefined) {
      return false;
    }
    if (this.ranges.length !== 1) {
      return false;
    }
    const [range] = this.ranges;
    const { start } = range;
    return start == 0 && range.size() == this.size;
  }

  async load(): Promise<void> {
    await touch(this.infoPath);
    let fileHandle, buffer;
    try {
      fileHandle = await open(this.infoPath, "r");
      buffer = await fileHandle.readFile("utf8");
    } finally {
      await fileHandle?.close();
    }

    if (buffer === undefined || buffer.length == 0) {
      return;
    }
    const data = JSON.parse(buffer.toString());
    if (typeof data !== "object" || data === null) {
      return;
    }

    if (data.ranges !== undefined) {
      this.ranges = data.ranges.map(
        ({ start, end }: { start: number; end: number }) =>
          new Range(start, end)
      );
    }
    if (data.size !== undefined) {
      this.size = data.size;
    }
    if (data.checksumSha256 !== undefined) {
      this.checksumSha256 = data.checksumSha256;
    }
  }
  async save(): Promise<void> {
    const data = JSON.stringify(
      {
        ranges: this.ranges,
        size: this.size,
        checksumSha256: this.checksumSha256,
      },
      null,
      2
    );
    // debug(`saving download info ${data}`);
    let fileHandle;
    try {
      fileHandle = await open(this.infoPath, "w");
      await fileHandle.writeFile(data, "utf8");
    } finally {
      await fileHandle?.close();
    }
  }
  async delete(): Promise<void> {
    await unlink(this.infoPath);
  }
}
