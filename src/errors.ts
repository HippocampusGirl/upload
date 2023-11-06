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
