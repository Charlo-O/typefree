use std::env;
use std::fs;
use std::path::Path;

fn copy_llama_runtime_dlls() {
    let Ok(out_dir) = env::var("OUT_DIR") else {
        return;
    };

    // OUT_DIR = target/{debug,release}/build/typefree-<hash>/out.
    // The llama-cpp-sys dynamic-link feature places its runtime DLLs under
    // the sibling build/llama-cpp-sys-*/out/bin directory. Copy them next to
    // the app binary so both `tauri dev` and bundled releases can load the
    // in-process llama.cpp backend without a user-installed runtime.
    let Some(profile_dir) = Path::new(&out_dir).ancestors().nth(3) else {
        return;
    };
    let build_dir = profile_dir.join("build");
    let Ok(entries) = fs::read_dir(&build_dir) else {
        return;
    };

    let destinations = [profile_dir.to_path_buf(), profile_dir.join("deps")];
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("llama-cpp-sys-2-") {
            continue;
        }

        let bin_dir = path.join("out").join("bin");
        let Ok(dlls) = fs::read_dir(bin_dir) else {
            continue;
        };
        for dll in dlls.flatten() {
            let source = dll.path();
            if source.extension().and_then(|value| value.to_str()) != Some("dll") {
                continue;
            }
            let Some(filename) = source.file_name() else {
                continue;
            };
            for destination in &destinations {
                let target = destination.join(filename);
                if let Err(error) = fs::copy(&source, &target) {
                    println!(
                        "cargo:warning=failed to copy llama.cpp runtime {} -> {}: {error}",
                        source.display(),
                        target.display()
                    );
                }
            }
        }
    }
}

fn main() {
    tauri_build::build();
    copy_llama_runtime_dlls();
}
