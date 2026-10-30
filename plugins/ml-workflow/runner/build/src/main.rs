//! Builds the runner module: `claude-runner` for `wasm32-unknown-unknown` with a nested
//! cargo, then the core module wrapped into a component with `wit-component`, as runspore
//! builds its own guests (`crates/runspore-wasmtime/build/pipeline.rs`).
//!
//! The build is reproducible: release, `--locked`, the toolchain `rust-toolchain.toml`
//! pins, and paths remapped so that neither the checkout's place, the cargo home nor the
//! target folder reaches the bytes. CI rebuilds the module and compares it with the
//! committed `claude-runner.wasm` (README, "The runner module").
//!
//! ```text
//! cargo run -p claude-runner-build                 # writes claude-runner.wasm
//! cargo run -p claude-runner-build -- --check      # fails when the committed file differs
//! cargo run -p claude-runner-build -- --world 0.1 --out <file>   # for a released spore 0.7
//! ```

use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

const TARGET: &str = "wasm32-unknown-unknown";

/// Environment a parent cargo sets that must not leak into the nested build.
const SCRUBBED_ENV: &[&str] = &[
    "CARGO_TARGET_DIR",
    "CARGO_BUILD_TARGET",
    "CARGO_BUILD_TARGET_DIR",
    "CARGO_ENCODED_RUSTFLAGS",
    "CARGO_BUILD_RUSTFLAGS",
    "RUSTFLAGS",
    "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "CARGO_PRIMARY_PACKAGE",
];

fn main() -> ExitCode {
    match run(std::env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("claude-runner-build: {message}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or("the build crate lives in <runner>/build")?
        .to_path_buf();
    let mut world = "0.2".to_string();
    let mut out = workspace.join("claude-runner.wasm");
    let mut check = false;
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--world" => world = args.next().ok_or("--world takes 0.1 or 0.2")?,
            "--out" => out = PathBuf::from(args.next().ok_or("--out takes a file")?),
            "--check" => check = true,
            _ => {
                return Err(format!(
                    "unknown argument {arg}; see the comment atop build/src/main.rs"
                ));
            }
        }
    }
    let features: &[&str] = match world.as_str() {
        "0.2" => &[],
        "0.1" => &["runner-0-1"],
        _ => return Err(format!("--world {world}: the runner builds for 0.1 or 0.2")),
    };
    let target_dir = workspace.join("target").join(format!("guest-{world}"));
    let component = build(&workspace, &target_dir, features)?;
    if check {
        let committed = std::fs::read(&out).map_err(|e| format!("reading {}: {e}", out.display()))?;
        if committed != component {
            return Err(format!(
                "{} is not what this source builds ({} bytes committed, {} built): run `cargo run -p claude-runner-build` and commit the result",
                out.display(),
                committed.len(),
                component.len()
            ));
        }
        println!("{} matches its source ({} bytes)", out.display(), component.len());
        return Ok(());
    }
    std::fs::write(&out, &component).map_err(|e| format!("writing {}: {e}", out.display()))?;
    println!(
        "wrote {} ({} bytes, world runspore:runner@{world}.0)",
        out.display(),
        component.len()
    );
    Ok(())
}

fn build(workspace: &Path, target_dir: &Path, features: &[&str]) -> Result<Vec<u8>, String> {
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let flags = [
        remap(workspace, "/claude-runner"),
        remap(&cargo_home(), "/cargo"),
        remap(target_dir, "/target"),
    ]
    .join("\x1f");
    let mut command = Command::new(cargo);
    command
        .current_dir(workspace)
        .args(["build", "--locked", "--release", "-p", "claude-runner", "--lib"])
        .args(["--target", TARGET])
        .arg("--target-dir")
        .arg(target_dir);
    if !features.is_empty() {
        command.arg("--features").arg(features.join(","));
    }
    for name in SCRUBBED_ENV {
        command.env_remove(name);
    }
    command.env("CARGO_ENCODED_RUSTFLAGS", flags);
    let status = command.status().map_err(|e| format!("starting cargo: {e}"))?;
    if !status.success() {
        return Err(format!("the guest build failed: {status}"));
    }
    let module_path = target_dir.join(TARGET).join("release").join("claude_runner.wasm");
    let module = std::fs::read(&module_path).map_err(|e| format!("reading {}: {e}", module_path.display()))?;
    wit_component::ComponentEncoder::default()
        .validate(true)
        .module(&module)
        .and_then(|encoder| encoder.encode())
        .map_err(|e| format!("making the component: {e:#}"))
}

fn cargo_home() -> PathBuf {
    std::env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cargo")))
        .unwrap_or_default()
}

fn remap(from: &Path, to: &str) -> String {
    format!("--remap-path-prefix={}={to}", from.display())
}
