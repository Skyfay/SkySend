// An HTTP failure. `apiFor` in lib/api.ts throws it with the server's message already disarmed
// for the terminal, since every caller prints it.
export { ApiError } from "@skysend/transfer";
