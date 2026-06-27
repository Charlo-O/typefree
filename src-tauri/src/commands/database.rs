use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use super::command_error::{CommandError, CommandResult};

fn database_error(message: impl Into<String>) -> CommandError {
    CommandError::from_message(message.into()).with_source("database")
}

const SCHEMA_VERSION: i32 = 4;
const TRANSCRIPTION_SELECT_COLUMNS: &str = "id, timestamp, original_text, processed_text, is_processed, processing_method, agent_name, error, session_id";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Transcription {
    pub id: i64,
    pub timestamp: String,
    #[serde(rename = "text")]
    pub original_text: String,
    pub processed_text: Option<String>,
    pub is_processed: bool,
    pub processing_method: String,
    pub agent_name: Option<String>,
    pub error: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionSession {
    pub id: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub language: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionOutput {
    pub id: i64,
    pub transcription_id: i64,
    pub session_id: Option<String>,
    pub stage: String,
    pub text: String,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionOutputInput {
    pub stage: String,
    pub text: String,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DictationTimelineEventInput {
    pub kind: String,
    pub label: String,
    pub status: Option<String>,
    pub phase: Option<String>,
    pub source: Option<String>,
    pub duration_ms: Option<i64>,
    pub detail: Option<String>,
    pub meta: Option<serde_json::Value>,
    pub at: Option<String>,
    pub elapsed_ms: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DictationTimelineEventRecord {
    pub id: String,
    pub session_id: String,
    pub at: String,
    pub elapsed_ms: i64,
    pub kind: String,
    pub label: String,
    pub status: String,
    pub phase: Option<String>,
    pub source: Option<String>,
    pub duration_ms: Option<i64>,
    pub detail: Option<String>,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DictationTimelineSessionRecord {
    pub session_id: String,
    pub source: String,
    pub started_at: String,
    pub updated_at: String,
    pub events: Vec<DictationTimelineEventRecord>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveTranscriptionRecordRequest {
    pub text: String,
    pub processed: Option<String>,
    pub method: Option<String>,
    #[serde(alias = "agent_name")]
    pub agent_name: Option<String>,
    #[serde(alias = "session_id")]
    pub session_id: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub language: Option<String>,
    pub status: Option<String>,
    pub error: Option<String>,
    pub outputs: Option<Vec<TranscriptionOutputInput>>,
}

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct HistoryCleanupResult {
    transcriptions_deleted: usize,
    sessions_deleted: usize,
    timeline_sessions_deleted: usize,
}

impl HistoryCleanupResult {
    fn total_deleted(self) -> usize {
        self.transcriptions_deleted + self.sessions_deleted + self.timeline_sessions_deleted
    }
}

impl Database {
    pub fn new(path: &str) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| e.to_string())?;
        Ok(Database {
            conn: Mutex::new(conn),
        })
    }
}

fn current_user_version(conn: &Connection) -> rusqlite::Result<i32> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
}

fn ensure_schema_migrations_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        ",
    )
}

fn backfill_schema_migrations(conn: &Connection, version: i32) -> rusqlite::Result<()> {
    for migration_version in 1..=version.min(SCHEMA_VERSION) {
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name)
             VALUES (?1, ?2)",
            params![
                migration_version,
                migration_name(migration_version).unwrap_or("legacy-applied")
            ],
        )?;
    }
    Ok(())
}

fn migration_name(version: i32) -> Option<&'static str> {
    match version {
        1 => Some("base-transcriptions"),
        2 => Some("sessions-outputs-fts"),
        3 => Some("link-transcriptions-to-sessions"),
        4 => Some("dictation-timeline-events"),
        _ => None,
    }
}

fn set_user_version(conn: &Connection, version: i32) -> rusqlite::Result<()> {
    conn.pragma_update(None, "user_version", version)
}

fn record_migration(conn: &Connection, version: i32, name: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO schema_migrations (version, name, applied_at)
         VALUES (?1, ?2, CURRENT_TIMESTAMP)",
        params![version, name],
    )?;
    set_user_version(conn, version)
}

fn apply_migration(
    conn: &mut Connection,
    version: i32,
    name: &'static str,
    migrate: fn(&Connection) -> rusqlite::Result<()>,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    migrate(&tx)?;
    record_migration(&tx, version, name)?;
    tx.commit()
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;

    for existing in columns {
        if existing?.eq_ignore_ascii_case(column) {
            return Ok(true);
        }
    }

    Ok(false)
}

fn migration_1_base_transcriptions(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS transcriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            original_text TEXT NOT NULL,
            processed_text TEXT,
            is_processed BOOLEAN DEFAULT 0,
            processing_method TEXT DEFAULT 'none',
            agent_name TEXT,
            error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_transcriptions_timestamp
            ON transcriptions(timestamp DESC);
        ",
    )
}

fn migration_2_sessions_outputs_fts(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS transcription_sessions (
            id TEXT PRIMARY KEY,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            provider TEXT,
            model TEXT,
            language TEXT,
            status TEXT NOT NULL DEFAULT 'completed',
            error TEXT
        );

        CREATE TABLE IF NOT EXISTS transcription_outputs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transcription_id INTEGER NOT NULL,
            session_id TEXT,
            stage TEXT NOT NULL,
            text TEXT NOT NULL,
            metadata_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(transcription_id) REFERENCES transcriptions(id) ON DELETE CASCADE,
            FOREIGN KEY(session_id) REFERENCES transcription_sessions(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_transcription_outputs_transcription_id
            ON transcription_outputs(transcription_id);
        CREATE INDEX IF NOT EXISTS idx_transcription_outputs_session_id
            ON transcription_outputs(session_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS transcriptions_fts USING fts5(
            original_text,
            processed_text,
            content='transcriptions',
            content_rowid='id'
        );

        CREATE TRIGGER IF NOT EXISTS transcriptions_ai
        AFTER INSERT ON transcriptions BEGIN
            INSERT INTO transcriptions_fts(rowid, original_text, processed_text)
            VALUES (new.id, new.original_text, coalesce(new.processed_text, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS transcriptions_ad
        AFTER DELETE ON transcriptions BEGIN
            INSERT INTO transcriptions_fts(transcriptions_fts, rowid, original_text, processed_text)
            VALUES ('delete', old.id, old.original_text, coalesce(old.processed_text, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS transcriptions_au
        AFTER UPDATE ON transcriptions BEGIN
            INSERT INTO transcriptions_fts(transcriptions_fts, rowid, original_text, processed_text)
            VALUES ('delete', old.id, old.original_text, coalesce(old.processed_text, ''));
            INSERT INTO transcriptions_fts(rowid, original_text, processed_text)
            VALUES (new.id, new.original_text, coalesce(new.processed_text, ''));
        END;
        ",
    )?;

    rebuild_transcriptions_fts(conn)
}

fn migration_3_link_transcriptions_to_sessions(conn: &Connection) -> rusqlite::Result<()> {
    if !column_exists(conn, "transcriptions", "session_id")? {
        conn.execute_batch(
            "
            ALTER TABLE transcriptions
                ADD COLUMN session_id TEXT
                REFERENCES transcription_sessions(id) ON DELETE SET NULL;
            ",
        )?;
    }

    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_transcriptions_session_id
            ON transcriptions(session_id);
        ",
    )?;
    Ok(())
}

fn migration_4_dictation_timeline_events(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS dictation_timeline_sessions (
            session_id TEXT PRIMARY KEY,
            source TEXT NOT NULL DEFAULT 'unknown',
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS dictation_timeline_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            at DATETIME DEFAULT CURRENT_TIMESTAMP,
            elapsed_ms INTEGER NOT NULL DEFAULT 0,
            kind TEXT NOT NULL,
            label TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'info',
            phase TEXT,
            source TEXT,
            duration_ms INTEGER,
            detail TEXT,
            meta_json TEXT,
            FOREIGN KEY(session_id) REFERENCES dictation_timeline_sessions(session_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_dictation_timeline_sessions_updated_at
            ON dictation_timeline_sessions(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_dictation_timeline_events_session_id
            ON dictation_timeline_events(session_id, id);
        ",
    )
}

fn rebuild_transcriptions_fts(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO transcriptions_fts(transcriptions_fts) VALUES ('rebuild')",
        [],
    )?;
    Ok(())
}

fn run_migrations(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    ensure_schema_migrations_table(conn)?;

    let version = current_user_version(conn)?;
    if version > SCHEMA_VERSION {
        return Err(rusqlite::Error::InvalidQuery);
    }
    backfill_schema_migrations(conn, version)?;

    if version < 1 {
        apply_migration(
            conn,
            1,
            migration_name(1).unwrap(),
            migration_1_base_transcriptions,
        )?;
    }
    let version = current_user_version(conn)?;
    if version < 2 {
        apply_migration(
            conn,
            2,
            migration_name(2).unwrap(),
            migration_2_sessions_outputs_fts,
        )?;
    }
    let version = current_user_version(conn)?;
    if version < 3 {
        apply_migration(
            conn,
            3,
            migration_name(3).unwrap(),
            migration_3_link_transcriptions_to_sessions,
        )?;
    }
    let version = current_user_version(conn)?;
    if version < 4 {
        apply_migration(
            conn,
            4,
            migration_name(4).unwrap(),
            migration_4_dictation_timeline_events,
        )?;
    }

    Ok(())
}

/// Initialize database on app startup
pub fn init_database(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_data_dir)?;

    let db_path = app_data_dir.join("transcriptions.db");
    let mut conn = Connection::open(&db_path)?;

    run_migrations(&mut conn)?;

    app.manage(Database::new(db_path.to_str().unwrap())?);
    Ok(())
}

fn cleanup_expired_transcriptions_in_conn(
    conn: &Connection,
    retention_days: i64,
) -> Result<HistoryCleanupResult, String> {
    let modifier = format!("-{} days", retention_days);
    let transcriptions_deleted = conn
        .execute(
            "DELETE FROM transcriptions WHERE timestamp < datetime('now', ?1)",
            params![modifier],
        )
        .map_err(|e| e.to_string())?;

    let sessions_deleted = conn
        .execute(
            "DELETE FROM transcription_sessions
             WHERE status IN ('completed', 'failed', 'cancelled')
               AND COALESCE(completed_at, started_at) < datetime('now', ?1)
               AND NOT EXISTS (
                    SELECT 1 FROM transcriptions
                    WHERE transcriptions.session_id = transcription_sessions.id
               )",
            params![modifier],
        )
        .map_err(|e| e.to_string())?;

    let timeline_sessions_deleted = conn
        .execute(
            "DELETE FROM dictation_timeline_sessions
             WHERE updated_at < datetime('now', ?1)",
            params![modifier],
        )
        .map_err(|e| e.to_string())?;

    Ok(HistoryCleanupResult {
        transcriptions_deleted,
        sessions_deleted,
        timeline_sessions_deleted,
    })
}

fn cleanup_expired_transcriptions(app: &AppHandle, conn: &Connection) -> Result<usize, String> {
    let Some(retention_days) = super::privacy::history_retention_days(app) else {
        return Ok(0);
    };

    let cleanup = cleanup_expired_transcriptions_in_conn(conn, retention_days)?;

    if cleanup.total_deleted() > 0 {
        let _ = app.emit(
            "transcriptions-pruned",
            serde_json::json!({
                "deleted": cleanup.transcriptions_deleted,
                "sessionsDeleted": cleanup.sessions_deleted,
                "timelineSessionsDeleted": cleanup.timeline_sessions_deleted,
                "retentionDays": retention_days,
            }),
        );
        eprintln!(
            "[privacy] pruned {} transcription rows, {} orphan sessions, and {} timeline sessions older than {} days",
            cleanup.transcriptions_deleted,
            cleanup.sessions_deleted,
            cleanup.timeline_sessions_deleted,
            retention_days
        );
    }

    Ok(cleanup.transcriptions_deleted)
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn normalize_status(value: Option<String>, error: Option<&String>) -> String {
    let status = value
        .map(|text| text.trim().to_lowercase())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| {
            if error.is_some() {
                "failed".to_string()
            } else {
                "completed".to_string()
            }
        });

    match status.as_str() {
        "started" | "recording" | "transcribing" | "postprocessing" | "inserting" | "completed"
        | "failed" | "cancelled" => status,
        _ => "completed".to_string(),
    }
}

fn map_transcription(row: &rusqlite::Row<'_>) -> rusqlite::Result<Transcription> {
    Ok(Transcription {
        id: row.get(0)?,
        timestamp: row.get(1)?,
        original_text: row.get(2)?,
        processed_text: row.get(3)?,
        is_processed: row.get(4)?,
        processing_method: row.get(5)?,
        agent_name: row.get(6)?,
        error: row.get(7)?,
        session_id: row.get(8)?,
    })
}

fn map_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<TranscriptionSession> {
    Ok(TranscriptionSession {
        id: row.get(0)?,
        started_at: row.get(1)?,
        completed_at: row.get(2)?,
        provider: row.get(3)?,
        model: row.get(4)?,
        language: row.get(5)?,
        status: row.get(6)?,
        error: row.get(7)?,
    })
}

fn map_output(row: &rusqlite::Row<'_>) -> rusqlite::Result<TranscriptionOutput> {
    Ok(TranscriptionOutput {
        id: row.get(0)?,
        transcription_id: row.get(1)?,
        session_id: row.get(2)?,
        stage: row.get(3)?,
        text: row.get(4)?,
        metadata_json: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn normalize_timeline_text(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_timeline_optional_text(value: Option<&String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn normalize_timeline_status(value: Option<&String>) -> String {
    let status = value
        .map(|text| text.trim().to_lowercase())
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| "info".to_string());

    match status.as_str() {
        "started" | "completed" | "failed" | "skipped" | "cancelled" | "info" => status,
        _ => "info".to_string(),
    }
}

fn serialize_timeline_meta(meta: &Option<serde_json::Value>) -> Result<Option<String>, String> {
    match meta {
        Some(value) => serde_json::to_string(value)
            .map(Some)
            .map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

fn parse_timeline_meta(raw: Option<String>) -> Option<serde_json::Value> {
    raw.and_then(|value| serde_json::from_str(&value).ok())
}

fn map_timeline_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<DictationTimelineEventRecord> {
    let id: i64 = row.get(0)?;
    let meta_json: Option<String> = row.get(11)?;

    Ok(DictationTimelineEventRecord {
        id: id.to_string(),
        session_id: row.get(1)?,
        at: row.get(2)?,
        elapsed_ms: row.get(3)?,
        kind: row.get(4)?,
        label: row.get(5)?,
        status: row.get(6)?,
        phase: row.get(7)?,
        source: row.get(8)?,
        duration_ms: row.get(9)?,
        detail: row.get(10)?,
        meta: parse_timeline_meta(meta_json),
    })
}

fn save_dictation_timeline_events_in_conn(
    conn: &Connection,
    session_id: &str,
    source: &str,
    events: &[DictationTimelineEventInput],
) -> Result<usize, String> {
    let session_id = normalize_timeline_text(session_id, "");
    if session_id.is_empty() || events.is_empty() {
        return Ok(0);
    }

    let source = normalize_timeline_text(source, "unknown");
    conn.execute(
        "INSERT INTO dictation_timeline_sessions (session_id, source, updated_at)
         VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(session_id) DO UPDATE SET
            source = COALESCE(NULLIF(excluded.source, ''), dictation_timeline_sessions.source),
            updated_at = CURRENT_TIMESTAMP",
        params![session_id.as_str(), source.as_str()],
    )
    .map_err(|e| e.to_string())?;

    let mut inserted = 0;
    for event in events {
        let kind = normalize_timeline_text(&event.kind, "backend");
        let label = normalize_timeline_text(&event.label, "backend.event");
        let status = normalize_timeline_status(event.status.as_ref());
        let phase = normalize_timeline_optional_text(event.phase.as_ref());
        let event_source = normalize_timeline_optional_text(event.source.as_ref())
            .unwrap_or_else(|| source.clone());
        let detail = normalize_timeline_optional_text(event.detail.as_ref());
        let at = normalize_timeline_optional_text(event.at.as_ref());
        let elapsed_ms = event.elapsed_ms.map(|value| value.max(0));
        let duration_ms = event.duration_ms.map(|value| value.max(0));
        let meta_json = serialize_timeline_meta(&event.meta)?;

        conn.execute(
            "INSERT INTO dictation_timeline_events (
                session_id,
                at,
                elapsed_ms,
                kind,
                label,
                status,
                phase,
                source,
                duration_ms,
                detail,
                meta_json
             )
             VALUES (
                ?1,
                COALESCE(?2, CURRENT_TIMESTAMP),
                COALESCE(
                    ?3,
                    MAX(0, CAST((
                        julianday(COALESCE(?2, CURRENT_TIMESTAMP)) -
                        julianday((SELECT started_at FROM dictation_timeline_sessions WHERE session_id = ?1))
                    ) * 86400000 AS INTEGER))
                ),
                ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
             )",
            params![
                session_id.as_str(),
                at.as_deref(),
                elapsed_ms,
                kind,
                label,
                status,
                phase.as_deref(),
                event_source,
                duration_ms,
                detail.as_deref(),
                meta_json.as_deref(),
            ],
        )
        .map_err(|e| e.to_string())?;
        inserted += 1;
    }

    conn.execute(
        "UPDATE dictation_timeline_sessions
         SET updated_at = CURRENT_TIMESTAMP
         WHERE session_id = ?1",
        [session_id.as_str()],
    )
    .map_err(|e| e.to_string())?;

    Ok(inserted)
}

fn get_dictation_timeline_events_in_conn(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<DictationTimelineEventRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, at, elapsed_ms, kind, label, status, phase, source,
                    duration_ms, detail, meta_json
             FROM dictation_timeline_events
             WHERE session_id = ?1
             ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;

    let events = stmt
        .query_map([session_id], map_timeline_event)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(events)
}

fn get_dictation_timeline_sessions_in_conn(
    conn: &Connection,
    limit: Option<i32>,
) -> Result<Vec<DictationTimelineSessionRecord>, String> {
    let limit = normalized_limit(limit).min(25);
    let mut stmt = conn
        .prepare(
            "SELECT session_id, source, started_at, updated_at
             FROM dictation_timeline_sessions
             ORDER BY updated_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let session_rows = stmt
        .query_map([limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut sessions = Vec::with_capacity(session_rows.len());
    for (session_id, source, started_at, updated_at) in session_rows {
        let events = get_dictation_timeline_events_in_conn(conn, &session_id)?;
        sessions.push(DictationTimelineSessionRecord {
            session_id,
            source,
            started_at,
            updated_at,
            events,
        });
    }

    Ok(sessions)
}

fn get_transcription_by_id(conn: &Connection, id: i64) -> Result<Transcription, String> {
    conn.query_row(
        &format!(
            "SELECT {TRANSCRIPTION_SELECT_COLUMNS}
             FROM transcriptions WHERE id = ?1"
        ),
        [id],
        map_transcription,
    )
    .map_err(|e| e.to_string())
}

fn upsert_transcription_session(
    conn: &Connection,
    request: &SaveTranscriptionRecordRequest,
) -> Result<(), String> {
    let Some(session_id) = request.session_id.as_deref() else {
        return Ok(());
    };

    let status = normalize_status(request.status.clone(), request.error.as_ref());
    conn.execute(
        "INSERT INTO transcription_sessions (id, provider, model, language, status, error, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6,
            CASE WHEN ?5 IN ('completed', 'failed', 'cancelled') THEN CURRENT_TIMESTAMP ELSE NULL END)
         ON CONFLICT(id) DO UPDATE SET
            provider = COALESCE(excluded.provider, transcription_sessions.provider),
            model = COALESCE(excluded.model, transcription_sessions.model),
            language = COALESCE(excluded.language, transcription_sessions.language),
            status = excluded.status,
            error = COALESCE(excluded.error, transcription_sessions.error),
            completed_at = CASE
                WHEN excluded.status IN ('completed', 'failed', 'cancelled') THEN CURRENT_TIMESTAMP
                ELSE transcription_sessions.completed_at
            END",
        params![
            session_id,
            request.provider.as_deref(),
            request.model.as_deref(),
            request.language.as_deref(),
            status,
            request.error.as_deref(),
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn insert_transcription_output(
    conn: &Connection,
    transcription_id: i64,
    session_id: Option<&str>,
    output: &TranscriptionOutputInput,
) -> Result<(), String> {
    let stage = output.stage.trim();
    let text = output.text.trim();
    if stage.is_empty() || text.is_empty() {
        return Ok(());
    }

    conn.execute(
        "INSERT INTO transcription_outputs (transcription_id, session_id, stage, text, metadata_json)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            transcription_id,
            session_id,
            stage,
            output.text.as_str(),
            output.metadata_json.as_deref()
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn insert_transcription_record(
    conn: &mut Connection,
    request: SaveTranscriptionRecordRequest,
) -> Result<i64, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    upsert_transcription_session(&tx, &request)?;

    let processed = normalize_optional_text(request.processed.clone());
    let is_processed = processed.is_some();
    let processing_method = request
        .method
        .clone()
        .map(|method| method.trim().to_string())
        .filter(|method| !method.is_empty())
        .unwrap_or_else(|| "none".to_string());

    tx.execute(
        "INSERT INTO transcriptions (
            original_text,
            processed_text,
            is_processed,
            processing_method,
            agent_name,
            error,
            session_id
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            &request.text,
            processed.as_deref(),
            is_processed,
            &processing_method,
            request.agent_name.as_deref(),
            request.error.as_deref(),
            request.session_id.as_deref()
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = tx.last_insert_rowid();
    let session_id = request.session_id.as_deref();

    insert_transcription_output(
        &tx,
        id,
        session_id,
        &TranscriptionOutputInput {
            stage: "raw".to_string(),
            text: request.text.clone(),
            metadata_json: None,
        },
    )?;

    if let Some(processed_text) = processed.as_deref() {
        insert_transcription_output(
            &tx,
            id,
            session_id,
            &TranscriptionOutputInput {
                stage: "processed".to_string(),
                text: processed_text.to_string(),
                metadata_json: None,
            },
        )?;
    }

    if let Some(outputs) = request.outputs.as_ref() {
        for output in outputs {
            insert_transcription_output(&tx, id, session_id, output)?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

/// Save a new transcription
#[tauri::command]
pub fn db_save_transcription(
    app: AppHandle,
    text: String,
    processed: Option<String>,
    method: Option<String>,
    agent_name: Option<String>,
) -> CommandResult<i64> {
    db_save_transcription_value(&app, text, processed, method, agent_name).map_err(database_error)
}

#[tauri::command]
pub fn db_save_transcription_record(
    app: AppHandle,
    request: SaveTranscriptionRecordRequest,
) -> CommandResult<i64> {
    db_save_transcription_record_value(&app, request).map_err(database_error)
}

fn db_save_transcription_value(
    app: &AppHandle,
    text: String,
    processed: Option<String>,
    method: Option<String>,
    agent_name: Option<String>,
) -> Result<i64, String> {
    db_save_transcription_record_value(
        app,
        SaveTranscriptionRecordRequest {
            text,
            processed,
            method,
            agent_name,
            ..Default::default()
        },
    )
}

pub fn db_save_transcription_record_value(
    app: &AppHandle,
    request: SaveTranscriptionRecordRequest,
) -> Result<i64, String> {
    if super::privacy::should_skip_transcription_history(app) {
        eprintln!("[privacy] transcription history skipped for blacklisted application");
        return Ok(0);
    }

    let db = app.state::<Database>();
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    cleanup_expired_transcriptions(app, &conn)?;

    let id = insert_transcription_record(&mut conn, request)?;

    // Get the saved transcription to emit
    let transcription = get_transcription_by_id(&conn, id)?;

    // Emit event for frontend to update
    let _ = app.emit("transcription-added", transcription);

    Ok(id)
}

/// Get transcriptions with optional limit
#[tauri::command]
pub fn db_get_transcriptions(
    app: AppHandle,
    limit: Option<i32>,
) -> CommandResult<Vec<Transcription>> {
    db_get_transcriptions_value(&app, limit).map_err(database_error)
}

fn db_get_transcriptions_value(
    app: &AppHandle,
    limit: Option<i32>,
) -> Result<Vec<Transcription>, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    cleanup_expired_transcriptions(app, &conn)?;

    let limit = limit.unwrap_or(100);
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {TRANSCRIPTION_SELECT_COLUMNS}
             FROM transcriptions ORDER BY timestamp DESC LIMIT ?1"
        ))
        .map_err(|e| e.to_string())?;

    let transcriptions = stmt
        .query_map([limit], map_transcription)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(transcriptions)
}

fn normalized_limit(limit: Option<i32>) -> i32 {
    limit.unwrap_or(100).clamp(1, 500)
}

fn build_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn search_transcriptions_in_conn(
    conn: &Connection,
    query: &str,
    limit: Option<i32>,
) -> Result<Vec<Transcription>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {TRANSCRIPTION_SELECT_COLUMNS}
                 FROM transcriptions ORDER BY timestamp DESC LIMIT ?1"
            ))
            .map_err(|e| e.to_string())?;
        return stmt
            .query_map([normalized_limit(limit)], map_transcription)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string());
    }

    let fts_query = build_fts_query(trimmed);
    let mut stmt = conn
        .prepare(&format!(
            "SELECT t.{}
             FROM transcriptions_fts
             JOIN transcriptions t ON t.id = transcriptions_fts.rowid
             WHERE transcriptions_fts MATCH ?1
             ORDER BY bm25(transcriptions_fts), t.timestamp DESC
             LIMIT ?2",
            TRANSCRIPTION_SELECT_COLUMNS.replace(", ", ", t.")
        ))
        .map_err(|e| e.to_string())?;

    let transcriptions = stmt
        .query_map(
            params![fts_query, normalized_limit(limit)],
            map_transcription,
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(transcriptions)
}

#[tauri::command]
pub fn db_search_transcriptions(
    app: AppHandle,
    query: String,
    limit: Option<i32>,
) -> CommandResult<Vec<Transcription>> {
    db_search_transcriptions_value(&app, query, limit).map_err(database_error)
}

fn db_search_transcriptions_value(
    app: &AppHandle,
    query: String,
    limit: Option<i32>,
) -> Result<Vec<Transcription>, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    cleanup_expired_transcriptions(app, &conn)?;
    search_transcriptions_in_conn(&conn, &query, limit)
}

#[tauri::command]
pub fn db_get_transcription_outputs(
    app: AppHandle,
    transcription_id: i64,
) -> CommandResult<Vec<TranscriptionOutput>> {
    db_get_transcription_outputs_value(&app, transcription_id).map_err(database_error)
}

fn db_get_transcription_outputs_value(
    app: &AppHandle,
    transcription_id: i64,
) -> Result<Vec<TranscriptionOutput>, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, transcription_id, session_id, stage, text, metadata_json, created_at
             FROM transcription_outputs
             WHERE transcription_id = ?1
             ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;

    let outputs = stmt
        .query_map([transcription_id], map_output)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(outputs)
}

#[tauri::command]
pub fn db_get_transcription_session(
    app: AppHandle,
    session_id: String,
) -> CommandResult<Option<TranscriptionSession>> {
    db_get_transcription_session_value(&app, session_id).map_err(database_error)
}

fn db_get_transcription_session_value(
    app: &AppHandle,
    session_id: String,
) -> Result<Option<TranscriptionSession>, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.query_row(
        "SELECT id, started_at, completed_at, provider, model, language, status, error
         FROM transcription_sessions
         WHERE id = ?1",
        [session_id],
        map_session,
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_dictation_timeline_events(
    app: AppHandle,
    session_id: String,
    source: Option<String>,
    events: Vec<DictationTimelineEventInput>,
) -> CommandResult<usize> {
    db_save_dictation_timeline_events_value(&app, session_id, source, events)
        .map_err(database_error)
}

pub fn db_save_dictation_timeline_events_value(
    app: &AppHandle,
    session_id: String,
    source: Option<String>,
    events: Vec<DictationTimelineEventInput>,
) -> Result<usize, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    cleanup_expired_transcriptions(app, &conn)?;

    save_dictation_timeline_events_in_conn(
        &conn,
        &session_id,
        source.as_deref().unwrap_or("unknown"),
        &events,
    )
}

#[tauri::command]
pub fn db_get_dictation_timeline_sessions(
    app: AppHandle,
    limit: Option<i32>,
) -> CommandResult<Vec<DictationTimelineSessionRecord>> {
    db_get_dictation_timeline_sessions_value(&app, limit).map_err(database_error)
}

fn db_get_dictation_timeline_sessions_value(
    app: &AppHandle,
    limit: Option<i32>,
) -> Result<Vec<DictationTimelineSessionRecord>, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    cleanup_expired_transcriptions(app, &conn)?;
    get_dictation_timeline_sessions_in_conn(&conn, limit)
}

#[tauri::command]
pub fn db_prune_transcription_history(app: AppHandle) -> CommandResult<usize> {
    db_prune_transcription_history_value(&app).map_err(database_error)
}

fn db_prune_transcription_history_value(app: &AppHandle) -> Result<usize, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    cleanup_expired_transcriptions(app, &conn)
}

/// Delete a single transcription by ID
#[tauri::command]
pub fn db_delete_transcription(app: AppHandle, id: i64) -> CommandResult<()> {
    db_delete_transcription_value(&app, id).map_err(database_error)
}

fn db_delete_transcription_value(app: &AppHandle, id: i64) -> Result<(), String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    delete_transcription_in_conn(&conn, id)?;

    // Emit event for frontend to update
    let _ = app.emit("transcription-deleted", serde_json::json!({ "id": id }));

    Ok(())
}

fn delete_transcription_in_conn(conn: &Connection, id: i64) -> Result<(), String> {
    let session_id = conn
        .query_row(
            "SELECT session_id FROM transcriptions WHERE id = ?1",
            [id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();

    conn.execute("DELETE FROM transcriptions WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;

    if let Some(session_id) = session_id {
        conn.execute(
            "DELETE FROM transcription_sessions
             WHERE id = ?1
               AND NOT EXISTS (
                    SELECT 1 FROM transcriptions
                    WHERE transcriptions.session_id = transcription_sessions.id
               )",
            [session_id.as_str()],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "DELETE FROM dictation_timeline_sessions
             WHERE session_id = ?1
               AND NOT EXISTS (
                    SELECT 1 FROM transcriptions
                    WHERE transcriptions.session_id = dictation_timeline_sessions.session_id
               )",
            [session_id.as_str()],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Clear all transcriptions
#[tauri::command]
pub fn db_clear_transcriptions(app: AppHandle) -> CommandResult<()> {
    db_clear_transcriptions_value(&app).map_err(database_error)
}

fn db_clear_transcriptions_value(app: &AppHandle) -> Result<(), String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM transcriptions", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM transcription_sessions", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM dictation_timeline_sessions", [])
        .map_err(|e| e.to_string())?;

    // Emit event for frontend to update
    let _ = app.emit("transcriptions-cleared", ());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_create_versioned_schema() {
        let mut conn = Connection::open_in_memory().unwrap();

        run_migrations(&mut conn).unwrap();

        assert_eq!(current_user_version(&conn).unwrap(), SCHEMA_VERSION);
        assert!(column_exists(&conn, "transcriptions", "session_id").unwrap());

        let migration_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(migration_count, i64::from(SCHEMA_VERSION));
    }

    #[test]
    fn migrations_upgrade_legacy_v2_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        migration_1_base_transcriptions(&conn).unwrap();
        migration_2_sessions_outputs_fts(&conn).unwrap();
        set_user_version(&conn, 2).unwrap();

        run_migrations(&mut conn).unwrap();

        assert_eq!(current_user_version(&conn).unwrap(), SCHEMA_VERSION);
        assert!(column_exists(&conn, "transcriptions", "session_id").unwrap());
        let migration_name: String = conn
            .query_row(
                "SELECT name FROM schema_migrations WHERE version = 3",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migration_name, "link-transcriptions-to-sessions");
    }

    #[test]
    fn record_save_writes_session_outputs_and_fts() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let id = insert_transcription_record(
            &mut conn,
            SaveTranscriptionRecordRequest {
                text: "raw hello world".to_string(),
                processed: Some("polished hello world".to_string()),
                method: Some("voice-polish".to_string()),
                agent_name: Some("TypeFree".to_string()),
                session_id: Some("session-1".to_string()),
                provider: Some("openai".to_string()),
                model: Some("gpt-4o-transcribe".to_string()),
                language: Some("en".to_string()),
                status: Some("completed".to_string()),
                error: None,
                outputs: Some(vec![TranscriptionOutputInput {
                    stage: "pipeline".to_string(),
                    text: "polished hello world".to_string(),
                    metadata_json: Some("{\"stepCount\":1}".to_string()),
                }]),
            },
        )
        .unwrap();

        let transcription = get_transcription_by_id(&conn, id).unwrap();
        assert_eq!(transcription.session_id.as_deref(), Some("session-1"));
        assert_eq!(
            transcription.processed_text.as_deref(),
            Some("polished hello world")
        );

        let session: TranscriptionSession = conn
            .query_row(
                "SELECT id, started_at, completed_at, provider, model, language, status, error
                 FROM transcription_sessions WHERE id = ?1",
                ["session-1"],
                map_session,
            )
            .unwrap();
        assert_eq!(session.provider.as_deref(), Some("openai"));
        assert_eq!(session.status, "completed");
        assert!(session.completed_at.is_some());

        let output_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_outputs WHERE transcription_id = ?1",
                [id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(output_count, 3);

        let matches = search_transcriptions_in_conn(&conn, "polished", Some(10)).unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].id, id);
    }

    #[test]
    fn record_save_rolls_back_when_output_insert_fails() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();
        conn.execute("DROP TABLE transcription_outputs", [])
            .unwrap();

        let error = insert_transcription_record(
            &mut conn,
            SaveTranscriptionRecordRequest {
                text: "raw text".to_string(),
                processed: Some("processed text".to_string()),
                method: Some("voice-polish".to_string()),
                session_id: Some("session-rollback".to_string()),
                provider: Some("openai".to_string()),
                model: Some("gpt-4o-transcribe".to_string()),
                language: Some("en".to_string()),
                status: Some("completed".to_string()),
                outputs: Some(vec![TranscriptionOutputInput {
                    stage: "postprocessing".to_string(),
                    text: "processed text".to_string(),
                    metadata_json: None,
                }]),
                ..Default::default()
            },
        )
        .unwrap_err();

        assert!(
            error.contains("transcription_outputs"),
            "unexpected error: {error}"
        );

        let transcription_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM transcriptions", [], |row| row.get(0))
            .unwrap();
        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM transcription_sessions", [], |row| {
                row.get(0)
            })
            .unwrap();

        assert_eq!(transcription_count, 0);
        assert_eq!(session_count, 0);
    }

    #[test]
    fn delete_transcription_prunes_only_unreferenced_session() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let first_id = insert_transcription_record(
            &mut conn,
            SaveTranscriptionRecordRequest {
                text: "first shared session transcript".to_string(),
                session_id: Some("shared-session".to_string()),
                status: Some("completed".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        let second_id = insert_transcription_record(
            &mut conn,
            SaveTranscriptionRecordRequest {
                text: "second shared session transcript".to_string(),
                session_id: Some("shared-session".to_string()),
                status: Some("completed".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        delete_transcription_in_conn(&conn, first_id).unwrap();

        let session_count_after_first_delete: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_sessions WHERE id = 'shared-session'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(session_count_after_first_delete, 1);

        delete_transcription_in_conn(&conn, second_id).unwrap();

        let session_count_after_second_delete: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_sessions WHERE id = 'shared-session'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(session_count_after_second_delete, 0);
    }

    #[test]
    fn timeline_events_round_trip_and_retention_cleanup() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        assert!(column_exists(&conn, "dictation_timeline_sessions", "session_id").unwrap());
        assert!(column_exists(&conn, "dictation_timeline_events", "duration_ms").unwrap());

        let saved = save_dictation_timeline_events_in_conn(
            &conn,
            "backend-session",
            "backend",
            &[
                DictationTimelineEventInput {
                    kind: "state".to_string(),
                    label: "recording.stopped".to_string(),
                    status: Some("completed".to_string()),
                    phase: Some("recording".to_string()),
                    source: Some("backend".to_string()),
                    duration_ms: Some(1200),
                    detail: Some("captured".to_string()),
                    meta: Some(serde_json::json!({ "audioBytes": 10 })),
                    at: None,
                    elapsed_ms: Some(11),
                },
                DictationTimelineEventInput {
                    kind: "history".to_string(),
                    label: "history.db.completed".to_string(),
                    status: Some("completed".to_string()),
                    phase: Some("completed".to_string()),
                    source: Some("backend".to_string()),
                    duration_ms: Some(42),
                    detail: None,
                    meta: None,
                    at: None,
                    elapsed_ms: Some(42),
                },
            ],
        )
        .unwrap();

        assert_eq!(saved, 2);

        let sessions = get_dictation_timeline_sessions_in_conn(&conn, Some(10)).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "backend-session");
        assert_eq!(sessions[0].source, "backend");
        assert_eq!(sessions[0].events.len(), 2);
        assert_eq!(sessions[0].events[0].label, "recording.stopped");
        assert_eq!(sessions[0].events[0].duration_ms, Some(1200));
        assert_eq!(sessions[0].events[0].elapsed_ms, 11);
        assert_eq!(
            sessions[0].events[0]
                .meta
                .as_ref()
                .and_then(|meta| meta.get("audioBytes")),
            Some(&serde_json::json!(10))
        );
        assert_eq!(sessions[0].events[1].label, "history.db.completed");

        conn.execute(
            "UPDATE dictation_timeline_sessions
             SET updated_at = datetime('now', '-60 days')
             WHERE session_id = 'backend-session'",
            [],
        )
        .unwrap();

        let cleanup = cleanup_expired_transcriptions_in_conn(&conn, 30).unwrap();
        assert_eq!(cleanup.timeline_sessions_deleted, 1);

        let remaining_sessions = get_dictation_timeline_sessions_in_conn(&conn, Some(10)).unwrap();
        assert!(remaining_sessions.is_empty());

        let remaining_events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM dictation_timeline_events",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining_events, 0);
    }

    #[test]
    fn retention_cleanup_prunes_outputs_fts_and_orphan_final_sessions() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&mut conn).unwrap();

        let expired_id = insert_transcription_record(
            &mut conn,
            SaveTranscriptionRecordRequest {
                text: "expired private transcript".to_string(),
                processed: Some("expired polished transcript".to_string()),
                method: Some("voice-polish".to_string()),
                session_id: Some("expired-session".to_string()),
                provider: Some("openai".to_string()),
                status: Some("completed".to_string()),
                outputs: Some(vec![TranscriptionOutputInput {
                    stage: "pipeline".to_string(),
                    text: "expired polished transcript".to_string(),
                    metadata_json: None,
                }]),
                ..Default::default()
            },
        )
        .unwrap();
        let retained_id = insert_transcription_record(
            &mut conn,
            SaveTranscriptionRecordRequest {
                text: "fresh transcript".to_string(),
                session_id: Some("fresh-session".to_string()),
                provider: Some("openai".to_string()),
                status: Some("completed".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        conn.execute(
            "UPDATE transcriptions SET timestamp = datetime('now', '-60 days') WHERE id = ?1",
            [expired_id],
        )
        .unwrap();
        conn.execute(
            "UPDATE transcription_sessions
             SET started_at = datetime('now', '-60 days'),
                 completed_at = datetime('now', '-60 days')
             WHERE id = 'expired-session'",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO transcription_sessions (id, started_at, status)
             VALUES ('old-recording-session', datetime('now', '-60 days'), 'recording')",
            [],
        )
        .unwrap();

        let cleanup = cleanup_expired_transcriptions_in_conn(&conn, 30).unwrap();

        assert_eq!(cleanup.transcriptions_deleted, 1);
        assert_eq!(cleanup.sessions_deleted, 1);

        let transcription_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM transcriptions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(transcription_count, 1);
        assert_eq!(
            get_transcription_by_id(&conn, retained_id).unwrap().id,
            retained_id
        );

        let expired_output_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_outputs WHERE transcription_id = ?1",
                [expired_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(expired_output_count, 0);

        let expired_matches =
            search_transcriptions_in_conn(&conn, "expired", Some(10)).expect("search expired");
        assert!(expired_matches.is_empty());

        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM transcription_sessions", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(session_count, 2);
        let active_orphan_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM transcription_sessions WHERE id = 'old-recording-session'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(active_orphan_exists, 1);
    }
}
