CREATE TABLE "nav_hazards" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"mmsi" text,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"label" text NOT NULL,
	"radius_nm" double precision,
	"observed_at" timestamp with time zone NOT NULL
);
