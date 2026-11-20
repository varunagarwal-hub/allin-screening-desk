CREATE TABLE "research_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"run_id" varchar(64) NOT NULL,
	"report" jsonb NOT NULL,
	"tavily_calls" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "research_reports" ADD CONSTRAINT "research_reports_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;