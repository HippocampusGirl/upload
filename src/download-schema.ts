import { _File, FilePart, Job } from "./part.js";

interface DownloadBase {
  bucket: string;
}
export interface DownloadFilePart extends DownloadBase, FilePart {}
export interface DownloadJob extends DownloadFilePart, Job {}
export interface ChecksumJob extends DownloadBase, _File {
  checksumSHA256: string;
}
