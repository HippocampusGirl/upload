import { File, FilePart, Job } from "./part.js";

interface DownloadBase {
  name: string;
}
export interface DownloadFilePart extends DownloadBase, FilePart {}
export interface DownloadJob extends DownloadFilePart, Job {}
export interface ChecksumJob extends DownloadBase, File {
  checksumSHA256: string;
}
