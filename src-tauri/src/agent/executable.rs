//! Locates the user's `codex` CLI.
//!
//! GUI apps launched from Finder/Dock do not inherit the login shell PATH, and Node version
//! managers (fnm, nvm, volta) install CLIs into per-version or even per-shell directories. We
//! therefore probe the inherited PATH, common install prefixes, and version-manager trees, and
//! build a child PATH that keeps the executable's own directory first so `#!/usr/bin/env node`
//! shebangs resolve to the Node that installed it.

use std::cmp::Ordering;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ResolvedExecutable {
    pub path: PathBuf,
    /// PATH value for the child process.
    pub child_path: OsString,
    /// Where the executable was found: "setting", "path", or "probe".
    pub source: &'static str,
}

#[cfg(windows)]
const EXECUTABLE_NAMES: &[&str] = &["codex.exe", "codex.cmd"];
#[cfg(not(windows))]
const EXECUTABLE_NAMES: &[&str] = &["codex"];

pub fn resolve_codex(configured: Option<&str>) -> Result<ResolvedExecutable, String> {
    let home = dirs::home_dir();
    let inherited = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    resolve_with(
        configured,
        home.as_deref(),
        &inherited,
        &system_directories(),
    )
}

fn resolve_with(
    configured: Option<&str>,
    home: Option<&Path>,
    inherited: &[PathBuf],
    system_dirs: &[PathBuf],
) -> Result<ResolvedExecutable, String> {
    let mut probe_dirs = probe_directories(home);
    probe_dirs.extend(system_dirs.iter().cloned());

    if let Some(configured) = configured.map(str::trim).filter(|value| !value.is_empty()) {
        let path = expand_home(configured, home);
        if !is_executable_file(&path) {
            return Err(format!(
                "Codex executable not found at configured path: {}",
                path.display()
            ));
        }
        let child_path = build_child_path(path.parent(), inherited, &probe_dirs);
        return Ok(ResolvedExecutable {
            path,
            child_path,
            source: "setting",
        });
    }

    let candidates = inherited
        .iter()
        .map(|dir| (dir, "path"))
        .chain(probe_dirs.iter().map(|dir| (dir, "probe")));
    for (dir, source) in candidates {
        for name in EXECUTABLE_NAMES {
            let path = dir.join(name);
            if is_executable_file(&path) {
                let child_path = build_child_path(Some(dir), inherited, &probe_dirs);
                return Ok(ResolvedExecutable {
                    path,
                    child_path,
                    source,
                });
            }
        }
    }

    Err("Codex CLI not found. Install it with `npm install -g @openai/codex` or set its path in TypeFree settings.".to_string())
}

fn expand_home(value: &str, home: Option<&Path>) -> PathBuf {
    match (value.strip_prefix("~/"), home) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => PathBuf::from(value),
    }
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Install prefixes and version-manager bin directories, newest Node first.
fn probe_directories(home: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home {
        for relative in [
            ".local/bin",
            "bin",
            ".npm-global/bin",
            ".bun/bin",
            ".volta/bin",
            "Library/pnpm",
            ".cargo/bin",
        ] {
            dirs.push(home.join(relative));
        }
        for (root, suffix) in [
            (
                home.join(".local/share/fnm/node-versions"),
                "installation/bin",
            ),
            (
                home.join("Library/Application Support/fnm/node-versions"),
                "installation/bin",
            ),
            (home.join(".nvm/versions/node"), "bin"),
        ] {
            dirs.extend(
                versioned_subdirectories(&root)
                    .into_iter()
                    .map(|dir| dir.join(suffix)),
            );
        }
        #[cfg(windows)]
        dirs.push(home.join("AppData/Roaming/npm"));
    }
    dirs
}

fn system_directories() -> Vec<PathBuf> {
    #[cfg(not(windows))]
    {
        ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
            .into_iter()
            .map(PathBuf::from)
            .collect()
    }
    #[cfg(windows)]
    {
        Vec::new()
    }
}

fn versioned_subdirectories(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort_by(|a, b| compare_versions_desc(a, b));
    dirs
}

fn version_key(path: &Path) -> Vec<u64> {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .trim_start_matches('v')
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse().ok())
        .collect()
}

fn compare_versions_desc(a: &Path, b: &Path) -> Ordering {
    version_key(b).cmp(&version_key(a))
}

fn build_child_path(
    executable_dir: Option<&Path>,
    inherited: &[PathBuf],
    probe_dirs: &[PathBuf],
) -> OsString {
    let mut ordered: Vec<PathBuf> = Vec::new();
    let mut push = |dir: &Path| {
        if !dir.as_os_str().is_empty() && !ordered.iter().any(|existing| existing == dir) {
            ordered.push(dir.to_path_buf());
        }
    };
    if let Some(dir) = executable_dir {
        push(dir);
    }
    for dir in inherited {
        push(dir);
    }
    for dir in probe_dirs.iter().filter(|dir| dir.is_dir()) {
        push(dir);
    }
    std::env::join_paths(ordered).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "typefree-agent-exe-{}-{}",
            name,
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_executable(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    #[test]
    fn version_directories_sort_newest_first() {
        let mut dirs = vec![
            PathBuf::from("v9.11.2"),
            PathBuf::from("v22.22.0"),
            PathBuf::from("v22.3.1"),
        ];
        dirs.sort_by(|a, b| compare_versions_desc(a, b));
        assert_eq!(
            dirs,
            vec![
                PathBuf::from("v22.22.0"),
                PathBuf::from("v22.3.1"),
                PathBuf::from("v9.11.2"),
            ]
        );
    }

    #[cfg(unix)]
    #[test]
    fn finds_codex_in_fnm_tree_and_puts_its_dir_first_on_child_path() {
        let home = temp_dir("fnm");
        let old = home.join(".local/share/fnm/node-versions/v18.0.0/installation/bin/codex");
        let new = home.join(".local/share/fnm/node-versions/v22.22.0/installation/bin/codex");
        write_executable(&old);
        write_executable(&new);

        let resolved = resolve_with(None, Some(&home), &[], &[]).unwrap();
        assert_eq!(resolved.path, new);
        assert_eq!(resolved.source, "probe");
        let first = std::env::split_paths(&resolved.child_path).next().unwrap();
        assert_eq!(first, new.parent().unwrap());
        let _ = std::fs::remove_dir_all(home);
    }

    #[cfg(unix)]
    #[test]
    fn inherited_path_wins_over_probe_directories() {
        let home = temp_dir("inherited");
        let on_path = home.join("custom/bin/codex");
        write_executable(&on_path);
        write_executable(&home.join(".local/bin/codex"));

        let resolved = resolve_with(
            None,
            Some(&home),
            &[on_path.parent().unwrap().to_path_buf()],
            &[],
        )
        .unwrap();
        assert_eq!(resolved.path, on_path);
        assert_eq!(resolved.source, "path");
        let _ = std::fs::remove_dir_all(home);
    }

    #[cfg(unix)]
    #[test]
    fn configured_path_supports_home_expansion_and_rejects_missing_files() {
        let home = temp_dir("configured");
        let configured = home.join("tools/codex");
        write_executable(&configured);

        let resolved = resolve_with(Some("~/tools/codex"), Some(&home), &[], &[]).unwrap();
        assert_eq!(resolved.path, configured);
        assert_eq!(resolved.source, "setting");

        let missing = resolve_with(Some("~/tools/missing"), Some(&home), &[], &[]);
        assert!(missing.unwrap_err().contains("configured path"));
        let _ = std::fs::remove_dir_all(home);
    }

    #[cfg(unix)]
    #[test]
    fn non_executable_files_are_ignored() {
        let home = temp_dir("nonexec");
        let path = home.join(".local/bin/codex");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "not executable").unwrap();

        assert!(resolve_with(None, Some(&home), &[], &[]).is_err());
        let _ = std::fs::remove_dir_all(home);
    }
}
