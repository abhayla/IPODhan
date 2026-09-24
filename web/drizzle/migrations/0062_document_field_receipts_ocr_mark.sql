-- Item 22 (spec §2.2.1 OD-36 "Image-only pages go to OCR, marked", OD-97), migration 0062:
-- where one document read each receipted value (TEXT / OCR / MIXED) and the OCR page confidence.
-- Hand-trimmed from drizzle-kit's output to this migration's statements only; nullable, so every
-- receipt written before this change reads as unknown.
ALTER TABLE "document_field_receipts" ADD COLUMN IF NOT EXISTS "source_text" varchar(8);--> statement-breakpoint
ALTER TABLE "document_field_receipts" ADD COLUMN IF NOT EXISTS "ocr_confidence" numeric(5, 4);
