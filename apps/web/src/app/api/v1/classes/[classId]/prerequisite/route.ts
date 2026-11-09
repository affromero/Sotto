import { NextRequest } from 'next/server';
import {
  preparePrerequisiteHttp,
  readPrerequisiteHttp,
} from '@/lib/classes/help/prerequisite-http';

type Params = { params: Promise<{ classId: string }> };

export function GET(request: NextRequest, params: Params) {
  return readPrerequisiteHttp(request, params);
}

export function POST(request: NextRequest, params: Params) {
  return preparePrerequisiteHttp(request, params);
}
