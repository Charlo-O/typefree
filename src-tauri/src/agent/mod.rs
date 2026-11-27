//! Voice agent: spoken commands are handed to the user's Codex CLI (`codex app-server`), which
//! operates the computer under TypeFree-mediated approvals. See `runtime.rs` for the session
//! lifecycle and `codex.rs` for the protocol shapes.

pub mod codex;
pub mod executable;
pub mod panel;
pub mod runtime;
