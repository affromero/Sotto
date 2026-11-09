-- Retain unsuccessful repair output without treating it as active material.
ALTER TABLE "ClassSection" ADD COLUMN "withdrawn" BOOLEAN NOT NULL DEFAULT false;
