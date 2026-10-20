export class PlayRuleError extends Error {
  constructor(
    readonly code: 'forbidden' | 'conflict' | 'invalid',
    message: string
  ) {
    super(message);
    this.name = 'PlayRuleError';
  }
}
