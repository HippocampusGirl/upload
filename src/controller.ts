import Debug from "debug";
import fastq, { queueAsPromised } from "fastq";
import {
  DataSource,
  EntityManager,
  EntityTarget,
  InsertResult,
  IsNull,
  Not,
  ObjectLiteral,
} from "typeorm";

import { File } from "./entity/file.js";
import { Part } from "./entity/part.js";
import { StorageProvider } from "./entity/storage-provider.js";
import { FilePart } from "./part.js";
import { Range } from "./utils/range.js";

const debug = Debug("controller");

const upsert = <Entity extends ObjectLiteral>(
  manager: EntityManager,
  target: EntityTarget<Entity>,
  entity: Partial<Entity>,
  conflictKeys: (keyof Entity)[]
): Promise<InsertResult> => {
  const metadata = manager.connection.getMetadata(target);

  const conflictColumns = metadata.mapPropertyPathsToColumns(
    conflictKeys as string[]
  );
  const overwriteColumns = metadata
    .mapPropertyPathsToColumns(Object.keys(entity))
    .filter((column) => !conflictColumns.includes(column));

  return manager
    .createQueryBuilder()
    .insert()
    .into(target)
    .values(entity)
    .updateEntity(false)
    .orUpdate(
      [...conflictColumns, ...overwriteColumns].map((col) => col.databaseName),
      conflictColumns.map((col) => col.databaseName),
      {
        skipUpdateIfNoValuesChanged: true,
        upsertType: "on-conflict-do-update",
      }
    )
    .execute();
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

  // File
  async getFileById(id: number): Promise<File | null> {
    return this.submitTransaction(
      async (manager): Promise<File | null> =>
        manager.findOne(File, { where: { id } })
    );
  }
  async getFileByPath(n: string, path: string): Promise<File | null> {
    return this.submitTransaction(async (manager): Promise<File | null> => {
      return manager.findOne(File, {
        where: { n, path },
        relations: { parts: true },
      });
    });
  }
  async getUnverifiedFiles(): Promise<File[]> {
    return this.submitTransaction(async (manager): Promise<File[]> => {
      return await manager.find(File, {
        where: { checksumSHA256: Not(IsNull()), verified: false },
      });
    });
  }
  async setVerified(n: string, path: string): Promise<void> {
    return this.submitTransaction(async (manager): Promise<void> => {
      const repository = manager.getRepository(File);
      const result = await repository.update({ n, path }, { verified: true });
      if (result.affected !== 1) {
        throw new Error(`File not found for ${n} ${path}`);
      }
    });
  }
  async setChecksumSHA256(
    n: string,
    path: string,
    checksumSHA256: string
  ): Promise<void> {
    return await this.submitTransaction(async (manager) => {
      await upsert(
        manager,
        File,
        { n, path, checksumSHA256, verified: false },
        ["n", "path"]
      );
    });
  }

  // Part
  async addPart(n: string, filePart: FilePart): Promise<boolean> {
    const { path, range, checksumMD5, size } = filePart;
    const { start, end } = range;
    return this.submitTransaction(async (manager): Promise<boolean> => {
      debug("adding file part %O", filePart);

      await upsert(manager, File, { n, path, size }, ["n", "path"]);
      const file = await manager.findOneBy(File, { n, path });
      if (file === null) {
        throw new Error(`Could not create file for ${filePart}`);
      }

      const part: Part | null = await manager.findOne(Part, {
        where: { file, start, end, checksumMD5 },
      });
      if (part !== null) {
        return !part.complete;
      }

      await manager.update(File, { id: file.id }, { verified: false });
      await upsert(
        manager,
        Part,
        { start, end, file_id: file.id, checksumMD5, complete: false },
        ["start", "end", "file_id"]
      );
      return true;
    });
  }
  async getPart(checksumMD5: string, range: Range): Promise<Part | null> {
    return this.submitTransaction(async (manager): Promise<Part | null> => {
      const { start, end } = range;
      return manager.findOne(Part, {
        where: { checksumMD5, start, end },
        relations: { file: true },
      });
    });
  }
  async setComplete(n: string, filePart: FilePart): Promise<File> {
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

  // StorageProvider
  async getStorageProvider(id: string): Promise<StorageProvider | null> {
    return this.dataSource.manager.findOneBy(StorageProvider, { id });
  }
  async getStorageProviders(): Promise<StorageProvider[]> {
    return this.dataSource.manager.find(StorageProvider);
  }
}
