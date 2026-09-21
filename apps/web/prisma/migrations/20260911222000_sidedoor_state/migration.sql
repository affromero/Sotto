CREATE TABLE "SidedoorState" (
    "id" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    CONSTRAINT "SidedoorState_pkey" PRIMARY KEY ("id")
);
