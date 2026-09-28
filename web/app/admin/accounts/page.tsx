'use client';

/**
 * Owner-only admin accounts (spec §9.2 item 6; OD-113, OD-114): list, add, remove, reset password.
 * The API enforces owner-only; this page only hides itself from non-owners.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAdminAuth } from '@/lib/context/AdminAuthContext';
import { formatIPODate } from '@/lib/utils/date-formatter';

interface AccountRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  telegramId: string | null;
  isOwner: boolean;
  disabledAt: string | null;
  createdAt: string;
}

const EMPTY_FORM = { name: '', email: '', phone: '', telegramId: '', password: '' };

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Request failed (${res.status})`);
  return body;
}

export default function AdminAccountsPage() {
  const { admin } = useAdminAuth();
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const body = await call('/api/admin/accounts');
      setAccounts(body.data ?? []);
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Could not load accounts' });
    }
  }, []);

  useEffect(() => {
    if (admin?.isOwner) load();
  }, [admin, load]);

  if (!admin?.isOwner) {
    return <p className="text-gray-300">Only the owner manages admin accounts.</p>;
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await call('/api/admin/accounts', {
        method: 'POST',
        body: JSON.stringify({ ...form, telegramId: form.telegramId || null }),
      });
      setForm(EMPTY_FORM);
      setMessage({ kind: 'ok', text: 'Admin added' });
      await load();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not add admin' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: AccountRow) => {
    if (!window.confirm(`Remove ${row.name}? They lose access at once; their past edits stay attributed to them.`)) return;
    try {
      await call(`/api/admin/accounts/${row.id}`, { method: 'DELETE' });
      setMessage({ kind: 'ok', text: `${row.name} removed` });
      await load();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not remove admin' });
    }
  };

  const reset = async (row: AccountRow) => {
    const password = window.prompt(`New password for ${row.name} (at least 12 characters):`);
    if (!password) return;
    try {
      await call(`/api/admin/accounts/${row.id}/password`, { method: 'POST', body: JSON.stringify({ password }) });
      setMessage({ kind: 'ok', text: `Password reset for ${row.name}; their other sessions were signed out` });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not reset password' });
    }
  };

  const input =
    'w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">Admin accounts</h1>

      {message && (
        <div
          role="status"
          className={`px-4 py-3 rounded-md text-sm ${message.kind === 'ok' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}
        >
          {message.text}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-gray-300">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Phone</th>
              <th className="py-2 pr-4">Telegram</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((row) => (
              <tr key={row.id} className="border-t border-gray-700">
                <td className="py-2 pr-4">{row.name}{row.isOwner ? ' (owner)' : ''}</td>
                <td className="py-2 pr-4">{row.email}</td>
                <td className="py-2 pr-4">{row.phone}</td>
                <td className="py-2 pr-4">{row.telegramId ?? '-'}</td>
                <td className="py-2 pr-4">
                  {row.disabledAt ? `Removed ${formatIPODate(row.disabledAt)}` : 'Active'}
                </td>
                <td className="py-2 pr-4 space-x-2 whitespace-nowrap">
                  {!row.disabledAt && (
                    <button onClick={() => reset(row)} className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded">
                      Reset password
                    </button>
                  )}
                  {!row.isOwner && !row.disabledAt && (
                    <button onClick={() => remove(row)} className="px-2 py-1 bg-red-700 hover:bg-red-600 rounded text-white">
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={add} className="max-w-xl space-y-3 bg-gray-800 p-4 rounded-lg border border-gray-700">
        <h2 className="text-lg font-semibold text-white">Add an admin</h2>
        <input className={input} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} />
        <input className={input} type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input className={input} type="tel" placeholder="Phone (+91...)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
        <input className={input} placeholder="Telegram ID (optional)" value={form.telegramId} onChange={(e) => setForm({ ...form, telegramId: e.target.value })} />
        <input className={input} type="password" autoComplete="new-password" placeholder="Initial password (12+ characters)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={12} />
        <button type="submit" disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-md">
          {busy ? 'Adding...' : 'Add admin'}
        </button>
      </form>
    </div>
  );
}
