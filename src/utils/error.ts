/**
 * Adapted from https://stackoverflow.com/a/65243177
 */
export class CustomError extends Error {
  constructor(message?: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DuplicateError extends CustomError {}
