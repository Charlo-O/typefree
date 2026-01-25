use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

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
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &str) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        Ok(Database {
            conn: Mutex::new(conn),
        })
    }
}

/// Initialize database on app startup
pub fn init_database(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&app_data_dir)?;

    let db_path = app_data_dir.join("transcriptions.db");
    let conn = Connection::open(&db_path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS transcriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            original_text TEXT NOT NULL,
            processed_text TEXT,
            is_processed BOOLEAN DEFAULT 0,
            processing_method TEXT DEFAULT 'none',
            agent_name TEXT,
            error TEXT
        )",
        [],
    )?;

    app.manage(Database::new(db_path.to_str().unwrap())?);
    Ok(())
}

/// Save a new transcription
#[tauri::command]
pub fn db_save_transcription(
    app: AppHandle,
    text: String,
    processed: Option<String>,
    method: Option<String>,
    agent_name: Option<String>,
) -> Result<i64, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let is_processed = processed.is_some();
    let processing_method = method.clone().unwrap_or_else(|| "none".to_string());

    conn.execute(
        "INSERT INTO transcriptions (original_text, processed_text, is_processed, processing_method, agent_name)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![text, processed, is_processed, processing_method, agent_name],
    ).map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    // Get the saved transcription to emit
    let transcription = conn
        .query_row(
            "SELECT id, timestamp, original_text, processed_text, is_processed, processing_method, agent_name, error 
             FROM transcriptions WHERE id = ?1",
            [id],
            |row| {
                Ok(Transcription {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    original_text: row.get(2)?,
                    processed_text: row.get(3)?,
                    is_processed: row.get(4)?,
                    processing_method: row.get(5)?,
                    agent_name: row.get(6)?,
                    error: row.get(7)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    // Emit event for frontend to update
    let _ = app.emit("transcription-added", transcription);

    Ok(id)
}

/// Get transcriptions with optional limit
#[tauri::command]
pub fn db_get_transcriptions(
    app: AppHandle,
    limit: Option<i32>,
) -> Result<Vec<Transcription>, String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let limit = limit.unwrap_or(100);
    let mut stmt = conn
        .prepare("SELECT id, timestamp, original_text, processed_text, is_processed, processing_method, agent_name, error 
                  FROM transcriptions ORDER BY timestamp DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;

    let transcriptions = stmt
        .query_map([limit], |row| {
            Ok(Transcription {
                id: row.get(0)?,
                timestamp: row.get(1)?,
                original_text: row.get(2)?,
                processed_text: row.get(3)?,
                is_processed: row.get(4)?,
                processing_method: row.get(5)?,
                agent_name: row.get(6)?,
                error: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(transcriptions)
}

/// Delete a single transcription by ID
#[tauri::command]
pub fn db_delete_transcription(app: AppHandle, id: i64) -> Result<(), String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM transcriptions WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;

    // Emit event for frontend to update
    let _ = app.emit("transcription-deleted", serde_json::json!({ "id": id }));

    Ok(())
}

/// Clear all transcriptions
#[tauri::command]
pub fn db_clear_transcriptions(app: AppHandle) -> Result<(), String> {
    let db = app.state::<Database>();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM transcriptions", [])
        .map_err(|e| e.to_string())?;

    // Emit event for frontend to update
    let _ = app.emit("transcriptions-cleared", ());

    Ok(())
}
