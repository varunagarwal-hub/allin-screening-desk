import {
  pgTable,
  pgEnum,
  serial,
  integer,
  text,
  varchar,
  boolean,
  timestamp,
  jsonb,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------- enums ----------
export const appStatus = pgEnum("app_status", [
  "uploaded",
  "extracting",
  "extracted",
  "checked",
  "researching",
  "researched",
  "founder_filed",
  "scored",
  "decided",
  "failed",
]);
export const claimStatus = pgEnum("claim_status", ["verified", "contradicted", "unverifiable", "not_found"]);
export const recommendationEnum = pgEnum("recommendation", ["take_call", "hold", "pass"]);
export const severityEnum = pgEnum("severity", ["info", "low", "medium", "high", "critical"]);
export const decisionKind = pgEnum("decision_kind", ["accept", "override"]);
export const noteStatus = pgEnum("note_status", ["proposed", "approved", "rejected"]);
export const messageType = pgEnum("message_type", ["invite", "deeptech_invite", "pass_note", "scheduling_reply", "escalation_reply"]);
export const threadState = pgEnum("thread_state", ["draft", "awaiting_reply", "booked", "escalated", "paused", "closed"]);
export const direction = pgEnum("direction", ["outbound", "inbound"]);
export const holdStatus = pgEnum("hold_status", ["held", "released", "booked", "expired"]);
export const stepStatus = pgEnum("step_status", ["pending", "running", "ok", "failed"]);

const ts = () => timestamp({ withTimezone: true }).defaultNow().notNull();

// ---------- intake ----------
/** Uploaded PDFs (Vercel has no persistent disk). base64 + extracted text for the Groq fallback. */
export const files = pgTable("files", {
  id: serial().primaryKey(),
  name: text().notNull(),
  sha: varchar({ length: 64 }).notNull().unique(),
  sizeBytes: integer().notNull(),
  dataB64: text().notNull(),
  text: text(),
  pages: integer(),
  createdAt: ts(),
});

export const applications = pgTable("applications", {
  id: serial().primaryKey(),
  company: text().notNull(),
  batchId: varchar({ length: 64 }), // groups a week's intake
  formFileId: integer().references(() => files.id),
  deckFileId: integer().references(() => files.id),
  isBacktest: boolean().default(false).notNull(), // Phase 9 pseudo-applications from memos
  backtestText: text(), // stripped memo text for pseudo-applications (no PDFs)
  sector: varchar({ length: 48 }), // normalised: fintech | deeptech | consumer_tech | consumer_brand | saas | other
  businessModel: varchar({ length: 48 }), // lending | consumer_brand | saas | marketplace | deeptech_hardware | other
  isDeeptech: boolean().default(false).notNull(),
  founderEmail: text(),
  status: appStatus().default("uploaded").notNull(),
  lastError: text(),
  createdAt: ts(),
  updatedAt: ts(),
});

// Per-step pipeline status so failures are visible (extract/rules/research/founder/score)
export const pipelineSteps = pgTable(
  "pipeline_steps",
  {
    id: serial().primaryKey(),
    applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
    step: varchar({ length: 32 }).notNull(),
    status: stepStatus().default("pending").notNull(),
    attempts: integer().default(0).notNull(),
    error: text(),
    provider: varchar({ length: 32 }), // gemini | groq | mock
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("pipeline_steps_app_step").on(t.applicationId, t.step)],
);

export const extractions = pgTable("extractions", {
  id: serial().primaryKey(),
  applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
  // Every field = { value, source: {file:'form'|'deck', page} | null }
  data: jsonb().notNull(),
  conflicts: jsonb().default([]).notNull(), // form-vs-deck conflicts
  sectorMislabel: jsonb(), // { selected, likely, reason }
  model: varchar({ length: 64 }),
  createdAt: ts(),
});

// ---------- research + claims ----------
export const claims = pgTable(
  "claims",
  {
    id: serial().primaryKey(),
    applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
    runId: varchar({ length: 64 }).notNull(), // research run; sources must be retrieved in THIS run
    category: varchar({ length: 32 }), // traction | market | partnership | competition | team | identity | regulation | funding
    text: text().notNull(),
    claimOrigin: varchar({ length: 16 }), // form | deck | research
    sourceUrl: text(),
    sourceFile: varchar({ length: 16 }), // form | deck
    sourcePage: integer(),
    excerpt: varchar({ length: 300 }),
    sourceTier: integer(), // 1 regulator/company/filing, 2 press, 3 blog/aggregator, 4 forum
    fetchedAt: timestamp({ withTimezone: true }),
    status: claimStatus().notNull(),
    confidence: real(),
    createdAt: ts(),
  },
  (t) => [index("claims_app").on(t.applicationId)],
);

// Every URL actually retrieved during a run — used by the "0 fabricated sources" check
export const retrievedSources = pgTable(
  "retrieved_sources",
  {
    id: serial().primaryKey(),
    runId: varchar({ length: 64 }).notNull(),
    applicationId: integer().references(() => applications.id, { onDelete: "cascade" }),
    url: text().notNull(),
    via: varchar({ length: 16 }).notNull(), // tavily | rss | jina
    title: text(),
    snippet: text(),
    fetchedAt: ts(),
  },
  (t) => [index("retrieved_run").on(t.runId)],
);

/** One research run per application: sections, competitors found, could-not-find list. */
export const researchReports = pgTable("research_reports", {
  id: serial().primaryKey(),
  applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
  runId: varchar({ length: 64 }).notNull(),
  report: jsonb().notNull(),
  tavilyCalls: integer().default(0).notNull(),
  createdAt: ts(),
});

export const checks = pgTable("checks", {
  id: serial().primaryKey(),
  applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
  code: varchar({ length: 48 }).notNull(), // stage_cheque | portfolio_conflict | outside_thesis | missing_numbers | source | deeptech_routing | form_deck_conflict | sector_mislabel
  severity: severityEnum().notNull(),
  reason: text().notNull(),
  details: jsonb(),
  createdAt: ts(),
});

export const founderFiles = pgTable("founder_files", {
  id: serial().primaryKey(),
  applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
  version: integer().default(1).notNull(), // bumps after call notes
  signals: jsonb().notNull(), // [{signal, kind: rewarded|penalised, state: present|absent|unknown, evidence, source, callOnly}]
  founderMarketFit: text(),
  redFlags: jsonb().default([]).notNull(),
  confidence: real(),
  callQuestions: jsonb().default([]).notNull(),
  calibrationMemos: jsonb(), // which memos used as calibration
  createdAt: ts(),
});

// ---------- scoring ----------
export const scores = pgTable("scores", {
  id: serial().primaryKey(),
  applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
  scoreRunId: varchar({ length: 64 }).notNull(),
  criterion: varchar({ length: 48 }).notNull(), // thesis_fit | stage_cheque_fit | founder_quality | path_to_market | traction_quality | market_competition | risk_ownership
  score: integer().notNull(), // 1–5
  confidence: real(),
  thesisBasis: varchar({ length: 16 }).notNull(), // written | revealed | both
  evidence: jsonb().default([]).notNull(), // [{claimId, sourceUrl|file+page, note}]
  missing: jsonb().default([]).notNull(), // [{item, penalty}]
  memoryInfluence: jsonb(), // which decision_memory / calibration_notes influenced this
  createdAt: ts(),
});

export const recommendations = pgTable("recommendations", {
  id: serial().primaryKey(),
  applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
  scoreRunId: varchar({ length: 64 }).notNull(),
  recommendation: recommendationEnum().notNull(),
  drivenBy: varchar({ length: 16 }).notNull(), // written | revealed thesis
  drivenByWhy: text(),
  partnerSummary: text().notNull(), // two lines, Riya's style
  whatWouldChange: text(),
  callQuestions: jsonb().default([]).notNull(),
  fewShotMemos: jsonb(),
  memoryUsed: jsonb(),
  isWarm: boolean().default(false).notNull(), // run with memory (Loop proof)
  createdAt: ts(),
});

// ---------- Loop 1 ----------
export const decisions = pgTable("decisions", {
  id: serial().primaryKey(),
  applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
  recommendationId: integer().references(() => recommendations.id),
  kind: decisionKind().notNull(),
  finalCall: recommendationEnum().notNull(),
  criterionChanges: jsonb().default([]).notNull(), // [{criterion, old, new}]
  reason: text(), // required for override (enforced in app)
  decidedBy: varchar({ length: 32 }).notNull(), // kushal | riya | aditya
  source: varchar({ length: 16 }).default("review").notNull(), // review | call_notes
  createdAt: ts(),
});

export const decisionMemory = pgTable("decision_memory", {
  id: serial().primaryKey(),
  decisionId: integer().references(() => decisions.id, { onDelete: "cascade" }).notNull(),
  sector: varchar({ length: 48 }),
  businessModel: varchar({ length: 48 }),
  stage: varchar({ length: 32 }),
  criteria: jsonb().default([]).notNull(), // criteria changed
  bizTypes: jsonb().default([]).notNull(), // multi-label business types from the rule checker: lending | consumer_brand | saas | deeptech | other
  isAgreement: boolean().default(false).notNull(),
  lesson: text().notNull(), // reusable one-liner
  embedding: jsonb(), // number[]
  createdAt: ts(),
});

export const calibrationNotes = pgTable("calibration_notes", {
  id: serial().primaryKey(),
  pattern: text().notNull(),
  note: text().notNull(),
  scope: jsonb(), // {sector?, businessModel?, criterion?}
  basedOnDecisionIds: jsonb().default([]).notNull(),
  status: noteStatus().default("proposed").notNull(),
  reviewedBy: varchar({ length: 32 }),
  reviewedAt: timestamp({ withTimezone: true }),
  createdAt: ts(),
});

export const callNotes = pgTable("call_notes", {
  id: serial().primaryKey(),
  applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
  author: varchar({ length: 32 }).notNull(),
  notes: text().notNull(),
  resultingChanges: jsonb(),
  createdAt: ts(),
});

// ---------- Loop 2 ----------
export const drafts = pgTable("drafts", {
  id: serial().primaryKey(),
  applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
  threadId: integer(),
  messageType: messageType().notNull(),
  subject: text(),
  draft: text().notNull(),
  final: text(),
  editDistance: integer(),
  editTypes: jsonb(), // [tone|length|specificity_of_reason|factual_fix]
  approvedBy: varchar({ length: 32 }),
  approvedAt: timestamp({ withTimezone: true }),
  sentAt: timestamp({ withTimezone: true }),
  createdAt: ts(),
});

export const draftMemory = pgTable("draft_memory", {
  id: serial().primaryKey(),
  draftId: integer().references(() => drafts.id, { onDelete: "cascade" }).notNull(),
  messageType: messageType().notNull(),
  draft: text().notNull(),
  final: text().notNull(),
  editTypes: jsonb(),
  createdAt: ts(),
});

// ---------- email + calendar ----------
export const emailThreads = pgTable("email_threads", {
  id: serial().primaryKey(),
  applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
  gmailThreadId: varchar({ length: 128 }),
  founderEmail: text(),
  isDeeptech: boolean().default(false).notNull(),
  state: threadState().default("draft").notNull(),
  round: integer().default(0).notNull(),
  isMock: boolean().default(false).notNull(),
  createdAt: ts(),
  updatedAt: ts(),
});

export const emailMessages = pgTable(
  "email_messages",
  {
    id: serial().primaryKey(),
    threadId: integer().references(() => emailThreads.id, { onDelete: "cascade" }).notNull(),
    gmailMessageId: varchar({ length: 128 }).notNull(),
    direction: direction().notNull(),
    fromAddr: text(),
    toAddr: text(),
    subject: text(),
    body: text(),
    processed: boolean().default(false).notNull(),
    parsedIntent: jsonb(), // {intent, slotIndex?, proposedTime?, timezone?}
    actionTaken: text(),
    sentAt: timestamp({ withTimezone: true }),
    createdAt: ts(),
  },
  (t) => [uniqueIndex("email_messages_gmail_id").on(t.gmailMessageId)],
);

export const slotHolds = pgTable(
  "slot_holds",
  {
    id: serial().primaryKey(),
    threadId: integer().references(() => emailThreads.id, { onDelete: "cascade" }),
    applicationId: integer().references(() => applications.id, { onDelete: "cascade" }),
    start: timestamp({ withTimezone: true }).notNull(),
    end: timestamp({ withTimezone: true }).notNull(),
    calendarEventIds: jsonb().default({}).notNull(), // {kushal: id, aditya?: id}
    status: holdStatus().default("held").notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: ts(),
  },
  (t) => [
    index("slot_holds_start").on(t.start),
    // the same slot can never be held or booked for two founders at once (DB-level double-booking guard)
    uniqueIndex("slot_holds_active_start").on(t.start).where(sql`status in ('held','booked')`),
  ],
);

/** Small key/value settings (e.g. auto-handle scheduling replies toggle). */
export const appSettings = pgTable("app_settings", {
  key: varchar({ length: 64 }).primaryKey(),
  value: jsonb().notNull(),
  updatedAt: ts(),
});

export const meetings = pgTable("meetings", {
  id: serial().primaryKey(),
  applicationId: integer().references(() => applications.id, { onDelete: "cascade" }).notNull(),
  threadId: integer().references(() => emailThreads.id),
  start: timestamp({ withTimezone: true }).notNull(),
  end: timestamp({ withTimezone: true }).notNull(),
  calendarEventId: varchar({ length: 256 }),
  meetLink: text(),
  attendees: jsonb().default([]).notNull(),
  isMock: boolean().default(false).notNull(),
  createdAt: ts(),
});

// Mock mailbox / calendar used when Google creds are missing (same interfaces)
export const mockMail = pgTable("mock_mail", {
  id: serial().primaryKey(),
  messageId: varchar({ length: 128 }).notNull().unique(),
  threadId: varchar({ length: 128 }).notNull(),
  fromAddr: text().notNull(),
  toAddr: text().notNull(),
  subject: text(),
  body: text().notNull(),
  labels: jsonb().default([]).notNull(),
  createdAt: ts(),
});

export const mockCalendarEvents = pgTable("mock_calendar_events", {
  id: serial().primaryKey(),
  eventId: varchar({ length: 128 }).notNull().unique(),
  calendarId: varchar({ length: 256 }).notNull(),
  summary: text(),
  start: timestamp({ withTimezone: true }).notNull(),
  end: timestamp({ withTimezone: true }).notNull(),
  attendees: jsonb().default([]).notNull(),
  meetLink: text(),
  status: varchar({ length: 16 }).default("confirmed").notNull(), // confirmed | tentative | cancelled
  createdAt: ts(),
});

// ---------- evals ----------
export const evalRuns = pgTable("eval_runs", {
  id: serial().primaryKey(),
  kind: varchar({ length: 32 }).notNull(), // backtest | stability | email_intent | loop_proof
  label: text(),
  thresholds: jsonb(), // snapshot of pre-registered thresholds
  results: jsonb(),
  passed: boolean(),
  startedAt: ts(),
  finishedAt: timestamp({ withTimezone: true }),
});

// ---------- infra ----------
export const cache = pgTable("cache", {
  key: varchar({ length: 64 }).primaryKey(), // sha256 of namespace + input
  namespace: varchar({ length: 48 }).notNull(), // llm:gemini | tavily | rss | jina | embed
  value: jsonb().notNull(),
  createdAt: ts(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial().primaryKey(),
    actor: varchar({ length: 32 }).notNull(), // system | agent | riya | kushal | aditya | cron
    action: varchar({ length: 64 }).notNull(),
    applicationId: integer(),
    details: jsonb(),
    createdAt: ts(),
  },
  (t) => [index("audit_app").on(t.applicationId)],
);
