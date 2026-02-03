use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use arboard::{Clipboard, ImageData};
use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct ClipboardUpdate {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub content: String,
    pub ts_ms: u128,
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn hash_text(text: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    hasher.finish()
}

fn image_to_data_url(img: ImageData<'static>) -> Option<(u64, String)> {
    let mut hasher = DefaultHasher::new();
    img.width.hash(&mut hasher);
    img.height.hash(&mut hasher);
    img.bytes.len().hash(&mut hasher);
    if !img.bytes.is_empty() {
        img.bytes[0].hash(&mut hasher);
        img.bytes[img.bytes.len() / 2].hash(&mut hasher);
        img.bytes[img.bytes.len() - 1].hash(&mut hasher);
    }
    let hash = hasher.finish();

    let rgba = image::RgbaImage::from_raw(
        img.width as u32,
        img.height as u32,
        img.into_owned_bytes().into_owned(),
    )?;

    let mut png_bytes = Vec::new();
    let dyn_img = image::DynamicImage::ImageRgba8(rgba);
    dyn_img
        .write_to(&mut Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .ok()?;
    let b64 = general_purpose::STANDARD.encode(png_bytes);
    let data_url = format!("data:image/png;base64,{b64}");
    Some((hash, data_url))
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
                let hash = hash_text(&content);
                let ts_ms = now_ms();
                let _ = app.emit(
                    "clipboard-update",
                    ClipboardUpdate {
                        id: format!("{ts_ms}-{hash}"),
                        item_type: "text".to_string(),
                        content,
                        ts_ms,
                    },
                );
            }
        } else if let Ok(img) = clipboard.get_image() {
            if let Some((hash, data_url)) = image_to_data_url(img) {
                last_image_hash = hash;
                let ts_ms = now_ms();
                let _ = app.emit(
                    "clipboard-update",
                    ClipboardUpdate {
                        id: format!("{ts_ms}-{hash}"),
                        item_type: "image".to_string(),
                        content: data_url,
                        ts_ms,
                    },
                );
            }
        }

        loop {
            if let Ok(content) = clipboard.get_text() {
                if content != last_text && !content.is_empty() {
                    last_text = content.clone();
                    let hash = hash_text(&content);
                    let ts_ms = now_ms();
                    let _ = app.emit(
                        "clipboard-update",
                        ClipboardUpdate {
                            id: format!("{ts_ms}-{hash}"),
                            item_type: "text".to_string(),
                            content,
                            ts_ms,
                        },
                    );
                }
            } else if let Ok(img) = clipboard.get_image() {
                if let Some((hash, data_url)) = image_to_data_url(img) {
                    if hash != last_image_hash {
                        last_image_hash = hash;
                        last_text.clear();
                        let ts_ms = now_ms();
                        let _ = app.emit(
                            "clipboard-update",
                            ClipboardUpdate {
                                id: format!("{ts_ms}-{hash}"),
                                item_type: "image".to_string(),
                                content: data_url,
                                ts_ms,
                            },
                        );
                    }
                }
            }

            thread::sleep(Duration::from_millis(500));
        }
    });
}
