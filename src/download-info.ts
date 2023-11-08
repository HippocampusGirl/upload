import Debug from "debug";
import { DownloadJob } from "download-schema.js";
import Joi from "joi";
import { open } from "node:fs/promises";

import { calculateChecksum, touch } from "./fs.js";
import {
  CompletePartJob,
  Info,
  InfoData,
  InfoJob,
  InfoPart,
  SetChecksumSHA256Job
} from "./info.js";
import { Part } from "./part.js";
import { Range, reduceRanges } from "./range.js";
import { uploadInfoSchema } from "./upload-info.js";

const debug = Debug("download-client");

interface AddDownloadJobJob extends InfoJob {
  type: "add-download-job";
  downloadJob: DownloadJob;
}
type DownloadInfoJob =
  | SetChecksumSHA256Job
  | AddDownloadJobJob
  | CompletePartJob;

interface DownloadInfoData extends InfoData {
  complete: boolean;
  verified: boolean;
  parts: InfoPart[];
  size?: number;
  checksumSHA256?: string;
}
const downloadInfoSchema = uploadInfoSchema
  .keys({
    complete: Joi.boolean().required(),
    verified: Joi.boolean().required(),
  })
  .required();
const isDownloadInfoData = (data: unknown): data is DownloadInfoData => {
  const { error } = downloadInfoSchema.validate(data);
  return error === undefined;
};

interface CompleteDownloadInfoData extends DownloadInfoData {
  complete: true;
  size: number;
  checksumSHA256: string;
}

export class DownloadInfo extends Info<DownloadInfoJob, DownloadInfoData> {
  constructor(path: string) {
    super(path);
  }

  protected get key(): string {
    return `${this.path}.download-info.json`;
  }
  protected get defaultData(): DownloadInfoData {
    return { parts: [], complete: false, verified: false };
  }
  public toString(): string {
    return `${this.path}`;
  }

  protected async load(): Promise<DownloadInfoData> {
    if (this.data !== undefined) {
      return this.data;
    }

    await touch(this.key);

    let fileHandle, buffer;
    try {
      fileHandle = await open(this.key, "r");
      buffer = await fileHandle.readFile("utf8");
    } finally {
      await fileHandle?.close();
    }

    const data = this.parse(buffer.toString(), isDownloadInfoData);
    this.data = data;
    return data;
  }

  protected async run(job: DownloadInfoJob): Promise<boolean> {
    // debug("run job %o", job);
    const data = await this.load();
    let result: boolean | undefined = undefined;
    switch (job.type) {
      case "set-checksum-sha256":
        data.checksumSHA256 = job.checksumSHA256;
        break;
      case "add-download-job":
        result = this.runAddFilePart(job.downloadJob, data);
        break;
      case "complete-part":
        this.runCompletePart(job.part, data);
        break;
    }
    if (result === undefined) {
      if (this.complete(data)) {
        data.verified = await this.verified(data);
      }
      result = data.verified;
    }
    await this.save();
    return result;
  }

  async setChecksumSHA256(checksumSHA256: string): Promise<boolean> {
    return await this.queue.push({
      type: "set-checksum-sha256",
      checksumSHA256,
    });
  }
  async addDownloadJob(downloadJob: DownloadJob): Promise<boolean> {
    return await this.queue.push({ type: "add-download-job", downloadJob });
  }
  async completePart(part: Part): Promise<void> {
    await this.queue.push({ type: "complete-part", part });
  }

  private async verified(data: CompleteDownloadInfoData): Promise<boolean> {
    if (data.verified) {
      return true;
    }
    const checksumSHA256 = await calculateChecksum(this.path, "sha256");
    if (checksumSHA256 === data.checksumSHA256) {
      debug("verified checksum for %s", this.path);
      return true;
    }
    throw new Error(`invalid checksum for ${this.path}`);
  }
  private complete(data: DownloadInfoData): data is CompleteDownloadInfoData {
    if (data.complete) {
      return true;
    }
    if (data.size === undefined || data.checksumSHA256 === undefined) {
      return false;
    }
    const ranges = reduceRanges(
      data.parts
        .filter(({ complete }) => complete)
        .map(({ range }) => new Range(range.start, range.end))
    );
    if (ranges.length !== 1) {
      debug("incomplete ranges %o", ranges);
      return false;
    }
    const [range] = ranges;
    const { start } = range;
    data.complete = start == 0 && range.size() == data.size;
    if (!data.complete) {
      debug("incomplete range %o for file size %s", range, data.size);
    }
    return data.complete;
  }

  protected async save(): Promise<void> {
    const dataString = JSON.stringify(this.data, null, 2);
    // debug(`saving download info ${dataString}`);
    let fileHandle;
    try {
      fileHandle = await open(this.key, "w");
      await fileHandle.writeFile(dataString, "utf8");
    } finally {
      await fileHandle?.close();
    }
  }
}
