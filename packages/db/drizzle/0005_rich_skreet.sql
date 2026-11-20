CREATE TABLE "source_status" (
	"source" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"detail" text,
	"updated_at" timestamp with time zone NOT NULL
);
