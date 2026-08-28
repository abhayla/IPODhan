/**
 * Outbound-call counter for document discovery — T-403.
 *
 * WHY THIS EXISTS. The acceptance criterion for WP B is "run 2, immediately
 * after run 1, makes ZERO network calls for an IPO whose documents are all
 * found". That is a claim about behaviour, and reading the code to convince
 * yourself it holds is exactly the shape-not-substance verification this
 * project keeps getting caught by. So the network layer counts itself, per IPO
 * and per host, and the acceptance run asserts the number.
 *
 * Deliberately a tiny, explicit counter rather than a mocking framework: it
 * works identically in a unit test, in the acceptance harness and in
 * production, so the number in the evidence file is produced by the same code
 * path that runs live.
 */

export interface NetworkCall {
  host: string;
  url: string;
  /** The IPO this call was made on behalf of, when known. */
  ipoKey?: string;
  status: number;
  ms: number;
  bytes: number;
  error?: string;
}

export class NetworkCounter {
  private readonly calls: NetworkCall[] = [];

  record(call: NetworkCall): void {
    this.calls.push(call);
  }

  /** Total calls, or calls made on behalf of one IPO. */
  count(ipoKey?: string): number {
    if (ipoKey === undefined) return this.calls.length;
    return this.calls.filter((c) => c.ipoKey === ipoKey).length;
  }

  byIpo(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.calls) {
      const key = c.ipoKey ?? '(none)';
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }

  byHost(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of this.calls) out[c.host] = (out[c.host] ?? 0) + 1;
    return out;
  }

  all(): readonly NetworkCall[] {
    return this.calls;
  }

  reset(): void {
    this.calls.length = 0;
  }

  /** The shape written to `evidence/T-403/network-calls.json`. */
  toJSON(): {
    total: number;
    byIpo: Record<string, number>;
    byHost: Record<string, number>;
    calls: NetworkCall[];
  } {
    return {
      total: this.count(),
      byIpo: this.byIpo(),
      byHost: this.byHost(),
      calls: [...this.calls],
    };
  }
}

/** Host label for a URL — '(unparseable)' rather than throwing on junk input. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable)';
  }
}
