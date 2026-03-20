import { prisma } from './prisma';
import { logger } from './logger';

export interface SiteConfigData {
  openSignup: boolean;
}

const DEFAULTS: SiteConfigData = {
  openSignup: false,
};

export async function getSiteConfig(): Promise<SiteConfigData> {
  try {
    const row = await prisma.siteConfig.findUnique({
      where: { id: 'singleton' },
    });
    if (!row) return DEFAULTS;
    return { openSignup: row.openSignup };
  } catch (err) {
    logger.warn('Failed to read site config', {
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULTS;
  }
}

export async function setSiteConfig(
  data: Partial<SiteConfigData>,
  adminId: string
): Promise<void> {
  await prisma.siteConfig.upsert({
    where: { id: 'singleton' },
    update: {
      ...(data.openSignup !== undefined && { openSignup: data.openSignup }),
      updatedBy: adminId,
    },
    create: {
      id: 'singleton',
      openSignup: data.openSignup ?? DEFAULTS.openSignup,
      updatedBy: adminId,
    },
  });
}

export async function isOpenSignup(): Promise<boolean> {
  const config = await getSiteConfig();
  return config.openSignup;
}
