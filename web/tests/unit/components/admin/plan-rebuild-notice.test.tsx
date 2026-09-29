/**
 * §9.2 item 18 / §2.8: the editor says a save of offering type, segment or listing exchanges rebuilds
 * the IPO's source plan BEFORE the save; other fields carry no such notice.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { FieldEditor } from '@/components/admin/ipo-editor/IpoPageEditor';
import { editorFieldCatalog, PLAN_REBUILD_NOTICE } from '@/lib/admin/ipo-editor-fields';
import type { EditorField } from '@/lib/admin/ipo-editor-data';

function field(key: string): EditorField {
  const spec = editorFieldCatalog('MAINBOARD').find((f) => f.key === key);
  if (!spec) throw new Error(`no editor field ${key}`);
  return {
    ...spec,
    fieldName: spec.column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
    rowKey: '',
    currentValue: 'FPO',
    version: 'v1',
    setBy: 'NSE',
    setAt: null,
    currentSource: 'NSE',
    admin: null,
    witnesses: [],
    e1Rule: null,
    planRebuildNotice: spec.planRebuild ? PLAN_REBUILD_NOTICE : null,
    notApplicable: false,
  } as EditorField;
}

describe('plan-rebuild notice (item 18)', () => {
  it.each(['ipos.offering_type', 'ipos.segment', 'ipos.listing_exchanges'])('%s is editable and shows the notice before any save', (key) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const f = field(key);
    expect(f.mode).not.toBe('readonly');
    render(<FieldEditor ipoId="ipo-1" field={f} onSaved={() => {}} />);
    expect(screen.getByTestId('plan-rebuild-notice').textContent).toContain("rebuilds this IPO's source plan");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('a field that does not change the plan carries no notice', () => {
    render(<FieldEditor ipoId="ipo-1" field={field('ipos.registrar')} onSaved={() => {}} />);
    expect(screen.queryByTestId('plan-rebuild-notice')).toBeNull();
  });
});
