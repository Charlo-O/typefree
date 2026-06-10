#[cfg(target_os = "windows")]
mod platform {
    use std::collections::{HashMap, HashSet};
    use std::ptr::null;
    use std::sync::Mutex;

    use windows::core::Interface;
    use windows::Win32::Foundation::{CloseHandle, RPC_E_CHANGED_MODE, S_FALSE, S_OK};
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
        ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::GetCurrentProcessId;

    #[derive(Clone, Debug)]
    struct SessionMuteState {
        session_id: String,
        was_muted: bool,
        previous_volume: f32,
    }

    #[derive(Default, Debug)]
    struct DuckingState {
        sessions: Vec<SessionMuteState>,
    }

    static DUCKING_STATE: Mutex<Option<DuckingState>> = Mutex::new(None);
    const DUCKING_VOLUME: f32 = 0.12;

    struct ComGuard {
        should_uninitialize: bool,
    }

    impl ComGuard {
        fn initialize() -> Result<Self, String> {
            let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            if hr == S_OK || hr == S_FALSE {
                return Ok(Self {
                    should_uninitialize: true,
                });
            }
            if hr == RPC_E_CHANGED_MODE {
                return Ok(Self {
                    should_uninitialize: false,
                });
            }
            Err(format!("Failed to initialize COM: {hr:?}"))
        }
    }

    impl Drop for ComGuard {
        fn drop(&mut self) {
            if self.should_uninitialize {
                unsafe {
                    CoUninitialize();
                }
            }
        }
    }

    fn current_process_family() -> HashSet<u32> {
        let current_pid = unsafe { GetCurrentProcessId() };
        let mut protected = HashSet::from([current_pid]);
        let mut parent_by_pid = HashMap::new();

        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        let Ok(snapshot) = snapshot else {
            return protected;
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
            loop {
                parent_by_pid.insert(entry.th32ProcessID, entry.th32ParentProcessID);
                if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                    break;
                }
            }
        }

        let _ = unsafe { CloseHandle(snapshot) };

        let mut changed = true;
        while changed {
            changed = false;
            for (&pid, &parent_pid) in parent_by_pid.iter() {
                if protected.contains(&parent_pid) && protected.insert(pid) {
                    changed = true;
                }
            }
        }

        protected
    }

    fn session_instance_id(control: &IAudioSessionControl2) -> Result<String, String> {
        let raw = unsafe { control.GetSessionInstanceIdentifier() }
            .map_err(|err| format!("Failed to read audio session id: {err}"))?;

        if raw.0.is_null() {
            return Ok(String::new());
        }

        let value = unsafe { raw.to_string() }.unwrap_or_default();
        unsafe {
            CoTaskMemFree(Some(raw.0.cast()));
        }
        Ok(value)
    }

    fn session_manager() -> Result<IAudioSessionManager2, String> {
        let device_enumerator: IMMDeviceEnumerator =
            unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
                .map_err(|err| format!("Failed to create audio device enumerator: {err}"))?;

        let device = unsafe { device_enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) }
            .map_err(|err| format!("Failed to get default audio output device: {err}"))?;

        unsafe { device.Activate(CLSCTX_ALL, None) }
            .map_err(|err| format!("Failed to activate audio session manager: {err}"))
    }

    fn apply_ducking(state: &mut DuckingState) -> Result<usize, String> {
        let manager = session_manager()?;
        let sessions = unsafe { manager.GetSessionEnumerator() }
            .map_err(|err| format!("Failed to enumerate audio sessions: {err}"))?;
        let count = unsafe { sessions.GetCount() }
            .map_err(|err| format!("Failed to read audio session count: {err}"))?;

        let protected_pids = current_process_family();
        let mut known_sessions: HashSet<String> = state
            .sessions
            .iter()
            .map(|item| item.session_id.clone())
            .collect();
        let mut ducked_count = 0usize;

        for index in 0..count {
            let Ok(session) = (unsafe { sessions.GetSession(index) }) else {
                continue;
            };
            let Ok(control) = session.cast::<IAudioSessionControl2>() else {
                continue;
            };

            let pid = unsafe { control.GetProcessId() }.unwrap_or(0);
            if pid != 0 && protected_pids.contains(&pid) {
                continue;
            }

            let session_id = match session_instance_id(&control) {
                Ok(value) if !value.is_empty() => value,
                _ => format!("pid:{pid}:index:{index}"),
            };

            let Ok(volume) = session.cast::<ISimpleAudioVolume>() else {
                continue;
            };

            let currently_muted = unsafe { volume.GetMute() }
                .map(|value| value.as_bool())
                .unwrap_or(false);
            let current_volume = unsafe { volume.GetMasterVolume() }.unwrap_or(1.0);

            if !known_sessions.contains(&session_id) {
                state.sessions.push(SessionMuteState {
                    session_id: session_id.clone(),
                    was_muted: currently_muted,
                    previous_volume: current_volume,
                });
                known_sessions.insert(session_id);
            }

            let ducked = if currently_muted || current_volume <= DUCKING_VOLUME {
                true
            } else {
                unsafe { volume.SetMasterVolume(DUCKING_VOLUME, null()) }.is_ok()
            };

            if ducked {
                ducked_count += 1;
            }
        }

        Ok(ducked_count)
    }

    fn restore_ducking(state: &mut DuckingState) -> Result<(usize, usize), String> {
        let manager = session_manager()?;
        let sessions = unsafe { manager.GetSessionEnumerator() }
            .map_err(|err| format!("Failed to enumerate audio sessions: {err}"))?;
        let count = unsafe { sessions.GetCount() }
            .map_err(|err| format!("Failed to read audio session count: {err}"))?;

        let previous_by_session: HashMap<String, SessionMuteState> = state
            .sessions
            .iter()
            .cloned()
            .map(|item| (item.session_id.clone(), item))
            .collect();
        let mut restored_count = 0usize;
        let mut restored_sessions = HashSet::new();

        for index in 0..count {
            let Ok(session) = (unsafe { sessions.GetSession(index) }) else {
                continue;
            };
            let Ok(control) = session.cast::<IAudioSessionControl2>() else {
                continue;
            };

            let pid = unsafe { control.GetProcessId() }.unwrap_or(0);
            let session_id = match session_instance_id(&control) {
                Ok(value) if !value.is_empty() => value,
                _ => format!("pid:{pid}:index:{index}"),
            };

            let Some(previous) = previous_by_session.get(&session_id) else {
                continue;
            };
            let Ok(volume) = session.cast::<ISimpleAudioVolume>() else {
                continue;
            };

            let volume_restored =
                unsafe { volume.SetMasterVolume(previous.previous_volume, null()) }.is_ok();
            let mute_restored = unsafe { volume.SetMute(previous.was_muted, null()) }.is_ok();

            if volume_restored && mute_restored {
                restored_count += 1;
                restored_sessions.insert(session_id);
            }
        }

        state
            .sessions
            .retain(|item| !restored_sessions.contains(&item.session_id));

        Ok((restored_count, state.sessions.len()))
    }

    pub fn start() -> Result<(), String> {
        let _com = ComGuard::initialize()?;
        let mut guard = DUCKING_STATE
            .lock()
            .map_err(|_| "Audio ducking state lock is poisoned".to_string())?;
        let state = guard.get_or_insert_with(DuckingState::default);
        let ducked_count = apply_ducking(state)?;
        eprintln!(
            "[audio-ducking] active; ducked/rescanned {ducked_count} sessions, tracking {}",
            state.sessions.len()
        );
        Ok(())
    }

    pub fn stop() -> Result<(), String> {
        let _com = ComGuard::initialize()?;
        let mut guard = DUCKING_STATE
            .lock()
            .map_err(|_| "Audio ducking state lock is poisoned".to_string())?;

        let Some(state) = guard.as_mut() else {
            return Ok(());
        };

        let (restored_count, pending_count) = restore_ducking(state)?;
        if pending_count == 0 {
            guard.take();
        }

        eprintln!("[audio-ducking] restored {restored_count} sessions, pending {pending_count}");
        Ok(())
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    pub fn start() -> Result<(), String> {
        Ok(())
    }

    pub fn stop() -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub fn start_audio_ducking() -> Result<(), String> {
    platform::start()
}

#[tauri::command]
pub fn stop_audio_ducking() -> Result<(), String> {
    platform::stop()
}
