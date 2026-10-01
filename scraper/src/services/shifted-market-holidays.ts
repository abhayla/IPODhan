/**
 * #1380 / F-220 repair core: finds and deletes the exchange-specific market_holidays rows that are
 * one-day-early copies of another exchange's row. The selection RULE lives in
 * scripts/lib/shifted-holiday-copies.mjs (shared with the nightly check h_market_holiday_shifted_copy);
 * this file only reads rows and runs the one-transaction delete.
 */
import { inArray, sql } from 'drizzle-orm';
import { marketHolidays } from '@ipodhan/shared/db/schema';
import {
  MARKET_HOLIDAY_ROWS_SQL,
  selectShiftedHolidayCopies,
} from '../../../scripts/lib/shifted-holiday-copies.mjs';

export interface HolidayRowText {
  id: string;
  date: string;
  description: string;
  exchange: string;
  type: string;
  year: number;
}

export interface ShiftedHolidayCopy {
  row: HolidayRowText;
  copyOf: HolidayRowText;
  weekday: string;
}

type ExecDb = {
  execute: (q: any) => Promise<any>;
  transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

function rowsOf(result: any): any[] {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

async function readRows(db: { execute: (q: any) => Promise<any> }): Promise<HolidayRowText[]> {
  return rowsOf(await db.execute(sql.raw(MARKET_HOLIDAY_ROWS_SQL))) as HolidayRowText[];
}

export async function findShiftedHolidayCopies(db: { execute: (q: any) => Promise<any> }): Promise<ShiftedHolidayCopy[]> {
  return selectShiftedHolidayCopies(await readRows(db)) as ShiftedHolidayCopy[];
}

/**
 * Deletes exactly the rows the rule selects, in ONE transaction, and re-reads inside it: the deleted
 * count must equal the selected count and the rule must then select nothing, else the transaction is
 * rolled back by throwing.
 */
export async function deleteShiftedHolidayCopies(db: ExecDb): Promise<{ selected: ShiftedHolidayCopy[]; deleted: number }> {
  return db.transaction(async (tx) => {
    const selected = await findShiftedHolidayCopies(tx);
    if (selected.length === 0) return { selected, deleted: 0 };
    const ids = selected.map((s) => s.row.id);
    const result = await tx.delete(marketHolidays).where(inArray(marketHolidays.id, ids)).returning({ id: marketHolidays.id });
    const deleted = result.length;
    if (deleted !== selected.length) {
      throw new Error(`shifted holiday repair: deleted ${deleted} row(s) but selected ${selected.length}; rolling back`);
    }
    const remaining = await findShiftedHolidayCopies(tx);
    if (remaining.length !== 0) {
      throw new Error(`shifted holiday repair: ${remaining.length} shifted row(s) remain after the delete; rolling back`);
    }
    return { selected, deleted };
  });
}
