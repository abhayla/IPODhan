ALTER TABLE "ipos" ADD COLUMN "hidden_at" timestamp;--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN "hidden_by" varchar(100);--> statement-breakpoint
ALTER TABLE "ipos" ADD COLUMN "hidden_by_admin_id" uuid;--> statement-breakpoint
-- §9.2 item 23 (OD-116/OD-118): a hidden IPO row receives no scraper data from ANY writer, however
-- it found the row (identity, dates, name, id) and in any language (TS repositories, Python
-- scripts, raw SQL). The app-level guards (identity IpoHiddenError, the field-plan claim filter,
-- FieldProtectionService.isIPOLocked) skip the row with a log line; this trigger is the backstop
-- that refuses the write when a writer never asked. Admin-sourced field_sources rows pass.
CREATE OR REPLACE FUNCTION refuse_write_to_hidden_ipo() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  hidden_slug text;
BEGIN
  IF NEW.ipo_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'field_sources' THEN
    IF NEW.source::text = 'ADMIN' THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT slug INTO hidden_slug FROM ipos WHERE id = NEW.ipo_id AND hidden_at IS NOT NULL;
  IF FOUND THEN
    RAISE EXCEPTION 'ipo_hidden: % on % refused for hidden IPO id=% slug=%', TG_OP, TG_TABLE_NAME, NEW.ipo_id, hidden_slug
      USING ERRCODE = 'IH001';
  END IF;
  RETURN NEW;
END
$fn$;--> statement-breakpoint
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'gmp_records', 'subscriptions', 'ipo_demand_graph', 'documents', 'document_fetch_state',
    'financial_data', 'ipo_financials', 'financial_statements', 'anchor_investors',
    'listing_performance', 'peer_companies', 'promoters', 'promoter_acquisition_ranges',
    'ipo_intermediaries', 'ipo_risk_factors', 'ipo_valuation', 'ipo_details', 'brlm_track_record',
    'extraction_logs', 'field_extraction_failures', 'field_sources'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS refuse_write_to_hidden_ipo ON %I', t);
    EXECUTE format('CREATE TRIGGER refuse_write_to_hidden_ipo BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION refuse_write_to_hidden_ipo()', t);
  END LOOP;
  -- data_conflicts: new conflicts are refused; the admin still resolves (UPDATEs) existing ones.
  DROP TRIGGER IF EXISTS refuse_write_to_hidden_ipo ON data_conflicts;
  CREATE TRIGGER refuse_write_to_hidden_ipo BEFORE INSERT ON data_conflicts FOR EACH ROW EXECUTE FUNCTION refuse_write_to_hidden_ipo();
END
$do$;
