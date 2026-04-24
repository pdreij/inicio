use std::collections::HashMap;
use std::process::Child;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub struct RunningScript {
    pub path: String,
    pub script: String,
}

pub struct ProcessState {
    pub children: Arc<Mutex<HashMap<u32, Arc<Mutex<Child>>>>>,
    running_by_pid: Arc<Mutex<HashMap<u32, RunningScript>>>,
    running_pid_by_key: Arc<Mutex<HashMap<String, u32>>>,
}

impl Default for ProcessState {
    fn default() -> Self {
        Self {
            children: Arc::new(Mutex::new(HashMap::new())),
            running_by_pid: Arc::new(Mutex::new(HashMap::new())),
            running_pid_by_key: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl ProcessState {
    fn make_key(path: &str, script: &str) -> String {
        format!("{path}::{script}")
    }

    pub fn register_running(&self, pid: u32, path: &str, script: &str) -> Result<(), String> {
        let key = Self::make_key(path, script);

        let mut by_pid = self
            .running_by_pid
            .lock()
            .map_err(|_| String::from("Failed to lock process running state"))?;
        by_pid.insert(
            pid,
            RunningScript {
                path: path.to_string(),
                script: script.to_string(),
            },
        );
        drop(by_pid);

        let mut by_key = self
            .running_pid_by_key
            .lock()
            .map_err(|_| String::from("Failed to lock process running state"))?;
        by_key.insert(key, pid);

        Ok(())
    }

    pub fn get_running_pid(&self, path: &str, script: &str) -> Result<Option<u32>, String> {
        let key = Self::make_key(path, script);
        let by_key = self
            .running_pid_by_key
            .lock()
            .map_err(|_| String::from("Failed to lock process running state"))?;
        Ok(by_key.get(&key).copied())
    }

    pub fn unregister_running(&self, pid: u32) -> Result<Option<RunningScript>, String> {
        let mut by_pid = self
            .running_by_pid
            .lock()
            .map_err(|_| String::from("Failed to lock process running state"))?;
        let running = by_pid.remove(&pid);
        drop(by_pid);

        if let Some(item) = &running {
            let key = Self::make_key(&item.path, &item.script);
            let mut by_key = self
                .running_pid_by_key
                .lock()
                .map_err(|_| String::from("Failed to lock process running state"))?;
            by_key.remove(&key);
        }

        Ok(running)
    }

    /// Stops every tracked child process (best-effort). Call on app shutdown so
    /// dev servers do not keep running after the launcher exits.
    pub fn terminate_all(&self) {
        let Ok(mut children) = self.children.lock() else {
            return;
        };

        for (_pid, child_arc) in children.drain() {
            if let Ok(mut child) = child_arc.lock() {
                let _ = child.kill();
            }
        }

        if let Ok(mut by_pid) = self.running_by_pid.lock() {
            by_pid.clear();
        }
        if let Ok(mut by_key) = self.running_pid_by_key.lock() {
            by_key.clear();
        }
    }
}
