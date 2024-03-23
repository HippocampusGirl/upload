// Set up custom errors
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
  }
}

interface UnknownError {
  error: "unknown";
}
interface UploadCreateExistsError {
  error: "upload-exists";
}
interface StorageProviderError {
  error: "unknown-storage-provider";
}
export type UploadCreateError = UploadCreateExistsError | UnknownError;
export type DownloadCompleteError = StorageProviderError | UnknownError;
