export type ApiErrorKind =
  | "network"
  | "timeout"
  | "auth"
  | "validation"
  | "server"
  | "unknown";

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
}
