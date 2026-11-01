//! ml-workflow's step runner for Claude steps: a WebAssembly component of world
//! `runspore:runner/runner@0.2.0` that spore loads from the workflow artifact to start,
//! probe and stop Claude Code for a step, in a herdr pane or as a windowless process
//! (docs/claude-step-runner-design.md). The logic is written against [`host::Host`];
//! `guest.rs` binds it to the world's imports and exports on `wasm32`.

pub mod budget;
pub mod claude;
pub mod handle;
pub mod herdr;
pub mod host;
pub mod runner;
pub mod session;

#[cfg(target_arch = "wasm32")]
mod guest;
