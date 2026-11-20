ALTER TABLE "voyage_instructions" ADD COLUMN "stop_port_id" integer;--> statement-breakpoint
ALTER TABLE "voyage_instructions" ADD COLUMN "stop_quote_id" integer;--> statement-breakpoint
ALTER TABLE "voyage_instructions" ADD COLUMN "stop_arrive_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voyage_instructions" ADD COLUMN "stop_depart_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "voyage_instructions" ADD COLUMN "stop_qty_mt" double precision;--> statement-breakpoint
ALTER TABLE "voyage_instructions" ADD CONSTRAINT "voyage_instructions_stop_port_id_ports_id_fk" FOREIGN KEY ("stop_port_id") REFERENCES "public"."ports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyage_instructions" ADD CONSTRAINT "voyage_instructions_stop_quote_id_quotes_id_fk" FOREIGN KEY ("stop_quote_id") REFERENCES "public"."quotes"("id") ON DELETE restrict ON UPDATE no action;