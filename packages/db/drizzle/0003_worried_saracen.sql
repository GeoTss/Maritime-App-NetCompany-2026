ALTER TABLE "documents" ADD COLUMN "has_unreadable_attachment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "claimed_at" timestamp with time zone;