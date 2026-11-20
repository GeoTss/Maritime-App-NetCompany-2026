ALTER TABLE "ais_traffic" ADD COLUMN "draught_m" double precision;--> statement-breakpoint
ALTER TABLE "ais_traffic" ADD COLUMN "cog_deg" double precision;--> statement-breakpoint
ALTER TABLE "vessels" ADD COLUMN "lightship_mt" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voyages" ADD COLUMN "cargo_mt" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "voyages" ADD COLUMN "ballast_mt" double precision DEFAULT 0 NOT NULL;