-- The local access initializer converts configuration and encrypted credentials
-- inside one Serializable transaction, verifies their canonical records, and then
-- drops the replaced tables. Prisma must leave them available until that conversion.
SELECT 1;
