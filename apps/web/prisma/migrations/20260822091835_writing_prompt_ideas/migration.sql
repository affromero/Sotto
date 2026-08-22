-- AlterTable
ALTER TABLE "WritingPrompt" ADD COLUMN     "ideas" TEXT[] DEFAULT ARRAY[]::TEXT[];
