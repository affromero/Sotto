import { Client } from 'pg';
import { openPostgresDedicatedConnection } from 'thesidedoor-core/storage';

/** Requires direct PostgreSQL or session pooling. Transaction pooling cannot hold session locks. */
export async function openSottoStorageConnection(
  connectionString = process.env.DATABASE_URL,
  schema?: string
) {
  if (!connectionString || !/^postgres(?:ql)?:\/\//.test(connectionString))
    throw new Error('Storage ownership requires a PostgreSQL DATABASE_URL');
  if (schema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(schema))
    throw new Error('Storage ownership schema is invalid');
  const client = new Client({
    connectionString,
    ...(schema ? { options: `-c search_path=${schema},public` } : {}),
    application_name: 'sotto-storage-cleanup',
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
  return openPostgresDedicatedConnection(
    {
      connect: async () => {
        await client.connect();
      },
      query: async (sql, values) =>
        (await client.query<Record<string, unknown>>(sql, [...values])).rows,
      end: () => client.end(),
      onError(listener) {
        client.on('error', listener);
        return () => {
          client.off('error', listener);
        };
      },
      onEnd(listener) {
        client.on('end', listener);
        return () => {
          client.off('end', listener);
        };
      },
    },
    { connectMs: 5_000, queryMs: 5_000, closeMs: 5_000 }
  );
}
