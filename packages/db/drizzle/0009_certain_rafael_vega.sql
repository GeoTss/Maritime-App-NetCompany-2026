ALTER TABLE "vessels" ALTER COLUMN "lightship_mt" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "voyages" ALTER COLUMN "cargo_mt" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "voyages" ALTER COLUMN "ballast_mt" DROP DEFAULT;