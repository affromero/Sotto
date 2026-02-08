import { ReferenceType } from '@prisma/client';

export interface ReferenceData {
  id: string;
  number: number;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  type: ReferenceType;
  publisher: string | null;
  doi: string | null;
}
