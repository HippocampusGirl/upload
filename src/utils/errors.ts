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
export type UploadCreateError = UploadCreateExistsError | UnknownError;
