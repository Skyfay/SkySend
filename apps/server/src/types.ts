/**
 * Shared Hono context variable types for the SkySend server.
 */
export interface QuotaVariables {
  quotaHashedIp?: string;
  quotaRecorder?: (ip: string, bytes: number) => void;
}
