import { createSottoCredentialSettingsHandler } from '@/lib/sidedoor/credentials/config/credential-http';

const handler = createSottoCredentialSettingsHandler('ai-keys');
export const GET = handler;
export const POST = handler;
export const DELETE = handler;
