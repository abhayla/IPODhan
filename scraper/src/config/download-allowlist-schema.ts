import { z } from 'zod';

/**
 * `scraper/config/download-allowlist.json` — the base set of hosts every
 * document download is trusted from (item 22, OD-37). Registrar hosts are
 * layered on top of this at read time (`loadRegistrarDocumentHosts`,
 * company-host-source.ts) because they are DATA (the `registrars` table),
 * not something a static file can enumerate.
 */
export const downloadAllowlistSchema = z
  .object({
    hosts: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type DownloadAllowlist = z.infer<typeof downloadAllowlistSchema>;
