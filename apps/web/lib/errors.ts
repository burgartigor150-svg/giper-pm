export type DomainErrorCode =
  | 'UNAUTHENTICATED'
  | 'INSUFFICIENT_PERMISSIONS'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'TRANSITION_NOT_ALLOWED'
  | 'INTERNAL';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly status: number;

  constructor(code: DomainErrorCode, status: number, message?: string) {
    super(message ?? code);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}
