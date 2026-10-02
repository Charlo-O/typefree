use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// Staging directory, relative to `src-tauri/`, that the platform bundle
/// configs (`tauri.{windows,macos,linux}.conf.json`) ship as resources.
const LLAMA_RUNTIME_STAGING: &str = "target/llama-runtime";

/// Shared libraries produced by the llama-cpp-sys `dynamic-link` build.
///
/// Windows ships every DLL from `bin/`. On macOS/Linux the build installs a
/// chain such as `libllama.so -> libllama.so.0 -> libllama.so.0.4.1`; only the
/// single-major name (the soname / install name the loader looks up) is
/// shipped, falling back to the unversioned name for unversioned libraries.
fn llama_runtime_libraries(root: &Path, target_os: &str) -> Vec<(PathBuf, String)> {
    let lib_dir = root.join(if target_os == "windows" { "bin" } else { "lib" });
    let Ok(entries) = fs::read_dir(&lib_dir) else {
        return Vec::new();
    };

    let mut chosen: BTreeMap<String, (usize, PathBuf, String)> = BTreeMap::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let name = name.to_string();
        let parsed = match target_os {
            "windows" => name
                .strip_suffix(".dll")
                .map(|stem| (stem.to_string(), 1)),
            "macos" => name.strip_suffix(".dylib").map(|stem| {
                let mut parts = stem.split('.');
                let base = parts.next().unwrap_or_default().to_string();
                (base, parts.count())
            }),
            _ => name.split_once(".so").and_then(|(base, rest)| {
                (rest.is_empty() || rest.starts_with('.')).then(|| {
                    (
                        base.to_string(),
                        rest.split('.').filter(|part| !part.is_empty()).count(),
                    )
                })
            }),
        };
        let Some((base, versions)) = parsed else {
            continue;
        };
        let rank = match versions {
            1 => 0,
            0 => 1,
            n => n,
        };
        if chosen
            .get(&base)
            .map_or(true, |(best, _, _)| rank < *best)
        {
            chosen.insert(base, (rank, path, name));
        }
    }

    chosen
        .into_values()
        .map(|(_, path, name)| (path, name))
        .collect()
}

fn copy_file(source: &Path, target: &Path) {
    // fs::copy follows symlinks, so staged files are real libraries.
    if let Err(error) = fs::copy(source, target) {
        println!(
            "cargo:warning=failed to copy llama.cpp runtime {} -> {}: {error}",
            source.display(),
            target.display()
        );
    }
}

/// Stage the llama.cpp runtime for bundling and, on Windows, place the DLLs
/// next to the dev binary so `tauri dev` and `cargo test` can load them.
fn stage_llama_runtime() {
    let Ok(root) = env::var("DEP_LLAMA_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let staging = manifest_dir.join(LLAMA_RUNTIME_STAGING);

    println!("cargo:rerun-if-env-changed=DEP_LLAMA_ROOT");
    println!(
        "cargo:rerun-if-changed={}",
        root.join(if target_os == "windows" { "bin" } else { "lib" })
            .display()
    );

    // Recreate the staging dir so libraries from another feature set (e.g. a
    // stale ggml-vulkan.dll) never leak into a bundle.
    let _ = fs::remove_dir_all(&staging);
    if let Err(error) = fs::create_dir_all(&staging) {
        println!(
            "cargo:warning=failed to create llama.cpp staging dir {}: {error}",
            staging.display()
        );
        return;
    }

    // OUT_DIR = target/[<triple>/]{debug,release}/build/typefree-<hash>/out.
    let profile_dir = env::var("OUT_DIR")
        .ok()
        .and_then(|out_dir| Path::new(&out_dir).ancestors().nth(3).map(Path::to_path_buf));

    for (source, name) in llama_runtime_libraries(&root, &target_os) {
        copy_file(&source, &staging.join(&name));
        if target_os == "windows" {
            if let Some(profile_dir) = &profile_dir {
                copy_file(&source, &profile_dir.join(&name));
                copy_file(&source, &profile_dir.join("deps").join(&name));
            }
        }
    }

    // Load-time lookup paths for the shipped libraries. Windows needs none:
    // the bundle places the DLLs beside the executable.
    let rpaths: &[&str] = match target_os.as_str() {
        // Bundle: Contents/MacOS/<bin> -> Contents/Resources/llama.
        "macos" => &["@executable_path", "@executable_path/../Resources/llama"],
        // Bundle: /usr/bin/<bin> -> /usr/lib/<name>/llama (deb, rpm, AppImage).
        "linux" => &[
            "$ORIGIN",
            "$ORIGIN/../lib/typefree/llama",
            "$ORIGIN/../lib/Typefree/llama",
        ],
        _ => &[],
    };
    if target_os == "linux" {
        // Emit DT_RPATH instead of DT_RUNPATH: RUNPATH is not consulted for
        // transitive dependencies (libllama -> libggml), RPATH is.
        println!("cargo:rustc-link-arg-bins=-Wl,--disable-new-dtags");
    }
    for rpath in rpaths {
        println!("cargo:rustc-link-arg-bins=-Wl,-rpath,{rpath}");
    }
}

fn main() {
    // Stage before tauri_build so the bundle resource globs resolve.
    stage_llama_runtime();
    tauri_build::build();
}
