import { _File, FilePart, Job } from "./part.js";

interface DownloadBase {
  bucket: string;
}
export interface DownloadFile extends DownloadBase, _File {}
export interface DownloadJob extends DownloadFile, FilePart, Job {
  storageProviderId: string;
  bucket: string;
}
export interface ChecksumJob extends DownloadFile, _File {
  checksumSHA256: string;
}
