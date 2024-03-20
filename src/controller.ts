import fastq, { queueAsPromised } from "fastq";
import { DataSource, EntityManager, IsNull, Not } from "typeorm";

import { File, Part } from "./entity.js";
import { FilePart } from "./part.js";
import { Range } from "./utils/range.js";

const checkPart = (
  part: Part,
  range: Range,
  bucket: string,
  path: string
): void => {
  const { start, end } = range;
  if (part.start !== start || part.end !== end) {
    throw new Error(`Part range mismatch for ${bucket} ${path} ${range}`);
  }
  const file = part.file;
  if (!file) {
    throw new Error(`File not found for ${bucket} ${path} ${range}`);
  }
  if (file.bucket !== bucket || file.path !== path) {
    throw new Error(`Part file mismatch for ${bucket} ${path} ${range}`);
  }
};

export class Controller {
  dataSource: DataSource;
  queue: queueAsPromised<(manager: EntityManager) => Promise<any>, any>;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
    this.queue = fastq.promise(this, this.runTransaction, 1);
  }

  async submitTransaction<T>(
    callback: (manager: EntityManager) => Promise<T>
  ): Promise<T> {
    return this.queue.push(callback);
  }
  async runTransaction(
    callback: (manager: EntityManager) => Promise<any>
  ): Promise<any> {
    return this.dataSource.transaction("SERIALIZABLE", callback);
  }

  async setChecksumSHA256(
    bucket: string,
    path: string,
    checksumSHA256: string
  ): Promise<void> {
    return await this.submitTransaction(async (manager) => {
      const result = await manager.upsert(
        File,
        { bucket, path, checksumSHA256 },
        ["bucket", "path"]
      );
      if (result.identifiers.length !== 1) {
        throw new Error(`File not found for ${bucket} ${path}`);
      }
    });
  }

  async addFilePart(bucket: string, filePart: FilePart): Promise<boolean> {
    const { path, range, checksumMD5, size } = filePart;
    const { start, end } = range;
    return this.submitTransaction(async (manager): Promise<boolean> => {
      let part: Part | null = await manager.findOne(Part, {
        where: { checksumMD5 },
        relations: {
          file: true,
        },
      });
      if (part !== null) {
        checkPart(part, range, bucket, path);
        return !part.complete;
      }

      let file: File | null = await manager.findOneBy(File, {
        bucket,
        path,
      });
      if (file === null) {
        // We need to create a new file
        await manager.insert(File, {
          bucket,
          path,
          size,
        });
      } else if (file.size !== size) {
        // Check that the size matches
        throw new Error(
          `Mismatched size for ${bucket} ${path}: ${file.size} !== ${size}`
        );
      }
      // We need to create a new part
      await manager.insert(Part, {
        checksumMD5,
        start,
        end,
        file: { bucket, path },
      });
      return true;
    });
  }

  async getPart(checksumMD5: string, range: Range): Promise<Part | null> {
    return this.submitTransaction(async (manager): Promise<Part | null> => {
      return manager.findOne(Part, {
        where: {
          checksumMD5,
          start: range.start,
          end: range.end,
        },
        relations: {
          file: true,
        },
      });
    });
  }
  async completePart(bucket: string, filePart: FilePart): Promise<File> {
    const { path, range, checksumMD5 } = filePart;
    return this.submitTransaction(async (manager): Promise<File> => {
      const result = await manager.update(Part, checksumMD5, {
        complete: true,
      });
      if (result.affected !== 1) {
        throw new Error(`File not found for ${bucket} ${path}`);
      }
      const part: Part | null = await manager.findOne(Part, {
        where: { checksumMD5 },
        relations: {
          file: true,
        },
      });
      if (part === null) {
        throw new Error(`Part not found for ${bucket} ${path} ${range}`);
      }
      checkPart(part, range, bucket, path);
      return part.file;
    });
  }

  async getFile(bucket: string, path: string): Promise<File | null> {
    return this.submitTransaction(async (manager): Promise<File | null> => {
      return await manager.findOneBy(File, { bucket, path });
    });
  }
  async getFilesToVerify(): Promise<File[]> {
    return this.submitTransaction(async (manager): Promise<File[]> => {
      return await manager.find(File, { where: { checksumSHA256: Not(IsNull()), verified: false } });
    });
  }
  async setVerified(bucket: string, path: string): Promise<void> {
    return this.submitTransaction(async (manager): Promise<void> => {
      const result = await manager.update(
        File,
        { bucket, path },
        { verified: true }
      );
      if (result.affected !== 1) {
        throw new Error(`File not found for ${bucket} ${path}`);
      }
    });
  }
}
