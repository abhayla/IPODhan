/**
 * /admin/ipos/new — an admin creates an IPO row by hand (spec §9.2 item 15, OD-111). The offering
 * types come from the schema enum, so the form can never offer a type the database refuses.
 */
import { offeringTypeEnum } from '@ipodhan/shared/db/schema';
import { NewIpoForm } from './new-ipo-form';

export const dynamic = 'force-dynamic';

export default function NewIpoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">New IPO</h1>
        <p className="mt-1 text-gray-400">
          Create an offering the scraper has not found. Give at least one identifier the scraper can
          bind by; the other values are typed in the editor afterwards.
        </p>
      </div>
      <NewIpoForm offeringTypes={offeringTypeEnum.enumValues} />
    </div>
  );
}
