import fastq, { queueAsPromised } from "fastq";
import { DataSource, EntityManager, IsNull, Not } from "typeorm";

import { File } from "./entity/file.js";
import { Part } from "./entity/part.js";
import { StorageProvider } from "./entity/storage-provider.js";
import { FilePart } from "./part.js";
import { Range } from "./utils/range.js";

export class Controller {
  dataSource: DataSource;
  queue: queueAsPromised<(manager: EntityManager) => Promise<unknown>, unknown>;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
    this.queue = fastq.promise(this, this.runTransaction, 1);
  }

  async submitTransaction<T>(
    callback: (manager: EntityManager) => Promise<T>
  ): Promise<T> {
    return this.queue.push(callback) as T;
  }
  async runTransaction(
    callback: (manager: EntityManager) => Promise<unknown>
  ): Promise<unknown> {
    return this.dataSource.transaction("SERIALIZABLE", callback);
  }

  async setChecksumSHA256(
    n: string,
    path: string,
    checksumSHA256: string
  ): Promise<void> {
    return await this.submitTransaction(async (manager) => {
      const result = await manager.upsert(
        File,
        { n, path, checksumSHA256, verified: false },
        ["n", "path"]
      );
      if (result.identifiers.length !== 1) {
        throw new Error(`File not found for ${n} ${path}`);
      }
    });
  }

  async addFilePart(n: string, filePart: FilePart): Promise<boolean> {
    const { path, range, checksumMD5, size } = filePart;
    const { start, end } = range;
    return this.submitTransaction(async (manager): Promise<boolean> => {
      await manager.upsert(File, { n, path, size, verified: false }, [
        "n",
        "path",
      ]);
      const file = await manager.findOneBy(File, {
        n,
        path,
      });
      if (file === null) {
        throw new Error(`Could not create file for ${filePart}`);
      }

      const part: Part | null = await manager.findOne(Part, {
        where: { file, start, end, checksumMD5 },
      });
      if (part !== null) {
        return !part.complete;
      }

      await manager.upsert(
        Part,
        { start, end, file_id: file.id, checksumMD5, complete: false },
        ["start", "end", "file_id"]
      );
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
  async completePart(n: string, filePart: FilePart): Promise<File> {
    const {
      path,
      range: { start, end },
    } = filePart;
    return this.submitTransaction(async (manager): Promise<File> => {
      const file = await manager.findOne(File, { where: { n, path } });
      if (file === null) {
        throw new Error(`File not found for ${n} ${path}`);
      }
      const result = await manager.update(
        Part,
        { file, start, end },
        { complete: true }
      );
      if (result.affected !== 1) {
        throw new Error(`File not found for ${n} ${path}`);
      }
      return file;
    });
  }

  async getFileById(id: number): Promise<File | null> {
    return this.submitTransaction(async (manager): Promise<File | null> => {
      return manager.findOne(File, { where: { id } });
    });
  }
  async getFile(n: string, path: string): Promise<File | null> {
    return this.submitTransaction(async (manager): Promise<File | null> => {
      return manager.findOne(File, {
        where: { n, path },
        relations: { parts: true },
      });
    });
  }
  async getFilesToVerify(): Promise<File[]> {
    return this.submitTransaction(async (manager): Promise<File[]> => {
      return await manager.find(File, {
        where: { checksumSHA256: Not(IsNull()), verified: false },
      });
    });
  }
  async setVerified(n: string, path: string): Promise<void> {
    return this.submitTransaction(async (manager): Promise<void> => {
      const result = await manager.update(
        File,
        { n, path },
        { verified: true }
      );
      if (result.affected !== 1) {
        throw new Error(`File not found for ${n} ${path}`);
      }
    });
  }

  async getStorageProvider(id: string): Promise<StorageProvider | null> {
    return this.dataSource.manager.findOneBy(StorageProvider, { id });
  }
  async getStorageProviders(): Promise<StorageProvider[]> {
    return this.dataSource.manager.find(StorageProvider);
  }
}
