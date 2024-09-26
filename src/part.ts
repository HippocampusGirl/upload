import type { Range } from "./utils/range.js";

export interface _Part {
  range: Range;
  checksumMD5: string;
}
export interface _File {
  path: string;
}
export interface FilePart extends _Part, _File {
  size: number; // total file size in bytes
}
export interface Job extends FilePart {
  url: string;
}
