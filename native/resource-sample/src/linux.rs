use super::*;
use std::{fs, io};

// /proc/PID/stat contains only accounting and a kernel name, never argv/environ.
fn stat(pid: u32) -> io::Result<Process> {
    let text = fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let a = text.find('(').ok_or(io::ErrorKind::InvalidData)?;
    let b = text.rfind(')').ok_or(io::ErrorKind::InvalidData)?;
    let fields: Vec<_> = text[b + 2..].split_whitespace().collect();
    let parse = |index: usize| -> io::Result<u64> {
        fields
            .get(index)
            .ok_or(io::ErrorKind::InvalidData)?
            .parse::<u64>()
            .map_err(|_| io::ErrorKind::InvalidData.into())
    };
    Ok(Process {
        pid,
        ppid: parse(1)? as u32,
        name: text[a + 1..b].to_string(),
        start: Some(parse(19)?.to_string()),
        seconds: None,
        memory: None,
        footprint: None,
    })
}

pub fn topology(
    _roots: &[u32],
    _include_unmanaged: bool,
) -> Result<(Vec<Process>, bool, bool), String> {
    let mut rows = Vec::new();
    let mut complete = true;
    for entry in fs::read_dir("/proc").map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if let Ok(pid) = entry.file_name().to_string_lossy().parse::<u32>() {
            if pid == std::process::id() {
                continue;
            }
            match stat(pid) {
                Ok(row) => rows.push(row),
                Err(_) => complete = false,
            }
        }
    }
    Ok((rows, complete, complete))
}
extern "C" {
    fn sysconf(name: i32) -> i64;
}
pub fn metrics(row: &mut Process) {
    let Ok(text) = fs::read_to_string(format!("/proc/{}/stat", row.pid)) else {
        return;
    };
    let Some(end) = text.rfind(')') else {
        return;
    };
    let f: Vec<_> = text[end + 2..].split_whitespace().collect();
    if f.get(19).copied() != row.start.as_deref() {
        return;
    }
    let ticks = unsafe { sysconf(2) }; // Linux _SC_CLK_TCK
    let pages = unsafe { sysconf(30) }; // Linux _SC_PAGESIZE
    if ticks <= 0 || pages <= 0 {
        return;
    }
    row.seconds = f
        .get(11)
        .and_then(|v| v.parse::<u64>().ok())
        .zip(f.get(12).and_then(|v| v.parse::<u64>().ok()))
        .map(|(u, s)| (u as f64 + s as f64) / ticks as f64);
    row.memory = f
        .get(21)
        .and_then(|v| v.parse::<u64>().ok())
        .and_then(|n| n.checked_mul(pages as u64));
}
pub fn monotonic() -> f64 {
    fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|s| s.split_whitespace().next()?.parse().ok())
        .unwrap_or(0.0)
}
pub fn host() -> Value {
    let text = fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let get = |key: &str| {
        text.lines()
            .find(|l| l.starts_with(key))
            .and_then(|l| l.split_whitespace().nth(1)?.parse::<u64>().ok())
            .and_then(|n| n.checked_mul(1024))
    };
    json!({"total":get("MemTotal:"),"available":get("MemAvailable:")})
}
pub fn listeners(_rows: &[Process], _selected: &HashSet<u32>) -> Result<Value, String> {
    // Linux ownership must be joined with readable /proc/PID/fd links.
    let mut sockets = HashMap::new();
    for (path, family) in [("/proc/net/tcp", "ipv4"), ("/proc/net/tcp6", "ipv6")] {
        let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
        for line in text.lines().skip(1) {
            let f: Vec<_> = line.split_whitespace().collect();
            if f.len() < 10 || f[3] != "0A" {
                continue;
            }
            let Some((raw, port)) = f[1].split_once(':') else {
                continue;
            };
            let Ok(port) = u16::from_str_radix(port, 16) else {
                continue;
            };
            let mut bytes = Vec::new();
            for chunk in raw.as_bytes().chunks(8) {
                if let Ok(v) = u32::from_str_radix(std::str::from_utf8(chunk).unwrap_or(""), 16) {
                    bytes.extend(v.to_ne_bytes());
                }
            }
            let address = if family == "ipv4" {
                <[u8; 4]>::try_from(bytes)
                    .ok()
                    .map(|b| std::net::Ipv4Addr::from(b).to_string())
            } else {
                <[u8; 16]>::try_from(bytes)
                    .ok()
                    .map(|b| std::net::Ipv6Addr::from(b).to_string())
            };
            if let Some(address) = address {
                sockets.insert(f[9].to_string(), (family, address, port));
            }
        }
    }
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    let mut complete = true;
    for row in _rows {
        let Ok(fds) = fs::read_dir(format!("/proc/{}/fd", row.pid)) else {
            complete = false;
            continue;
        };
        for fd in fds.flatten() {
            let Ok(link) = fs::read_link(fd.path()) else {
                complete = false;
                continue;
            };
            let link = link.to_string_lossy();
            let Some(inode) = link
                .strip_prefix("socket:[")
                .and_then(|v| v.strip_suffix(']'))
            else {
                continue;
            };
            if let Some((family, address, port)) = sockets.get(inode) {
                if seen.insert((row.pid, inode.to_string())) {
                    result.push(json!({"pid":row.pid,"family":family,"address":address,"port":port,"protocol":"tcp","socket":format!("inode:{inode}")}));
                }
            }
        }
    }
    Ok(json!({"rows":result,"complete":complete}))
}
