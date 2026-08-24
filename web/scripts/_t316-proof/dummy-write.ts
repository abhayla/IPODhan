// T-316 fail-then-green proof fixture — will be reverted in the next commit.
import { db } from '@/lib/db';
import { ipos } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';

export async function dummyDirectWrite(id: string) {
  return db.update(ipos).set({ companyName: 'proof' }).where(eq(ipos.id, id));
}
