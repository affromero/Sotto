import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    applinks: {
      details: [
        {
          appIDs: ['2HVQQ4W769.fm.sotto.app'],
          components: [{ '/': '/play/join' }],
        },
      ],
    },
  });
}
