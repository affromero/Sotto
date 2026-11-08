import { builtinEnvironments, type Environment } from 'vitest/runtime';
import { createPrivateRedis } from './private-redis';

export default {
  name: 'private-redis',
  viteEnvironment: 'ssr',
  async setup(global, options) {
    const node = await builtinEnvironments.node.setup(global, options);
    const previousUrl = process.env.REDIS_URL;
    const previousPrivateUrl = process.env.SOTTO_TEST_PRIVATE_REDIS_URL;
    const restore = () => {
      if (previousUrl === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = previousUrl;
      if (previousPrivateUrl === undefined) delete process.env.SOTTO_TEST_PRIVATE_REDIS_URL;
      else process.env.SOTTO_TEST_PRIVATE_REDIS_URL = previousPrivateUrl;
    };
    delete process.env.SOTTO_TEST_PRIVATE_REDIS_URL;
    if (!process.env.SIDEDOOR_TEST_DATABASE_URL) {
      return {
        async teardown(environmentGlobal) {
          restore();
          await node.teardown(environmentGlobal);
        },
      };
    }
    let redis: Awaited<ReturnType<typeof createPrivateRedis>> | undefined;
    try {
      redis = await createPrivateRedis();
      const started = redis;
      process.env.REDIS_URL = redis.url;
      process.env.SOTTO_TEST_PRIVATE_REDIS_URL = redis.url;
      return {
        async teardown(environmentGlobal) {
          try {
            await started.close();
          } finally {
            restore();
            await node.teardown(environmentGlobal);
          }
        },
      };
    } catch (error) {
      try {
        await redis?.close();
      } finally {
        restore();
        await node.teardown(global);
      }
      throw error;
    }
  },
} satisfies Environment;
