import { ZodError } from 'zod';
import { errorResponse } from '../api-response';
import { logger } from '../logger';
import {
  VocabularyStudyConflict,
  VocabularyStudyNotFound,
  VocabularyStudyUnavailable,
} from './study-state';

export function vocabularyErrorResponse(error: unknown) {
  if (error instanceof ZodError) return errorResponse('Invalid vocabulary request.', 400);
  if (error instanceof VocabularyStudyNotFound) return errorResponse(error.message, 404);
  if (error instanceof VocabularyStudyConflict) return errorResponse(error.message, 409);
  if (error instanceof VocabularyStudyUnavailable) return errorResponse(error.message, 422);
  logger.error('Vocabulary request failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return errorResponse('Vocabulary could not be loaded. Try again.', 500);
}
