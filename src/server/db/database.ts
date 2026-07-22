import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { currentWorkspaceId, workspaceDataDirectory } from "@/server/workspaces/registry";

const globalDb = globalThis as typeof globalThis & { __marketingHubDbs?: Map<string, DatabaseSync> };
const databaseConnections = globalDb.__marketingHubDbs ?? new Map<string, DatabaseSync>();
globalDb.__marketingHubDbs = databaseConnections;
const migratedConnections = new WeakSet<DatabaseSync>();

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
  },
  {
    version: 12,
    sql: `
      CREATE TABLE IF NOT EXISTS summit_agenda_state (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        source_digest TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS summit_agenda_batches (
        id TEXT PRIMARY KEY,
        session_ids TEXT NOT NULL,
        status TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        provider TEXT NOT NULL,
        warnings TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS summit_agenda_results (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES summit_agenda_batches(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        session_snapshot TEXT NOT NULL,
        status TEXT NOT NULL,
        image_asset_id TEXT,
        image_file_name TEXT,
        image_storage_path TEXT,
        prompt TEXT,
        request_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS summit_agenda_batches_created_idx ON summit_agenda_batches(created_at);
      CREATE INDEX IF NOT EXISTS summit_agenda_results_batch_idx ON summit_agenda_results(batch_id);
      CREATE INDEX IF NOT EXISTS summit_agenda_results_asset_idx ON summit_agenda_results(image_asset_id);
    `
  },
  {
    version: 13,
    sql: `
      ALTER TABLE summit_agenda_results ADD COLUMN provider_error TEXT;
    `
  },
  {
    version: 14,
    sql: `
      UPDATE summit_agenda_results
      SET status='canceled',
          error=COALESCE(error, 'Canceled before this image completed.')
      WHERE status IN ('queued','generating')
        AND batch_id IN (SELECT id FROM summit_agenda_batches WHERE completed_at IS NOT NULL);
    `
  },
  {
    version: 15,
    sql: `
      ALTER TABLE summit_agenda_results ADD COLUMN caption TEXT;
    `
  },
  {
    version: 16,
    sql: `
      CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS speaker_spotlight_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        selected INTEGER NOT NULL DEFAULT 0,
        source_type TEXT NOT NULL,
        original_file_name TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        thumbnail_storage_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        aspect_ratio TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        example_speaker_name TEXT,
        fixed_guidance TEXT NOT NULL,
        variable_guidance TEXT NOT NULL,
        caption_guidance TEXT NOT NULL DEFAULT '',
        additional_guidance TEXT NOT NULL DEFAULT '',
        exact_pixel_regions INTEGER NOT NULL DEFAULT 0,
        blueprint TEXT,
        model TEXT,
        request_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS speaker_spotlight_templates_selected_idx
        ON speaker_spotlight_templates(selected) WHERE selected=1;
      CREATE INDEX IF NOT EXISTS speaker_spotlight_templates_created_idx
        ON speaker_spotlight_templates(created_at DESC);
      ALTER TABLE speaker_spotlight_batches ADD COLUMN template_id TEXT;
      ALTER TABLE speaker_spotlight_batches ADD COLUMN template_snapshot TEXT;
      ALTER TABLE speaker_spotlight_batches ADD COLUMN template_storage_path TEXT;
    `
  },
  {
    version: 17,
    sql: `
      UPDATE speaker_spotlight_results
      SET status=CASE WHEN image_asset_id IS NOT NULL THEN 'completed' ELSE 'failed' END,
          error=CASE WHEN image_asset_id IS NOT NULL THEN NULL ELSE COALESCE(error, 'No generated image was saved.') END,
          qa=NULL
      WHERE status='image_review_required';
      UPDATE speaker_spotlight_results SET qa=NULL WHERE qa IS NOT NULL;
      UPDATE speaker_spotlight_templates SET exact_pixel_regions=0 WHERE exact_pixel_regions<>0;
    `
  },
  {
    version: 18,
    sql: `
      UPDATE speaker_spotlight_templates
      SET blueprint=json_remove(blueprint, '$.protectedRegions')
      WHERE blueprint IS NOT NULL;
      ALTER TABLE speaker_spotlight_results DROP COLUMN qa;
      ALTER TABLE speaker_spotlight_templates DROP COLUMN exact_pixel_regions;
    `
  },
  {
    version: 19,
    sql: `
      CREATE TABLE IF NOT EXISTS assistant_messages (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        mode TEXT NOT NULL CHECK(mode IN ('ask','create','context')),
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('completed','partial','failed')),
        attachment_ids TEXT NOT NULL DEFAULT '[]',
        context_document_ids TEXT NOT NULL DEFAULT '[]',
        generated_asset_id TEXT,
        content_campaign_id TEXT,
        saved_context_document_id TEXT,
        warnings TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS assistant_messages_created_idx
        ON assistant_messages(created_at ASC);
    `
  },
  {
    version: 20,
    sql: `
      CREATE TRIGGER IF NOT EXISTS assistant_generated_asset_deleted
      AFTER DELETE ON generated_assets
      BEGIN
        UPDATE assistant_messages SET generated_asset_id=NULL WHERE generated_asset_id=OLD.id;
      END;
      CREATE TRIGGER IF NOT EXISTS assistant_content_campaign_deleted
      AFTER DELETE ON content_campaigns
      BEGIN
        UPDATE assistant_messages SET content_campaign_id=NULL, generated_asset_id=NULL WHERE content_campaign_id=OLD.id;
      END;
      CREATE TRIGGER IF NOT EXISTS assistant_context_document_deleted
      AFTER DELETE ON context_documents
      BEGIN
        UPDATE assistant_messages SET saved_context_document_id=NULL WHERE saved_context_document_id=OLD.id;
      END;
    `
  },
  {
    version: 21,
    sql: `
      UPDATE context_documents
      SET source_of_truth=0
      WHERE source_of_truth=1
        AND id <> (
          SELECT id FROM context_documents
          WHERE source_of_truth=1
          ORDER BY updated_at DESC, rowid DESC
          LIMIT 1
        );
      CREATE UNIQUE INDEX IF NOT EXISTS context_single_source_of_truth_idx
        ON context_documents(source_of_truth)
        WHERE source_of_truth=1;
    `
  },
  {
    version: 22,
    sql: `
      ALTER TABLE assistant_messages ADD COLUMN text_attachments TEXT NOT NULL DEFAULT '[]';
    `
  }
];

export function ensureDataDirectories(workspaceId = currentWorkspaceId()) {
  const root = workspaceDataDirectory(workspaceId);
  for (const name of ["", "uploads", "generated", "exports", "tmp", "speaker_spotlights", "speaker_spotlight_templates", "summit_agenda", "summit_agenda/custom_portraits", "summit_agenda/batches"]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
  }
  return root;
}

export function getDatabase() {
  return getDatabaseForWorkspace(currentWorkspaceId());
}

export function getDatabaseForWorkspace(workspaceId: string) {
  const root = workspaceDataDirectory(workspaceId);
  const connectionKey = path.resolve(root);
  const existing = databaseConnections.get(connectionKey);
  if (existing) {
    if (!migratedConnections.has(existing)) {
      applyMigrations(existing);
      migratedConnections.add(existing);
    }
    return existing;
  }
  ensureDataDirectories(workspaceId);
  const db = new DatabaseSync(path.join(root, "marketing-hub.sqlite"));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  applyMigrations(db);
  migratedConnections.add(db);
  const interruptedAt = new Date().toISOString();
  withTransaction(db, () => {
    db.prepare("UPDATE research_runs SET status='failed', error=COALESCE(error, 'The local process stopped before this run completed.'), completed_at=COALESCE(completed_at, ?) WHERE status IN ('running','queued')").run(interruptedAt);
    db.prepare(`
      UPDATE speaker_spotlight_results
      SET status='failed',
          error=COALESCE(error, 'The local process stopped during this speaker package. Verified partial work was preserved and can be retried.'),
          updated_at=?
      WHERE batch_id IN (SELECT id FROM speaker_spotlight_batches WHERE status='running')
        AND status NOT IN ('completed','failed','extraction_failed','canceled')
    `).run(interruptedAt);
    db.prepare(`
      UPDATE speaker_spotlight_batches
      SET status=CASE
            WHEN NOT EXISTS (SELECT 1 FROM speaker_spotlight_results r WHERE r.batch_id=speaker_spotlight_batches.id AND r.status<>'completed') THEN 'completed'
            WHEN EXISTS (SELECT 1 FROM speaker_spotlight_results r WHERE r.batch_id=speaker_spotlight_batches.id AND (r.status='completed' OR r.post IS NOT NULL OR r.image_asset_id IS NOT NULL)) THEN 'partially_completed'
            ELSE 'failed'
          END,
          error=CASE
            WHEN NOT EXISTS (SELECT 1 FROM speaker_spotlight_results r WHERE r.batch_id=speaker_spotlight_batches.id AND r.status<>'completed') THEN NULL
            WHEN EXISTS (SELECT 1 FROM speaker_spotlight_results r WHERE r.batch_id=speaker_spotlight_batches.id AND (r.status='completed' OR r.post IS NOT NULL OR r.image_asset_id IS NOT NULL)) THEN 'The local process stopped before this batch completed. Verified partial packages were preserved and can be retried.'
            ELSE 'The local process stopped before any speaker package completed.'
          END,
          completed_at=COALESCE(completed_at, ?)
      WHERE status='running'
    `).run(interruptedAt);
    db.prepare("UPDATE ai_operations SET status='interrupted', error=COALESCE(error, 'The local process stopped before this operation completed. Reconnect OpenAI and retry when ready.'), retryable=1, completed_at=COALESCE(completed_at, ?), updated_at=? WHERE status IN ('queued','running','cancel_requested')").run(interruptedAt, interruptedAt);
    db.prepare("UPDATE summit_agenda_results SET status='failed', error=COALESCE(error, 'The local process stopped during this image.'), updated_at=? WHERE status IN ('queued','generating')").run(interruptedAt);
    db.prepare("UPDATE summit_agenda_batches SET status=CASE WHEN EXISTS (SELECT 1 FROM summit_agenda_results r WHERE r.batch_id=summit_agenda_batches.id AND r.status='completed') THEN 'partially_completed' ELSE 'failed' END, error=COALESCE(error, 'The local process stopped before this batch completed.'), completed_at=COALESCE(completed_at, ?) WHERE status='running'").run(interruptedAt);
  });
  databaseConnections.set(connectionKey, db);
  return db;
}

function applyMigrations(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set((db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version));
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    withTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(migration.version, new Date().toISOString());
    });
  }
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

export function closeDatabase(workspaceId = currentWorkspaceId()) {
  const connectionKey = path.resolve(workspaceDataDirectory(workspaceId));
  databaseConnections.get(connectionKey)?.close();
  databaseConnections.delete(connectionKey);
}

export function closeAllDatabases() {
  for (const connection of databaseConnections.values()) connection.close();
  databaseConnections.clear();
}
