import { dataSource } from "./data-source.js";
import { File, Part } from "./entity.js";
import { FilePart } from "./part.js";
import { Range } from "./utils/range.js";

export const setChecksumSHA256 = async (
  bucket: string,
  path: string,
  checksumSHA256: string
) => {
  await dataSource.transaction(async (manager) => {
    let file = await manager.findOneBy(File, { bucket, path });
    if (file === null) {
      file = new File({
        bucket,
        path,
      });
    }
    file.checksumSHA256 = checksumSHA256;
    manager.save(file);
  });
};

export const addFilePart = async (
  bucket: string,
  filePart: FilePart
): Promise<boolean> => {
  const { path, range, checksumMD5, size } = filePart;
  const { start, end } = range;
  return await dataSource.transaction(async (manager): Promise<boolean> => {
    let part: Part | null = await manager.findOneBy(Part, {
      file: { bucket, path },
      start,
      end,
      checksumMD5,
    });
    if (part !== null) {
      return !part.complete;
    }
    // We need to create a new part
    let file = await manager.findOneBy(File, { bucket, path });
    if (file === null) {
      // We need to create a new file
      file = new File({
        bucket,
        path,
      });
    }
    part = new Part({
      file,
      start,
      end,
      checksumMD5,
    });
    if (file.size === null) {
      // We do not yet have size information in the database, so we can set it
      file.size = size;
    } else if (file.size !== size) {
      // Otherwise we need to check that the size matches
      throw new Error(
        `Mismatched size for ${bucket} ${path}: ${file.size} !== ${size}`
      );
    }

    await manager.save(file);
    await manager.save(part);

    return true;
  });
};

export const getPart = async (
  checksumMD5: string,
  range: Range
): Promise<Part | null> => {
  return await dataSource.manager.findOneBy(Part, { checksumMD5, range });
};
export const completePart = async (
  bucket: string,
  filePart: FilePart
): Promise<boolean> => {
  const { path, range, checksumMD5 } = filePart;
  const { start, end } = range;
  return await dataSource.transaction(async (manager) => {
    const part = await manager.findOneBy(Part, {
      file: { bucket, path },
      start,
      end,
      checksumMD5,
    });
    if (part === null) {
      throw new Error(`Part not found for ${bucket} ${path} ${range}`);
    }
    part.complete = true;
    await manager.save(part);
    return part.file.verified;
  });
};

export const getFile = async (
  bucket: string,
  path: string
): Promise<File | null> => {
  return await dataSource.manager.findOneBy(File, { bucket, path });
};
export const setVerified = async (
  bucket: string,
  path: string
): Promise<void> => {
  await dataSource.transaction(async (manager) => {
    let file = await manager.findOneBy(File, { bucket, path });
    if (file === null) {
      throw new Error(`File not found for ${bucket} ${path}`);
    }
    file.verified = true;
    await manager.save(file);
  });
};

// export abstract class Info<J> {
//   public readonly path: string;

//   protected queue: queueAsPromised<J, boolean>;

//   protected data?: InfoData;

//   constructor(path: string) {
//     this.path = path;
//     this.queue = fastq.promise(this, this.run, 1);
//   }

//   protected abstract get key(): string;
//   protected abstract run(job: J): Promise<boolean>;

//   protected get defaultData(): InfoData {
//     return { parts: [], verified: false };
//   }
//   protected abstract load(): Promise<InfoData>;
//   protected abstract save(): Promise<void>;

//   public async isVerified(): Promise<boolean> {
//     const data = await this.load();
//     return data.verified;
//   }
//   public abstract toString(): string;

//   protected findUploadPart(query: Part, data: InfoData): InfoPart | undefined {
//     const parts = data.parts.filter((part) => part.range.equals(query.range));
//     if (parts.length !== 1) {
//       return;
//     }
//     const [part] = parts;
//     return part;
//   }
//   protected runAddFilePart(filePart: FilePart, data: InfoData): boolean {
//     const part = this.findUploadPart(filePart, data);
//     if (part !== undefined) {
//       return !part.complete;
//     }

//     const { range, checksumMD5, size } = filePart;
//     data.parts.push({ range, checksumMD5, complete: false });
//     if (data.size === undefined) {
//       data.size = size;
//     } else if (data.size !== size) {
//       throw new Error(
//         `Mismatched size for ${this.toString()}: ${data.size} !== ${size}`
//       );
//     }
//     return true;
//   }
//   protected runCompletePart(query: Part, data: InfoData): boolean {
//     const part = this.findUploadPart(query, data);
//     if (part === undefined) {
//       const rangeString = query.range.toString();
//       throw new Error(`Part not found for ${this.toString()}: ${rangeString}`);
//     }
//     if (part.checksumMD5 !== query.checksumMD5) {
//       throw new Error(
//         `Mismatched checksum for ${this.toString()}: ` +
//           `${part.checksumMD5} !== ${query.checksumMD5}`
//       );
//     }
//     part.complete = true;
//     return true;
//   }
// }
