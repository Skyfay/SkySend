import { forTerminal } from "./terminal.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    // The message usually comes from the server, which this client does not trust, and every
    // caller prints it.
    super(forTerminal(message));
    this.name = "ApiError";
  }
}
