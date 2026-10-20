export class MaterialRecognitionRequestError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
    this.name = 'MaterialRecognitionRequestError';
  }
}
