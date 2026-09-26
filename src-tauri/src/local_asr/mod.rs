//! Contracts shared by local automatic speech recognition (ASR) runtimes.
//!
//! The runtime itself is intentionally kept out of this module.  A local model
//! can be served by whisper.cpp, sherpa-onnx, R2T2/llama.cpp, or another
//! adapter; all of them use the same manifest and request metadata here.

mod audio;
mod manifest;

pub mod commands;

#[cfg(feature = "local-asr-sherpa")]
mod sherpa;

#[allow(unused_imports)]
pub(crate) use manifest::{
    LocalAsrModelFormat, LocalAsrModelManifest, LocalAsrRequest, LocalAsrRuntime,
};
