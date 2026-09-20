import { infra } from '../../server-config';
import { isValidSttProviderId, type SttProviderId } from '../stt-registry';

export function getConfiguredSttProviderId(): SttProviderId {
  const raw = (infra('sttProvider') ?? '').trim();
  return isValidSttProviderId(raw) ? raw : 'openai';
}
