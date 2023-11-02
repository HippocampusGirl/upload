// Set up custom errors
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
  }
}
