use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::thread;
use std::time::Duration;

use arboard::Clipboard;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::clipboard_images::{
    hash_image_data, image_data_to_file_ref, now_ms, ClipboardImageMetadata,
};

#[derive(Serialize, Clone)]
pub struct ClipboardUpdate {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub content: String,
    pub ts_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none", rename = "blobPath")]
    pub blob_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "thumbPath")]
    pub thumb_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<ClipboardImageMetadata>,
}

fn hash_text(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

pub fn start(app: AppHandle) {
    thread::spawn(move || {
        let clipboard = Clipboard::new();
        if clipboard.is_err() {
            eprintln!("Failed to init clipboard: {:?}", clipboard.err());
            return;
        }
        let mut clipboard = clipboard.unwrap();

        let mut last_text = String::new();
        let mut last_image_hash: u64 = 0;

        // Emit current clipboard content on startup so UI can populate quickly.
        if let Ok(content) = clipboard.get_text() {
            if !content.is_empty() {
                last_text = content.clone();
                if crate::commands::privacy::should_skip_clipboard_capture(&app) {
                    eprintln!("[privacy] startup clipboard text capture skipped");
                } else {
                    let hash = hash_text(&content);
                    let ts_ms = now_ms();
                    let _ = app.emit(
                        "clipboard-update",
                        ClipboardUpdate {
                            id: format!("{ts_ms}-{hash}"),
                            item_type: "text".to_string(),
                            content,
                            ts_ms,
                            blob_path: None,
                            thumb_path: None,
                            metadata: None,
                        },
                    );
                }
            }
        } else if let Ok(img) = clipboard.get_image() {
            let ts_ms = now_ms();
            let hash = hash_image_data(&img);
            if crate::commands::privacy::should_skip_clipboard_capture(&app) {
                last_image_hash = hash;
                eprintln!("[privacy] startup clipboard image capture skipped");
            } else if let Ok(image_ref) = image_data_to_file_ref(&app, img, ts_ms, hash) {
                last_image_hash = image_ref.hash;
                let _ = app.emit(
                    "clipboard-update",
                    ClipboardUpdate {
                        id: format!("{}-{}", ts_ms, image_ref.hash),
                        item_type: "image".to_string(),
                        content: image_ref.thumb_path.clone(),
                        ts_ms,
                        blob_path: Some(image_ref.blob_path),
                        thumb_path: Some(image_ref.thumb_path),
                        metadata: Some(image_ref.metadata),
                    },
                );
            }
        }

        loop {
            if let Ok(content) = clipboard.get_text() {
                if content != last_text && !content.is_empty() {
                    last_text = content.clone();
                    last_image_hash = 0;
                    if crate::commands::privacy::should_skip_clipboard_capture(&app) {
                        eprintln!("[privacy] clipboard text capture skipped");
                        thread::sleep(Duration::from_millis(500));
                        continue;
                    }
                    let hash = hash_text(&content);
                    let ts_ms = now_ms();
                    let _ = app.emit(
                        "clipboard-update",
                        ClipboardUpdate {
                            id: format!("{ts_ms}-{hash}"),
                            item_type: "text".to_string(),
                            content,
                            ts_ms,
                            blob_path: None,
                            thumb_path: None,
                            metadata: None,
                        },
                    );
                }
            } else if let Ok(img) = clipboard.get_image() {
                let hash = hash_image_data(&img);
                if hash == last_image_hash {
                    thread::sleep(Duration::from_millis(500));
                    continue;
                }

                let ts_ms = now_ms();
                if crate::commands::privacy::should_skip_clipboard_capture(&app) {
                    last_image_hash = hash;
                    last_text.clear();
                    eprintln!("[privacy] clipboard image capture skipped");
                    thread::sleep(Duration::from_millis(500));
                    continue;
                }
                if let Ok(image_ref) = image_data_to_file_ref(&app, img, ts_ms, hash) {
                    last_image_hash = image_ref.hash;
                    last_text.clear();
                    let _ = app.emit(
                        "clipboard-update",
                        ClipboardUpdate {
                            id: format!("{}-{}", ts_ms, image_ref.hash),
                            item_type: "image".to_string(),
                            content: image_ref.thumb_path.clone(),
                            ts_ms,
                            blob_path: Some(image_ref.blob_path),
                            thumb_path: Some(image_ref.thumb_path),
                            metadata: Some(image_ref.metadata),
                        },
                    );
                }
            }

            thread::sleep(Duration::from_millis(500));
        }
    });
}
