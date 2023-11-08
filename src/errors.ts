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

export interface UnknownError {
  error: "unknown";
}
export interface UploadCreateExistsError {
  error: "upload-exists";
}
export type UploadCreateError = UploadCreateExistsError | UnknownError;
