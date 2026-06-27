use std::{fs, io, path::Path};
use tauri::{AppHandle, Manager};

const LEGACY_APP_IDENTIFIER: &str = "com.typefree.app";

pub fn migrate_legacy_app_data_dirs(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let current_identifier = app.config().identifier.as_str();
    if current_identifier == LEGACY_APP_IDENTIFIER {
        return Ok(());
    }

    let data_dir = app.path().data_dir()?;
    let legacy_dir = data_dir.join(LEGACY_APP_IDENTIFIER);
    let current_dir = app.path().app_data_dir()?;

    let local_data_dir = app.path().local_data_dir()?;
    let legacy_local_dir = local_data_dir.join(LEGACY_APP_IDENTIFIER);
    let current_local_dir = app.path().app_local_data_dir()?;

    copy_missing_entries_from_legacy_dir(&legacy_dir, &current_dir)?;
    copy_missing_entries_from_legacy_dir(&legacy_local_dir, &current_local_dir)?;
    Ok(())
}

fn copy_missing_entries_from_legacy_dir(legacy_dir: &Path, current_dir: &Path) -> io::Result<()> {
    if !legacy_dir.is_dir() || legacy_dir == current_dir {
        return Ok(());
    }

    fs::create_dir_all(current_dir)?;
    copy_missing_entries(legacy_dir, current_dir)
}

fn copy_missing_entries(source_dir: &Path, target_dir: &Path) -> io::Result<()> {
    for entry in fs::read_dir(source_dir)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target_dir.join(entry.file_name());
        let file_type = entry.file_type()?;

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            fs::create_dir_all(&target_path)?;
            copy_missing_entries(&source_path, &target_path)?;
        } else if file_type.is_file() && !target_path.exists() {
            fs::copy(&source_path, &target_path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_dir(name: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after UNIX_EPOCH")
            .as_nanos();
        std::env::temp_dir().join(format!("typefree-app-data-migration-{name}-{suffix}"))
    }

    #[test]
    fn copies_missing_legacy_entries_without_overwriting_current_data() {
        let root = test_dir("copy");
        let legacy_dir = root.join("legacy");
        let current_dir = root.join("current");

        fs::create_dir_all(legacy_dir.join("clipboard-images")).unwrap();
        fs::create_dir_all(&current_dir).unwrap();
        fs::write(legacy_dir.join("settings.json"), "legacy").unwrap();
        fs::write(legacy_dir.join("transcriptions.db"), "db").unwrap();
        fs::write(legacy_dir.join("clipboard-images").join("clip.png"), "png").unwrap();
        fs::write(current_dir.join("settings.json"), "current").unwrap();
        fs::create_dir_all(current_dir.join("clipboard-images")).unwrap();

        copy_missing_entries_from_legacy_dir(&legacy_dir, &current_dir).unwrap();

        assert_eq!(
            fs::read_to_string(current_dir.join("settings.json")).unwrap(),
            "current"
        );
        assert_eq!(
            fs::read_to_string(current_dir.join("transcriptions.db")).unwrap(),
            "db"
        );
        assert_eq!(
            fs::read_to_string(current_dir.join("clipboard-images").join("clip.png")).unwrap(),
            "png"
        );
        assert!(legacy_dir.exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_legacy_dir_is_a_noop() {
        let root = test_dir("missing");
        let legacy_dir = root.join("legacy");
        let current_dir = root.join("current");

        copy_missing_entries_from_legacy_dir(&legacy_dir, &current_dir).unwrap();

        assert!(!current_dir.exists());

        let _ = fs::remove_dir_all(root);
    }
}
