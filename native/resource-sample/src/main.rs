//! One read-only snapshot. No subprocesses, timers, environment/argv reads or service.
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use macos as platform;
#[cfg(target_os = "windows")]
use windows as platform;

struct Process {
    pid: u32,
    ppid: u32,
    name: String,
    start: Option<String>,
    seconds: Option<f64>,
    memory: Option<u64>,
    footprint: Option<u64>,
}

impl Process {
    fn json(&self) -> Value {
        json!({"pid":self.pid,"ppid":self.ppid,"name":self.name,"start":self.start,
            "seconds":self.seconds,"memory":self.memory,"footprint":self.footprint})
    }
}

fn descendants(rows: &[Process], roots: &[u32]) -> HashSet<u32> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for row in rows {
        children.entry(row.ppid).or_default().push(row.pid);
    }
    let mut selected = HashSet::new();
    let mut pending = roots.to_vec();
    while let Some(pid) = pending.pop() {
        if selected.insert(pid) {
            pending.extend(children.get(&pid).into_iter().flatten());
        }
    }
    selected
}

fn main() {
    if let Err(error) = sample() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn sample() -> Result<(), String> {
    let mut roots = Vec::new();
    let mut ports = false;
    let mut all_ports = false;
    for arg in std::env::args().skip(1) {
        if arg == "--ports" {
            ports = true;
        } else if arg == "--all-ports" {
            ports = true;
            all_ports = true;
        } else if let Some(value) = arg.strip_prefix("--roots=") {
            for pid in value.split(',').filter(|s| !s.is_empty()) {
                roots.push(
                    pid.parse::<u32>()
                        .ok()
                        .filter(|p| *p > 0)
                        .ok_or("Invalid root PID")?,
                );
            }
        } else {
            return Err(
                "Usage: herdr-resource-sample --roots=PID,PID [--ports|--all-ports]".into(),
            );
        }
    }
    let (mut rows, topology_complete, listener_topology_complete) =
        platform::topology(&roots, all_ports)?;
    let selected = descendants(&rows, &roots);
    let monotonic = platform::monotonic();
    // Metadata for other processes is needed only for the optional port search.
    for row in rows.iter_mut().filter(|p| selected.contains(&p.pid)) {
        platform::metrics(row);
    }
    rows.retain(|p| selected.contains(&p.pid) || all_ports);
    // Listener failure must not discard independently valid CPU/memory data.
    let (listeners, listener_error) = if ports {
        match platform::listeners(&rows, &selected) {
            Ok(mut value) => {
                if !listener_topology_complete {
                    value["complete"] = json!(false);
                }
                if !all_ports {
                    if let Some(rows) = value["rows"].as_array_mut() {
                        rows.retain(|row| {
                            row["pid"]
                                .as_u64()
                                .is_some_and(|pid| selected.contains(&(pid as u32)))
                        });
                    }
                }
                value["scope"] = json!(if all_ports { "all" } else { "managed" });
                (Some(value), false)
            }
            Err(_) => (None, true),
        }
    } else {
        (None, false)
    };
    println!(
        "{}",
        json!({
            "schema":1, "platform":std::env::consts::OS, "monotonic":monotonic,
            "topologyComplete":topology_complete, "rows":rows.iter().map(Process::json).collect::<Vec<_>>(),
            "host":platform::host(), "listeners":listeners, "listenerError":listener_error
        })
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(pid: u32, ppid: u32) -> Process {
        Process {
            pid,
            ppid,
            name: String::new(),
            start: None,
            seconds: None,
            memory: None,
            footprint: None,
        }
    }
    #[test]
    fn nested_roots_and_cycles_are_sampled_once() {
        let rows = [p(10, 0), p(11, 10), p(12, 11), p(20, 21), p(21, 20)];
        assert_eq!(descendants(&rows, &[10, 11]), HashSet::from([10, 11, 12]));
        assert_eq!(descendants(&rows, &[20]), HashSet::from([20, 21]));
        assert!(descendants(&rows, &[]).is_empty());
    }
}
