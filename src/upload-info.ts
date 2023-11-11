import Debug from "debug";

import {
  GetObjectCommand,
  GetObjectCommandInput,
  NoSuchKey,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

import { delimiter } from "./config.js";
import { getNameFromBucket } from "./download-parse.js";
import { ChecksumJob } from "./download-schema.js";
import {
  CompletePartJob,
  Info,
  InfoData,
  InfoJob,
  InfoPart,
  SetChecksumSHA256Job
} from "./info.js";
import { Part } from "./part.js";
import { UploadRequest } from "./upload-parts.js";

const debug = Debug("serve");

interface AddUploadRequestJob extends InfoJob {
  type: "add-upload-request";
  uploadRequest: UploadRequest;
}
interface SetVerifiedJob extends InfoJob {
  type: "set-verified";
}
type UploadInfoJob =
  | SetChecksumSHA256Job
  | AddUploadRequestJob
  | CompletePartJob
  | SetVerifiedJob;

export class UploadInfo extends Info<UploadInfoJob> {
  private s3: S3Client;
  public readonly bucket: string;

  constructor(bucket: string, path: string, s3: S3Client) {
    super(path);

    this.s3 = s3;
    this.bucket = bucket;
  }

  public static get suffix(): string {
    return "upload-info.json";
  }
  protected get key(): string {
    return `${this.path}${delimiter}${UploadInfo.suffix}`;
  }
  protected get input(): GetObjectCommandInput {
    return {
      Bucket: this.bucket,
      Key: this.key,
    };
  }
  public toString(): string {
    return `${this.bucket} ${this.path}`;
  }

  protected async load(): Promise<InfoData> {
    if (this.data !== undefined) {
      return this.data;
    }

    const command = new GetObjectCommand(this.input);
    let response;
    try {
      response = await this.s3.send(command);
    } catch (error) {
      if (error instanceof NoSuchKey) {
        this.data = this.defaultData;
        return this.data;
      }
      throw error;
    }
    const body = await response.Body?.transformToString();
    if (body === undefined) {
      throw new Error(`Invalid response from s3: "body" is undefined`);
    }

    const data = this.parse(body);
    this.data = data;
    // debug("load data %O", data);
    return data;
  }

  protected async run(job: UploadInfoJob): Promise<boolean> {
    // debug("run job %o", job);
    const data = await this.load();
    let result: boolean = false;

    let save = false;
    switch (job.type) {
      case "set-checksum-sha256":
        data.checksumSHA256 = job.checksumSHA256;
        result = true;
        save = true;
        break;
      case "add-upload-request":
        result = this.runAddFilePart(job.uploadRequest, data);
        break;
      case "complete-part":
        result = this.runCompletePart(job.part, data);
        save = true;
        break;
      case "set-verified":
        data.verified = true;
        save = true;
        break;
    }

    if (this.queue.length() === 0 || save) {
      // Only save if queue is empty or if it's an important state change
      await this.save();
    }
    return result;
  }

  async getSize(): Promise<number> {
    const { size } = await this.load();
    if (size === undefined) {
      throw new Error("Size not set");
    }
    return size;
  }
  async getChecksumJob(): Promise<ChecksumJob> {
    const { checksumSHA256, size } = await this.load();
    if (checksumSHA256 === undefined) {
      throw new Error("Checksum not set");
    }
    if (size === undefined) {
      throw new Error("Size not set");
    }
    return {
      name: getNameFromBucket(this.bucket),
      path: this.path,
      checksumSHA256,
      size,
    };
  }

  async setChecksumSHA256(checksumSHA256: string): Promise<boolean> {
    return await this.queue.push({
      type: "set-checksum-sha256",
      checksumSHA256,
    });
  }
  async addUploadRequest(uploadRequest: UploadRequest): Promise<boolean> {
    return await this.queue.push({ type: "add-upload-request", uploadRequest });
  }
  async completePart(part: Part): Promise<void> {
    await this.queue.push({ type: "complete-part", part });
  }
  async setVerified(): Promise<void> {
    await this.queue.push({ type: "set-verified" });
  }
  async getPart(query: Part): Promise<InfoPart> {
    const data = await this.load();
    const part = this.findUploadPart(query, data);
    if (part === undefined) {
      throw new Error("Part not found");
    }
    return part;
  }

  protected async save(): Promise<void> {
    // debug("saving upload info %O", this.data);
    if (this.data === undefined) {
      throw new Error(`Invalid state`);
    }
    const dataString = JSON.stringify(this.data, null, 2);

    const command = new PutObjectCommand({ ...this.input, Body: dataString });
    await this.s3.send(command);
  }
}
