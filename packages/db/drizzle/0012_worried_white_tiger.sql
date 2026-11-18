CREATE TABLE "nautical_items" (
	"item_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"edition" text NOT NULL,
	"edition_date" text NOT NULL,
	"price_usd" double precision NOT NULL,
	"coverage" jsonb NOT NULL,
	"source" text NOT NULL
);
