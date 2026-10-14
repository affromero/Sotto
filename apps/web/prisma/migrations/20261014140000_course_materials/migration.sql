CREATE TABLE "CourseMaterial" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "originalUrl" TEXT,
    "extractedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseMaterial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CourseMaterial_userId_courseId_idx" ON "CourseMaterial"("userId", "courseId");
CREATE INDEX "CourseMaterial_courseId_idx" ON "CourseMaterial"("courseId");
ALTER TABLE "CourseMaterial" ADD CONSTRAINT "CourseMaterial_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CourseMaterial" ADD CONSTRAINT "CourseMaterial_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
