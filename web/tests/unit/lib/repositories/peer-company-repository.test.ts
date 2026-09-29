/**
 * §9.2 item 8 (OD-107): the web PeerCompanyRepository is read-only. Every admin change to the peer
 * list goes through the ONE list write (writeAdminListChange), which makes the whole list
 * admin-owned; a second writer here would bypass that hold. Re-adding a create/delete/upsert method
 * turns this red.
 */
import { describe, it, expect } from 'vitest';
import { PeerCompanyRepository } from '@/lib/repositories/peer-company-repository';

describe('web PeerCompanyRepository (OD-107)', () => {
  it('exposes no write method: the peer list is written only through writeAdminListChange', () => {
    const methods = Object.getOwnPropertyNames(PeerCompanyRepository.prototype).filter((m) => m !== 'constructor');
    expect(methods.filter((m) => /create|insert|update|upsert|delete|replace|write/i.test(m))).toEqual([]);
    expect(methods).toContain('findByIPO');
  });
});
