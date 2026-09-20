CREATE TYPE "public"."closed_ipo_resourcing_cause_class" AS ENUM('DOCUMENT_UNOBTAINABLE', 'EXTRACTOR_MISSING', 'VALIDATION_REJECTED', 'SOURCE_UNREACHABLE', 'WRITE_SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."closed_ipo_resourcing_outcome" AS ENUM('DONE', 'PARTIAL', 'FAILED');--> statement-breakpoint
CREATE TABLE "closed_ipo_resourcing" (
	"ipo_id" uuid PRIMARY KEY NOT NULL,
	"first_attempt_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"outcome" "closed_ipo_resourcing_outcome" NOT NULL,
	"cause_class" "closed_ipo_resourcing_cause_class",
	"cause_detail" text,
	"fields_written" integer DEFAULT 0 NOT NULL,
	"fields_left_empty" integer DEFAULT 0 NOT NULL,
	"resourced_at_version" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "closed_ipo_resourcing" ADD CONSTRAINT "closed_ipo_resourcing_ipo_id_ipos_id_fk" FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_closed_ipo_resourcing_outcome" ON "closed_ipo_resourcing" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "idx_closed_ipo_resourcing_cause_class" ON "closed_ipo_resourcing" USING btree ("cause_class");--> statement-breakpoint
CREATE INDEX "idx_closed_ipo_resourcing_last_attempt" ON "closed_ipo_resourcing" USING btree ("last_attempt_at");