import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDirectory } from "@/server/config";

const globalDb = globalThis as typeof globalThis & { __marketingHubDb?: DatabaseSync };

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS context_documents (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, source_of_truth INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS brand_assets (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, file_name TEXT NOT NULL,
        storage_path TEXT NOT NULL, mime_type TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_runs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, objective TEXT NOT NULL, region TEXT NOT NULL,
        status TEXT NOT NULL, requested_count INTEGER NOT NULL, result_count INTEGER NOT NULL DEFAULT 0,
        context_document_ids TEXT NOT NULL, settings TEXT NOT NULL, model TEXT NOT NULL,
        prompt_version TEXT NOT NULL, provider TEXT NOT NULL, usage TEXT, warnings TEXT NOT NULL,
        error TEXT, raw_output TEXT, started_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS research_sources (
        id TEXT PRIMARY KEY, research_run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
        title TEXT NOT NULL, url TEXT NOT NULL, source_type TEXT NOT NULL, claim TEXT NOT NULL,
        citation_metadata TEXT NOT NULL, accessed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leads (
        id TEXT PRIMARY KEY, research_run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
        opportunity_class TEXT NOT NULL, organization_name TEXT NOT NULL, organization_type TEXT NOT NULL,
        organization_website TEXT, organization_domain TEXT, city TEXT NOT NULL, region TEXT NOT NULL,
        event_name TEXT, event_url TEXT, event_start_date TEXT, event_end_date TEXT, event_organizer TEXT,
        contact_name TEXT, contact_role TEXT, contact_email TEXT, email_category TEXT NOT NULL,
        email_source_url TEXT, contact_page_url TEXT, recommended_action TEXT NOT NULL,
        fit_explanation TEXT NOT NULL, evidence_summary TEXT NOT NULL, confidence TEXT NOT NULL,
        verification_status TEXT NOT NULL, warnings TEXT NOT NULL, researched_at TEXT NOT NULL,
        review_status TEXT NOT NULL DEFAULT 'unreviewed', selected INTEGER NOT NULL DEFAULT 0,
        user_edits TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS lead_sources (
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,
        PRIMARY KEY (lead_id, source_id)
      );
      CREATE TABLE IF NOT EXISTS outreach_campaigns (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL,
        context_document_ids TEXT NOT NULL, subject_template TEXT NOT NULL, body_template TEXT NOT NULL,
        forwardable_announcement TEXT NOT NULL, warnings TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outreach_recipients (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES outreach_campaigns(id) ON DELETE CASCADE,
        lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE, email TEXT,
        subject TEXT NOT NULL, body TEXT NOT NULL, forwardable_announcement TEXT NOT NULL,
        review_status TEXT NOT NULL, excluded INTEGER NOT NULL DEFAULT 0, warnings TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS content_campaigns (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, brief TEXT NOT NULL, objective TEXT NOT NULL,
        target_audience TEXT NOT NULL, call_to_action TEXT NOT NULL, required_phrases TEXT NOT NULL,
        prohibited_phrases TEXT NOT NULL, headline TEXT NOT NULL, image_direction TEXT NOT NULL,
        context_document_ids TEXT NOT NULL, platforms TEXT NOT NULL, status TEXT NOT NULL,
        model TEXT NOT NULL, prompt_version TEXT NOT NULL, provider TEXT NOT NULL, warnings TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS platform_posts (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES content_campaigns(id) ON DELETE CASCADE,
        platform TEXT NOT NULL, text TEXT NOT NULL, hook TEXT NOT NULL, call_to_action TEXT NOT NULL,
        hashtags TEXT NOT NULL, image_headline TEXT NOT NULL, image_subheadline TEXT NOT NULL,
        image_alt_text TEXT NOT NULL, image_prompt TEXT NOT NULL, warnings TEXT NOT NULL,
        style_guide_status TEXT NOT NULL, review_status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS generated_assets (
        id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES content_campaigns(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, file_name TEXT NOT NULL, storage_path TEXT NOT NULL, mime_type TEXT NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL, prompt TEXT NOT NULL, overlay TEXT NOT NULL,
        model TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity_events (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
        entity_id TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS leads_email_idx ON leads(contact_email);
      CREATE INDEX IF NOT EXISTS leads_domain_idx ON leads(organization_domain);
      CREATE INDEX IF NOT EXISTS leads_run_idx ON leads(research_run_id);
      CREATE INDEX IF NOT EXISTS leads_confidence_idx ON leads(confidence);
      CREATE INDEX IF NOT EXISTS research_runs_status_idx ON research_runs(status);
      CREATE INDEX IF NOT EXISTS research_runs_started_idx ON research_runs(started_at);
      CREATE INDEX IF NOT EXISTS platform_posts_platform_idx ON platform_posts(platform);
      CREATE INDEX IF NOT EXISTS content_campaigns_updated_idx ON content_campaigns(updated_at);
    `
  },
  {
    version: 2,
    sql: `
      ALTER TABLE outreach_campaigns ADD COLUMN call_to_action TEXT NOT NULL DEFAULT '';
      ALTER TABLE outreach_campaigns ADD COLUMN preview_text TEXT NOT NULL DEFAULT '';
      ALTER TABLE content_campaigns ADD COLUMN image_generation_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE content_campaigns ADD COLUMN selected_brand_asset_id TEXT;
    `
  },
  {
    version: 3,
    sql: `
      ALTER TABLE outreach_campaigns ADD COLUMN model TEXT NOT NULL DEFAULT '';
      ALTER TABLE outreach_campaigns ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'outreach-v1';
      ALTER TABLE outreach_campaigns ADD COLUMN provider TEXT NOT NULL DEFAULT 'demo';
    `
  },
  {
    version: 4,
    sql: `
      ALTER TABLE outreach_campaigns ADD COLUMN usage TEXT;
      ALTER TABLE content_campaigns ADD COLUMN usage TEXT;
    `
  },
  {
    version: 5,
    sql: `
      ALTER TABLE content_campaigns ADD COLUMN error TEXT;
    `
  },
  {
    version: 6,
    sql: `
      ALTER TABLE context_documents ADD COLUMN summary TEXT NOT NULL DEFAULT '';
      ALTER TABLE context_documents ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE context_documents ADD COLUMN platforms TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE context_documents ADD COLUMN purposes TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE context_documents ADD COLUMN origin TEXT NOT NULL DEFAULT 'user';
      ALTER TABLE context_documents ADD COLUMN source_path TEXT;
      ALTER TABLE context_documents ADD COLUMN content_hash TEXT;
      CREATE TABLE IF NOT EXISTS context_asset_imports (
        source_path TEXT PRIMARY KEY, entity_id TEXT, content_hash TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0, imported_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS context_documents_source_path_idx ON context_documents(source_path) WHERE source_path IS NOT NULL;
      CREATE TABLE IF NOT EXISTS speaker_spotlight_batches (
        id TEXT PRIMARY KEY, speaker_names TEXT NOT NULL, status TEXT NOT NULL, config TEXT NOT NULL,
        model TEXT NOT NULL, prompt_version TEXT NOT NULL, provider TEXT NOT NULL,
        warnings TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS speaker_spotlight_results (
        id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES speaker_spotlight_batches(id) ON DELETE CASCADE,
        input_name TEXT NOT NULL, profile_key TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL,
        profile TEXT, post TEXT, headshot_file_name TEXT, image_file_name TEXT,
        headshot_asset_id TEXT, image_asset_id TEXT, headshot_storage_path TEXT, image_storage_path TEXT,
        image_prompt TEXT, qa TEXT, request_ids TEXT NOT NULL DEFAULT '[]', retry_count INTEGER NOT NULL DEFAULT 0,
        error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS spotlight_results_batch_idx ON speaker_spotlight_results(batch_id);
      CREATE INDEX IF NOT EXISTS spotlight_batches_created_idx ON speaker_spotlight_batches(created_at);
    `
  },
  {
    version: 7,
    sql: `
      ALTER TABLE speaker_spotlight_results ADD COLUMN provider_error TEXT;
    `
  },
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS ai_operations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL,
        steps TEXT NOT NULL,
        completed_units INTEGER,
        total_units INTEGER,
        unit_label TEXT,
        result_entity_type TEXT,
        result_entity_id TEXT,
        result_href TEXT,
        origin_path TEXT NOT NULL,
        target_key TEXT NOT NULL,
        input_json TEXT NOT NULL,
        error TEXT,
        retryable INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        started_at TEXT,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS ai_operations_status_idx ON ai_operations(status);
      CREATE INDEX IF NOT EXISTS ai_operations_created_idx ON ai_operations(created_at);
      CREATE INDEX IF NOT EXISTS ai_operations_target_idx ON ai_operations(target_key);
    `
  },
  {
    version: 9,
    sql: `
      ALTER TABLE ai_operations ADD COLUMN dismissed_at TEXT;
      CREATE INDEX IF NOT EXISTS ai_operations_dismissed_idx ON ai_operations(dismissed_at);
    `
  },
  {
    version: 10,
    sql: `
      UPDATE ai_operations
      SET status = 'failed',
          retryable = 1,
          updated_at = COALESCE(completed_at, updated_at)
      WHERE kind = 'spotlight_batch'
        AND status = 'partially_completed'
        AND COALESCE(completed_units, 0) = 0;
    `
  },
  {
    version: 11,
    sql: `
      ALTER TABLE leads ADD COLUMN target_segment TEXT NOT NULL DEFAULT 'general_technology';
      ALTER TABLE leads ADD COLUMN sales_motion TEXT NOT NULL DEFAULT 'partner_distribution';
      ALTER TABLE leads ADD COLUMN priority_score INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE leads ADD COLUMN priority_tier TEXT NOT NULL DEFAULT 'nurture';
      ALTER TABLE leads ADD COLUMN qualification TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE leads ADD COLUMN outreach_angle TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN next_best_action TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN canonical_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN last_verified_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE leads ADD COLUMN rejection_reason TEXT;
      CREATE INDEX IF NOT EXISTS leads_priority_idx ON leads(priority_score DESC);
      CREATE INDEX IF NOT EXISTS leads_segment_idx ON leads(target_segment);
      CREATE INDEX IF NOT EXISTS leads_sales_motion_idx ON leads(sales_motion);
      CREATE INDEX IF NOT EXISTS leads_canonical_key_idx ON leads(canonical_key);
    `
  }
];

export function ensureDataDirectories() {
  const root = dataDirectory();
  for (const name of ["", "uploads", "generated", "exports", "tmp", "speaker_spotlights"]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
  }
  return root;
}

export function getDatabase() {
  if (globalDb.__marketingHubDb) return globalDb.__marketingHubDb;
  const root = ensureDataDirectories();
  const db = new DatabaseSync(path.join(root, "marketing-hub.sqlite"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set((db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    withTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(migration.version, new Date().toISOString());
    });
  }
  const interruptedAt = new Date().toISOString();
  withTransaction(db, () => {
    db.prepare("UPDATE research_runs SET status='failed', error=COALESCE(error, 'The local process stopped before this run completed.'), completed_at=COALESCE(completed_at, ?) WHERE status IN ('running','queued')").run(interruptedAt);
    db.prepare(`
      UPDATE speaker_spotlight_results
      SET status='failed',
          error=COALESCE(error, 'The local process stopped during this speaker package. Verified partial work was preserved and can be retried.'),
          updated_at=?
      WHERE batch_id IN (SELECT id FROM speaker_spotlight_batches WHERE status='running')
        AND status NOT IN ('completed','image_review_required','failed','extraction_failed','canceled')
    `).run(interruptedAt);
    db.prepare(`
      UPDATE speaker_spotlight_batches
      SET status=CASE
            WHEN NOT EXISTS (SELECT 1 FROM speaker_spotlight_results r WHERE r.batch_id=speaker_spotlight_batches.id AND r.status<>'completed') THEN 'completed'
            WHEN EXISTS (SELECT 1 FROM speaker_spotlight_results r WHERE r.batch_id=speaker_spotlight_batches.id AND (r.status IN ('completed','image_review_required') OR r.post IS NOT NULL OR r.image_asset_id IS NOT NULL)) THEN 'partially_completed'
            ELSE 'failed'
          END,
          error=CASE
            WHEN NOT EXISTS (SELECT 1 FROM speaker_spotlight_results r WHERE r.batch_id=speaker_spotlight_batches.id AND r.status<>'completed') THEN NULL
            WHEN EXISTS (SELECT 1 FROM speaker_spotlight_results r WHERE r.batch_id=speaker_spotlight_batches.id AND (r.status IN ('completed','image_review_required') OR r.post IS NOT NULL OR r.image_asset_id IS NOT NULL)) THEN 'The local process stopped before this batch completed. Verified partial packages were preserved and can be retried.'
            ELSE 'The local process stopped before any speaker package completed.'
          END,
          completed_at=COALESCE(completed_at, ?)
      WHERE status='running'
    `).run(interruptedAt);
    db.prepare("UPDATE ai_operations SET status='interrupted', error=COALESCE(error, 'The local process stopped before this operation completed. Reconnect OpenAI and retry when ready.'), retryable=1, completed_at=COALESCE(completed_at, ?), updated_at=? WHERE status IN ('queued','running','cancel_requested')").run(interruptedAt, interruptedAt);
  });
  globalDb.__marketingHubDb = db;
  return db;
}

export function withTransaction<T>(db: DatabaseSync, work: () => T) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function closeDatabase() {
  globalDb.__marketingHubDb?.close();
  delete globalDb.__marketingHubDb;
}
