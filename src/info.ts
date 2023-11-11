import fastq, { queueAsPromised } from "fastq";
import Joi from "joi";

import { FilePart, parseRange, Part, partSchema } from "./part.js";

export interface InfoPart extends Part {
  complete: boolean;
}
export interface InfoData {
  parts: InfoPart[];
  size?: number;
  verified: boolean;
  checksumSHA256?: string;
}
export const infoDataSchema = Joi.object({
  parts: Joi.array().items(
    partSchema.keys({
      complete: Joi.boolean().required(),
    })
  ),
  size: Joi.number(),
  checksumSHA256: Joi.string(),
  verified: Joi.boolean().required(),
}).required();
const isInfoData = (data: unknown): data is InfoData => {
  const { error } = infoDataSchema.validate(data);
  return error === undefined;
};

export interface InfoJob {
  type: string;
  [key: string]: any;
}

export interface SetChecksumSHA256Job extends InfoJob {
  type: "set-checksum-sha256";
  checksumSHA256: string;
}
export interface CompletePartJob extends InfoJob {
  type: "complete-part";
  part: Part;
}

export abstract class Info<J> {
  public readonly path: string;

  protected queue: queueAsPromised<J, boolean>;

  protected data?: InfoData;

  constructor(path: string) {
    this.path = path;
    this.queue = fastq.promise(this, this.run, 1);
  }

  protected abstract get key(): string;
  protected abstract run(job: J): Promise<boolean>;

  protected get defaultData(): InfoData {
    return { parts: [], verified: false };
  }
  protected abstract load(): Promise<InfoData>;
  protected abstract save(): Promise<void>;

  public abstract toString(): string;

  protected findUploadPart(query: Part, data: InfoData): InfoPart | undefined {
    const parts = data.parts.filter((part) => part.range.equals(query.range));
    if (parts.length !== 1) {
      return;
    }
    const [part] = parts;
    return part;
  }
  protected runAddFilePart(filePart: FilePart, data: InfoData): boolean {
    const part = this.findUploadPart(filePart, data);
    if (part !== undefined) {
      return !part.complete;
    }

    const { range, checksumMD5, size } = filePart;
    data.parts.push({ range, checksumMD5, complete: false });
    if (data.size === undefined) {
      data.size = size;
    } else if (data.size !== size) {
      throw new Error(
        `Mismatched size for ${this.toString()}: ${data.size} !== ${size}`
      );
    }
    return true;
  }
  protected runCompletePart(query: Part, data: InfoData): boolean {
    const part = this.findUploadPart(query, data);
    if (part === undefined) {
      const rangeString = query.range.toString();
      throw new Error(`Part not found for ${this.toString()}: ${rangeString}`);
    }
    if (part.checksumMD5 !== query.checksumMD5) {
      throw new Error(
        `Mismatched checksum for ${this.toString()}: ` +
          `${part.checksumMD5} !== ${query.checksumMD5}`
      );
    }
    part.complete = true;
    return true;
  }

  protected parse(body: string): InfoData {
    let data;
    try {
      data = JSON.parse(body);
    } catch (error) {
      return this.defaultData;
    }
    if (typeof data !== "object" || data === null) {
      return this.defaultData;
    }
    if (!isInfoData(data)) {
      throw new Error(`Invalid download info data for ${this.path}: ${body}`);
    }
    data.parts.map((part) => parseRange(part));
    return data;
  }
}
