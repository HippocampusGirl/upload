import fastq, { queueAsPromised } from "fastq";
import { DataSource, EntityManager, IsNull, Not } from "typeorm";

import { File } from "./entity/file.js";
import { Part } from "./entity/part.js";
import { StorageProvider } from "./entity/storage-provider.js";
import { FilePart } from "./part.js";
import { Range } from "./utils/range.js";

const checkPart = (part: Part, range: Range, n: string, path: string): void => {
  const { start, end } = range;
  if (part.start !== start || part.end !== end) {
    throw new Error(`Part range mismatch for ${n} ${path} ${range}`);
  }
  const file = part.file;
  if (!file) {
    throw new Error(`File not found for ${n} ${path} ${range}`);
  }
  if (file.n !== n || file.path !== path) {
    throw new Error(
      `Part file mismatch in range ${range}: ${file.n} != ${n} || ${file.path} !== ${path}`
    );
  }
};

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
      const result = await manager.upsert(File, { n, path, checksumSHA256 }, [
        "n",
        "path",
      ]);
      if (result.identifiers.length !== 1) {
        throw new Error(`File not found for ${n} ${path}`);
      }
    });
  }

  async addFilePart(n: string, filePart: FilePart): Promise<boolean> {
    const { path, range, checksumMD5, size } = filePart;
    const { start, end } = range;
    return this.submitTransaction(async (manager): Promise<boolean> => {
      const part: Part | null = await manager.findOne(Part, {
        where: { checksumMD5 },
        relations: {
          file: true,
        },
      });
      if (part !== null) {
        checkPart(part, range, n, path);
        return !part.complete;
      }

      const file: File | null = await manager.findOneBy(File, {
        n,
        path,
      });
      if (file === null) {
        // We need to create a new file
        await manager.insert(File, {
          n,
          path,
          size,
        });
      } else if (file.size === null) {
        await manager.update(File, { n, path }, { size });
      } else if (file.size !== size) {
        // Check that the size matches
        throw new Error(
          `Inconsistent size for ${n} ${path}: ${file.size} !== ${size}`
        );
      }
      // We need to create a new part
      await manager.insert(Part, {
        checksumMD5,
        start,
        end,
        file: { n, path },
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
  async completePart(n: string, filePart: FilePart): Promise<File> {
    const { path, range, checksumMD5 } = filePart;
    return this.submitTransaction(async (manager): Promise<File> => {
      const result = await manager.update(Part, checksumMD5, {
        complete: true,
      });
      if (result.affected !== 1) {
        throw new Error(`File not found for ${n} ${path}`);
      }
      const part: Part | null = await manager.findOne(Part, {
        where: { checksumMD5 },
        relations: {
          file: true,
        },
      });
      if (part === null) {
        throw new Error(`Part not found for ${n} ${path} ${range}`);
      }
      checkPart(part, range, n, path);
      return part.file;
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
