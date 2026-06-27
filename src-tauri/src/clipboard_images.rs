use arboard::ImageData;
use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImageMetadata {
    pub width: u32,
    pub height: u32,
    pub byte_size: usize,
    pub mime_type: String,
}

#[derive(Debug, Clone)]
pub struct ClipboardImageRef {
    pub hash: u64,
    pub blob_path: String,
    pub thumb_path: String,
    pub metadata: ClipboardImageMetadata,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoredClipboardImage {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub content: String,
    pub ts_ms: u64,
    pub blob_path: String,
    pub thumb_path: String,
    pub metadata: ClipboardImageMetadata,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

pub fn hash_image_data(img: &ImageData<'static>) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    img.width.hash(&mut hasher);
    img.height.hash(&mut hasher);
    img.bytes.len().hash(&mut hasher);
    if !img.bytes.is_empty() {
        img.bytes[0].hash(&mut hasher);
        img.bytes[img.bytes.len() / 2].hash(&mut hasher);
        img.bytes[img.bytes.len() - 1].hash(&mut hasher);
    }
    hasher.finish()
}

fn hash_rgba(width: u32, height: u32, bytes: &[u8]) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    width.hash(&mut hasher);
    height.hash(&mut hasher);
    bytes.len().hash(&mut hasher);
    if !bytes.is_empty() {
        bytes[0].hash(&mut hasher);
        bytes[bytes.len() / 2].hash(&mut hasher);
        bytes[bytes.len() - 1].hash(&mut hasher);
    }
    hasher.finish()
}

fn clipboard_image_dirs(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let image_dir = app_data_dir.join("clipboard-images");
    let thumb_dir = image_dir.join("thumbs");
    fs::create_dir_all(&thumb_dir).map_err(|e| e.to_string())?;
    Ok((image_dir, thumb_dir))
}

fn write_image_ref(
    app: &AppHandle,
    dyn_img: image::DynamicImage,
    ts_ms: u64,
    hash: u64,
) -> Result<ClipboardImageRef, String> {
    let width = dyn_img.width();
    let height = dyn_img.height();

    let mut png_bytes = Vec::new();
    dyn_img
        .write_to(&mut Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode clipboard image: {e}"))?;

    let thumb = dyn_img.thumbnail(320, 320);
    let mut thumb_bytes = Vec::new();
    thumb
        .write_to(&mut Cursor::new(&mut thumb_bytes), image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode clipboard image thumbnail: {e}"))?;

    let (image_dir, thumb_dir) = clipboard_image_dirs(app)?;
    let file_stem = format!("{ts_ms}-{hash}");
    let blob_path = image_dir.join(format!("{file_stem}.png"));
    let thumb_path = thumb_dir.join(format!("{file_stem}.png"));
    fs::write(&blob_path, &png_bytes).map_err(|e| e.to_string())?;
    fs::write(&thumb_path, &thumb_bytes).map_err(|e| e.to_string())?;

    Ok(ClipboardImageRef {
        hash,
        blob_path: blob_path.to_string_lossy().to_string(),
        thumb_path: thumb_path.to_string_lossy().to_string(),
        metadata: ClipboardImageMetadata {
            width,
            height,
            byte_size: png_bytes.len(),
            mime_type: "image/png".to_string(),
        },
    })
}

pub fn image_data_to_file_ref(
    app: &AppHandle,
    img: ImageData<'static>,
    ts_ms: u64,
    hash: u64,
) -> Result<ClipboardImageRef, String> {
    let width = img.width as u32;
    let height = img.height as u32;
    let rgba = image::RgbaImage::from_raw(width, height, img.into_owned_bytes().into_owned())
        .ok_or_else(|| "Invalid clipboard image buffer".to_string())?;
    write_image_ref(app, image::DynamicImage::ImageRgba8(rgba), ts_ms, hash)
}

pub fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let trimmed = data_url.trim();
    let payload = match trimmed.find(',') {
        Some(idx) => &trimmed[idx + 1..],
        None => trimmed,
    };
    general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("Failed to decode base64: {e}"))
}

pub fn decode_image_source(source: &str) -> Result<Vec<u8>, String> {
    let trimmed = source.trim();
    if trimmed.is_empty() {
        return Err("Image source is empty".to_string());
    }

    if trimmed.starts_with("data:") {
        return decode_data_url(trimmed);
    }

    let path = Path::new(trimmed);
    if path.exists() {
        return fs::read(path).map_err(|e| format!("Failed to read image file: {e}"));
    }

    decode_data_url(trimmed)
}

pub fn persist_image_source(
    app: &AppHandle,
    source: &str,
    id: Option<String>,
    ts_ms: Option<u64>,
) -> Result<StoredClipboardImage, String> {
    let image_bytes = decode_image_source(source)?;
    let dyn_img = image::load_from_memory(&image_bytes)
        .map_err(|e| format!("Failed to decode image: {e}"))?;
    let rgba = dyn_img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let hash = hash_rgba(width, height, rgba.as_raw());
    let ts_ms = ts_ms.unwrap_or_else(now_ms);
    let image_ref = write_image_ref(app, image::DynamicImage::ImageRgba8(rgba), ts_ms, hash)?;

    Ok(StoredClipboardImage {
        id: id.unwrap_or_else(|| format!("{ts_ms}-{hash}")),
        item_type: "image".to_string(),
        content: image_ref.thumb_path.clone(),
        ts_ms,
        blob_path: image_ref.blob_path,
        thumb_path: image_ref.thumb_path,
        metadata: image_ref.metadata,
    })
}

pub fn delete_image_files(app: &AppHandle, paths: &[String]) -> Result<usize, String> {
    let (image_dir, _) = clipboard_image_dirs(app)?;
    delete_image_files_under_root(&image_dir, paths)
}

fn delete_image_files_under_root(image_dir: &Path, paths: &[String]) -> Result<usize, String> {
    let image_root = fs::canonicalize(image_dir).unwrap_or_else(|_| image_dir.to_path_buf());
    let mut deleted = 0;

    for raw_path in paths {
        if let Some(canonical) = clipboard_image_delete_candidate(&image_root, raw_path) {
            fs::remove_file(&canonical).map_err(|e| e.to_string())?;
            deleted += 1;
        }
    }

    Ok(deleted)
}

fn clipboard_image_delete_candidate(image_root: &Path, raw_path: &str) -> Option<PathBuf> {
    let path = PathBuf::from(raw_path);
    let canonical = fs::canonicalize(path).ok()?;
    if canonical.starts_with(image_root) && canonical.is_file() {
        Some(canonical)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "typefree-clipboard-images-{name}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    fn path_string(path: &Path) -> String {
        path.to_string_lossy().to_string()
    }

    #[test]
    fn delete_image_files_under_root_deletes_blob_and_thumb_files() {
        let base = test_dir("delete-owned");
        let image_root = base.join("clipboard-images");
        let thumb_root = image_root.join("thumbs");
        fs::create_dir_all(&thumb_root).expect("create image dirs");

        let blob = image_root.join("blob.png");
        let thumb = thumb_root.join("thumb.png");
        fs::write(&blob, b"blob").expect("write blob");
        fs::write(&thumb, b"thumb").expect("write thumb");

        let deleted =
            delete_image_files_under_root(&image_root, &[path_string(&blob), path_string(&thumb)])
                .expect("delete files");

        assert_eq!(deleted, 2);
        assert!(!blob.exists());
        assert!(!thumb.exists());

        fs::remove_dir_all(base).expect("cleanup");
    }

    #[test]
    fn delete_image_files_under_root_skips_external_missing_and_directory_paths() {
        let base = test_dir("skip-external");
        let image_root = base.join("clipboard-images");
        fs::create_dir_all(&image_root).expect("create image root");

        let outside = base.join("outside.png");
        fs::write(&outside, b"outside").expect("write outside");

        let deleted = delete_image_files_under_root(
            &image_root,
            &[
                path_string(&outside),
                path_string(&base.join("missing.png")),
                path_string(&image_root),
            ],
        )
        .expect("delete files");

        assert_eq!(deleted, 0);
        assert!(outside.exists());
        assert!(image_root.exists());

        fs::remove_dir_all(base).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn delete_image_files_under_root_skips_symlink_escape() {
        use std::os::unix::fs::symlink;

        let base = test_dir("skip-symlink");
        let image_root = base.join("clipboard-images");
        fs::create_dir_all(&image_root).expect("create image root");

        let outside = base.join("outside.png");
        let link = image_root.join("linked-outside.png");
        fs::write(&outside, b"outside").expect("write outside");
        symlink(&outside, &link).expect("create symlink");

        let deleted = delete_image_files_under_root(&image_root, &[path_string(&link)])
            .expect("delete files");

        assert_eq!(deleted, 0);
        assert!(outside.exists());
        assert!(link.exists());

        fs::remove_dir_all(base).expect("cleanup");
    }
}
