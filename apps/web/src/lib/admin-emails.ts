import { readFileSync } from 'fs';
import { join } from 'path';

const adminsPath = join(process.cwd(), '..', '..', 'config', 'admins.json');
const adminEmails: string[] = (() => {
  try {
    const data = JSON.parse(readFileSync(adminsPath, 'utf-8'));
    return (data.admins as string[]).map((e: string) => e.trim().toLowerCase());
  } catch {
    return [];
  }
})();

export function isAdminEmail(email: string): boolean {
  return adminEmails.includes(email.toLowerCase());
}
