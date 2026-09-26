/**
 * Test-only in-memory Redis backend for REAL ioredis clients.
 *
 * ioredis applies `keyPrefix` when it builds a Command (Command.js), before
 * `sendCommand` runs. Replacing `sendCommand` on a real client therefore
 * exercises the real prefixing and the real KEYS/SCAN patching, while one
 * shared Map stands in for the single Redis both slots share on the VPS.
 * Covers only the commands the slot-namespace tests drive.
 */

import type Redis from 'ioredis';

interface Entry {
  value: string;
  expiresAt?: number;
}

type RawCommand = {
  name: string;
  args: unknown[];
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  promise: Promise<unknown>;
};

function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (const ch of pattern) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export class InMemoryRedisBackend {
  readonly store = new Map<string, Entry>();
  readonly log: Array<{ name: string; args: string[] }> = [];

  private live(key: string): Entry | undefined {
    const e = this.store.get(key);
    if (e?.expiresAt !== undefined && e.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e;
  }

  execute(name: string, args: string[]): unknown {
    this.log.push({ name, args });
    switch (name) {
      case 'get':
        return this.live(args[0])?.value ?? null;
      case 'set': {
        const [key, value, ...opts] = args;
        const upper = opts.map((o) => o.toUpperCase());
        if (upper.includes('NX') && this.live(key)) return null;
        const px = upper.indexOf('PX');
        const ex = upper.indexOf('EX');
        const expiresAt =
          px >= 0 ? Date.now() + Number(opts[px + 1]) : ex >= 0 ? Date.now() + Number(opts[ex + 1]) * 1000 : undefined;
        this.store.set(key, { value, expiresAt });
        return 'OK';
      }
      case 'setex':
        this.store.set(args[0], { value: args[2], expiresAt: Date.now() + Number(args[1]) * 1000 });
        return 'OK';
      case 'del':
        return args.reduce((n, k) => (this.store.delete(k) ? n + 1 : n), 0);
      case 'exists':
        return args.filter((k) => this.live(k)).length;
      case 'keys': {
        const re = globToRegExp(args[0]);
        return [...this.store.keys()].filter((k) => this.live(k) && re.test(k));
      }
      case 'scan': {
        const upper = args.map((a) => a.toUpperCase());
        const m = upper.indexOf('MATCH');
        const re = globToRegExp(m >= 0 ? args[m + 1] : '*');
        return ['0', [...this.store.keys()].filter((k) => this.live(k) && re.test(k))];
      }
      case 'eval': {
        // Only the DistributedLock compare-and-delete / compare-and-pexpire scripts.
        const [script, , key, token, extra] = args;
        const current = this.live(key);
        if (!current || current.value !== token) return 0;
        if (script.includes('"del"') || script.includes("'del'")) {
          this.store.delete(key);
          return 1;
        }
        if (script.includes('pexpire')) {
          current.expiresAt = Date.now() + Number(extra);
          return 1;
        }
        throw new Error('InMemoryRedisBackend: unsupported EVAL script');
      }
      case 'pttl':
      case 'ttl': {
        const e = this.live(args[0]);
        if (!e) return -2;
        if (e.expiresAt === undefined) return -1;
        const ms = e.expiresAt - Date.now();
        return name === 'pttl' ? ms : Math.ceil(ms / 1000);
      }
      case 'quit':
        return 'OK';
      default:
        throw new Error(`InMemoryRedisBackend: unsupported command ${name}`);
    }
  }

  /** Route a real ioredis client's commands to this backend (no socket is ever opened). */
  attach<T extends Redis>(client: T): T {
    (client as unknown as { sendCommand: (cmd: RawCommand) => Promise<unknown> }).sendCommand = (
      cmd: RawCommand
    ) => {
      try {
        cmd.resolve(this.execute(cmd.name, cmd.args.map((a) => String(a))));
      } catch (err) {
        cmd.reject(err as Error);
      }
      return cmd.promise;
    };
    return client;
  }
}
