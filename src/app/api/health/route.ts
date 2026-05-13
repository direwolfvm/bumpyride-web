import { NextResponse } from 'next/server';
import { pool } from '@/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await pool.query('SELECT 1');
    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    return NextResponse.json(
      { status: 'degraded', error: (err as Error).message },
      { status: 503 },
    );
  }
}
