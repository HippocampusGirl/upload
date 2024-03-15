import { DataSource } from "typeorm";

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
  if (file.bucket !== bucket || file.path !== path) {
    throw new Error(`Part file mismatch for ${bucket} ${path} ${range}`);
  }
};

export const setChecksumSHA256 = async (
  bucket: string,
  path: string,
  checksumSHA256: string,
  dataSource: DataSource
) => {
  await dataSource.transaction(async (manager) => {
    const result = await manager.update(
      File,
      { bucket, path },
      { checksumSHA256 }
    );
    if (result.affected !== 1) {
      throw new Error(`File not found for ${bucket} ${path}`);
    }
  });
};

export const addFilePart = async (
  bucket: string,
  filePart: FilePart,
  dataSource: DataSource
): Promise<boolean> => {
  const { path, range, checksumMD5, size } = filePart;
  const { start, end } = range;
  return await dataSource.transaction(async (manager): Promise<boolean> => {
    let part: Part | null = await manager.findOneBy(Part, {
      checksumMD5,
    });
    if (part !== null) {
      checkPart(part, range, bucket, path);
      return !part.complete;
    }

    // We need to create a new part
    await manager.insert(Part, {
      checksumMD5,
      start,
      end,
      file: { bucket, path },
    });
    // part = new Part({
    //   file,
    //   start,
    //   end,
    //   checksumMD5,
    // });
    // if (file.size === null) {
    //   // We do not yet have size information in the database, so we can set it
    //   file.size = size;
    // } else if (file.size !== size) {
    //   // Otherwise we need to check that the size matches
    //   throw new Error(
    //     `Mismatched size for ${bucket} ${path}: ${file.size} !== ${size}`
    //   );
    // }

    // await manager.insert(Part, part);

    return true;
  });
};

export const getPart = async (
  checksumMD5: string,
  range: Range,
  dataSource: DataSource
): Promise<Part | null> => {
  return await dataSource.manager.findOneBy(Part, {
    checksumMD5,
    start: range.start,
    end: range.end,
  });
};
export const completePart = async (
  bucket: string,
  filePart: FilePart,
  dataSource: DataSource
): Promise<boolean> => {
  const { path, range, checksumMD5 } = filePart;
  return await dataSource.transaction(async (manager) => {
    const result = await manager.update(Part, checksumMD5, { complete: true });
    if (result.affected !== 1) {
      throw new Error(`File not found for ${bucket} ${path}`);
    }
    const part = await manager.findOneBy(Part, { checksumMD5 });
    if (part === null) {
      throw new Error(`Part not found for ${bucket} ${path} ${range}`);
    }
    checkPart(part, range, bucket, path);
    return part.file.verified;
  });
};

export const getFile = async (
  bucket: string,
  path: string,
  dataSource: DataSource
): Promise<File | null> => {
  return await dataSource.manager.findOneBy(File, { bucket, path });
};
export const setVerified = async (
  bucket: string,
  path: string,
  dataSource: DataSource
): Promise<void> => {
  await dataSource.transaction(async (manager) => {
    const result = await manager.update(
      File,
      { bucket, path },
      { verified: true }
    );
    if (result.affected !== 1) {
      throw new Error(`File not found for ${bucket} ${path}`);
    }
  });
};
