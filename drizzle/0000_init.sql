CREATE TYPE "public"."app_status" AS ENUM('uploaded', 'extracting', 'extracted', 'checked', 'researching', 'researched', 'founder_filed', 'scored', 'decided', 'failed');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('verified', 'contradicted', 'unverifiable', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."decision_kind" AS ENUM('accept', 'override');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."hold_status" AS ENUM('held', 'released', 'booked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('invite', 'deeptech_invite', 'pass_note', 'scheduling_reply', 'escalation_reply');--> statement-breakpoint
CREATE TYPE "public"."note_status" AS ENUM('proposed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."recommendation" AS ENUM('take_call', 'hold', 'pass');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('pending', 'running', 'ok', 'failed');--> statement-breakpoint
CREATE TYPE "public"."thread_state" AS ENUM('draft', 'awaiting_reply', 'booked', 'escalated', 'paused', 'closed');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"batch_id" varchar(64),
	"form_file_id" integer,
	"deck_file_id" integer,
	"is_backtest" boolean DEFAULT false NOT NULL,
	"backtest_text" text,
	"sector" varchar(48),
	"business_model" varchar(48),
	"is_deeptech" boolean DEFAULT false NOT NULL,
	"founder_email" text,
	"status" "app_status" DEFAULT 'uploaded' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor" varchar(32) NOT NULL,
	"action" varchar(64) NOT NULL,
	"application_id" integer,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cache" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"namespace" varchar(48) NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calibration_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern" text NOT NULL,
	"note" text NOT NULL,
	"scope" jsonb,
	"based_on_decision_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "note_status" DEFAULT 'proposed' NOT NULL,
	"reviewed_by" varchar(32),
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"author" varchar(32) NOT NULL,
	"notes" text NOT NULL,
	"resulting_changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"code" varchar(48) NOT NULL,
	"severity" "severity" NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"run_id" varchar(64) NOT NULL,
	"category" varchar(32),
	"text" text NOT NULL,
	"claim_origin" varchar(16),
	"source_url" text,
	"source_file" varchar(16),
	"source_page" integer,
	"excerpt" varchar(300),
	"source_tier" integer,
	"fetched_at" timestamp with time zone,
	"status" "claim_status" NOT NULL,
	"confidence" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"decision_id" integer NOT NULL,
	"sector" varchar(48),
	"business_model" varchar(48),
	"stage" varchar(32),
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_agreement" boolean DEFAULT false NOT NULL,
	"lesson" text NOT NULL,
	"embedding" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"recommendation_id" integer,
	"kind" "decision_kind" NOT NULL,
	"final_call" "recommendation" NOT NULL,
	"criterion_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"decided_by" varchar(32) NOT NULL,
	"source" varchar(16) DEFAULT 'review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"message_type" "message_type" NOT NULL,
	"draft" text NOT NULL,
	"final" text NOT NULL,
	"edit_types" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"thread_id" integer,
	"message_type" "message_type" NOT NULL,
	"subject" text,
	"draft" text NOT NULL,
	"final" text,
	"edit_distance" integer,
	"edit_types" jsonb,
	"approved_by" varchar(32),
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"gmail_message_id" varchar(128) NOT NULL,
	"direction" "direction" NOT NULL,
	"from_addr" text,
	"to_addr" text,
	"subject" text,
	"body" text,
	"processed" boolean DEFAULT false NOT NULL,
	"parsed_intent" jsonb,
	"action_taken" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"gmail_thread_id" varchar(128),
	"founder_email" text,
	"is_deeptech" boolean DEFAULT false NOT NULL,
	"state" "thread_state" DEFAULT 'draft' NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"label" text,
	"thresholds" jsonb,
	"results" jsonb,
	"passed" boolean,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"data" jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sector_mislabel" jsonb,
	"model" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sha" varchar(64) NOT NULL,
	"size_bytes" integer NOT NULL,
	"data_b_64" text NOT NULL,
	"text" text,
	"pages" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_sha_unique" UNIQUE("sha")
);
--> statement-breakpoint
CREATE TABLE "founder_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"signals" jsonb NOT NULL,
	"founder_market_fit" text,
	"red_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real,
	"call_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calibration_memos" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"thread_id" integer,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"calendar_event_id" varchar(256),
	"meet_link" text,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" varchar(128) NOT NULL,
	"calendar_id" varchar(256) NOT NULL,
	"summary" text,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meet_link" text,
	"status" varchar(16) DEFAULT 'confirmed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_calendar_events_eventId_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "mock_mail" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" varchar(128) NOT NULL,
	"thread_id" varchar(128) NOT NULL,
	"from_addr" text NOT NULL,
	"to_addr" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_mail_messageId_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "pipeline_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"step" varchar(32) NOT NULL,
	"status" "step_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"provider" varchar(32),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"score_run_id" varchar(64) NOT NULL,
	"recommendation" "recommendation" NOT NULL,
	"driven_by" varchar(16) NOT NULL,
	"driven_by_why" text,
	"partner_summary" text NOT NULL,
	"what_would_change" text,
	"call_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"few_shot_memos" jsonb,
	"memory_used" jsonb,
	"is_warm" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieved_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" varchar(64) NOT NULL,
	"application_id" integer,
	"url" text NOT NULL,
	"via" varchar(16) NOT NULL,
	"title" text,
	"snippet" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"application_id" integer NOT NULL,
	"score_run_id" varchar(64) NOT NULL,
	"criterion" varchar(48) NOT NULL,
	"score" integer NOT NULL,
	"confidence" real,
	"thesis_basis" varchar(16) NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"memory_influence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slot_holds" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer,
	"application_id" integer,
	"start" timestamp with time zone NOT NULL,
	"end" timestamp with time zone NOT NULL,
	"calendar_event_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "hold_status" DEFAULT 'held' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_form_file_id_files_id_fk" FOREIGN KEY ("form_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_deck_file_id_files_id_fk" FOREIGN KEY ("deck_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_notes" ADD CONSTRAINT "call_notes_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_memory" ADD CONSTRAINT "decision_memory_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_recommendation_id_recommendations_id_fk" FOREIGN KEY ("recommendation_id") REFERENCES "public"."recommendations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_memory" ADD CONSTRAINT "draft_memory_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_files" ADD CONSTRAINT "founder_files_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ADD CONSTRAINT "pipeline_steps_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieved_sources" ADD CONSTRAINT "retrieved_sources_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_thread_id_email_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slot_holds" ADD CONSTRAINT "slot_holds_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_app" ON "audit_log" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "claims_app" ON "claims" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_gmail_id" ON "email_messages" USING btree ("gmail_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_steps_app_step" ON "pipeline_steps" USING btree ("application_id","step");--> statement-breakpoint
CREATE INDEX "retrieved_run" ON "retrieved_sources" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "slot_holds_start" ON "slot_holds" USING btree ("start");