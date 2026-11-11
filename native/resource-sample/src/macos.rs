use super::*;
use libproc::libproc::{
    bsd_info::BSDInfo,
    file_info::{pidfdinfo, ListFDs, ProcFDType},
    net_info::{SocketFDInfo, SocketInfoKind},
    pid_rusage::{pidrusage, RUsageInfoV0},
    proc_pid::{listpidinfo, pidinfo},
};
use libproc::processes::{pids_by_type, ProcFilter};
use std::mem;
use std::sync::OnceLock;

#[allow(deprecated)] // One stable Mach C API; no extra crate is needed for this conversion.
fn cpu_seconds(ticks: f64) -> Option<f64> {
    static SCALE: OnceLock<Option<f64>> = OnceLock::new();
    SCALE
        .get_or_init(|| unsafe {
            let mut info: libc::mach_timebase_info = mem::zeroed();
            (libc::mach_timebase_info(&mut info) == 0 && info.denom > 0)
                .then(|| info.numer as f64 / info.denom as f64 / 1e9)
        })
        .map(|scale| ticks * scale)
}

pub fn topology(roots: &[u32], system: bool) -> Result<(Vec<Process>, bool), String> {
    let mut complete = true;
    let mut rows = Vec::new();
    let mut seen = HashSet::new();
    let mut pending = if system {
        pids_by_type(ProcFilter::All).map_err(|e| e.to_string())?
    } else {
        roots.to_vec()
    };
    while let Some(pid) = pending.pop() {
        if !seen.insert(pid) || pid == 0 || (pid == std::process::id() && !system) {
            continue;
        }
        if !system {
            // libproc distinguishes an empty child list from failure through errno.
            unsafe {
                *libc::__error() = 0;
            }
            match pids_by_type(ProcFilter::ByParentProcess { ppid: pid }) {
                Ok(children) => pending.extend(children),
                Err(_) => complete = false,
            }
        }
        match metadata(pid) {
            Some(row) => rows.push(row),
            None => {
                complete = false;
                if system {
                    // Preserve enumerated PIDs even when metadata access is denied.
                    rows.push(Process {
                        pid,
                        ppid: 0,
                        name: String::new(),
                        start: None,
                        seconds: None,
                        memory: None,
                        footprint: None,
                    });
                }
            }
        }
    }
    Ok((rows, complete))
}

fn metadata(pid: u32) -> Option<Process> {
    let info = pidinfo::<BSDInfo>(pid as i32, 0).ok()?;
    let bytes: Vec<_> = info
        .pbi_name
        .iter()
        .take_while(|c| **c != 0)
        .map(|c| *c as u8)
        .collect();
    Some(Process {
        pid,
        ppid: info.pbi_ppid,
        name: String::from_utf8_lossy(&bytes).into_owned(),
        start: Some(format!(
            "{}:{}",
            info.pbi_start_tvsec, info.pbi_start_tvusec
        )),
        seconds: None,
        memory: None,
        footprint: None,
    })
}

pub fn metrics(row: &mut Process) {
    // One call obtains cumulative CPU, resident bytes and Activity Monitor footprint.
    if let Ok(info) = pidrusage::<RUsageInfoV0>(row.pid as i32) {
        // Recheck creation identity to avoid attaching counters to a reused PID.
        if let Ok(bsd) = pidinfo::<BSDInfo>(row.pid as i32, 0) {
            if row.start.as_deref()
                != Some(&format!("{}:{}", bsd.pbi_start_tvsec, bsd.pbi_start_tvusec))
            {
                return;
            }
            // rusage CPU counters use Mach ticks on Apple Silicon, not nanoseconds.
            row.seconds = cpu_seconds(info.ri_user_time as f64 + info.ri_system_time as f64);
            row.memory = Some(info.ri_resident_size);
            row.footprint = Some(info.ri_phys_footprint);
        }
    }
}

pub fn monotonic() -> f64 {
    unsafe {
        let mut time: libc::timespec = mem::zeroed();
        libc::clock_gettime(libc::CLOCK_MONOTONIC_RAW, &mut time);
        time.tv_sec as f64 + time.tv_nsec as f64 / 1e9
    }
}

pub fn host() -> Value {
    let mut total = 0u64;
    let mut size = mem::size_of::<u64>();
    let ok = unsafe {
        libc::sysctlbyname(
            c"hw.memsize".as_ptr(),
            &mut total as *mut _ as _,
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    } == 0;
    json!({"total":if ok {Some(total)} else {None}, "available":null})
}

pub fn listeners(rows: &[Process], _selected: &HashSet<u32>) -> Result<Value, String> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    let mut complete = true;
    for row in rows {
        let pid = row.pid as i32;
        let info = match pidinfo::<BSDInfo>(pid, 0) {
            Ok(info) => info,
            Err(_) => {
                complete = false;
                continue;
            }
        };
        if row.start.as_deref()
            != Some(&format!(
                "{}:{}",
                info.pbi_start_tvsec, info.pbi_start_tvusec
            ))
        {
            complete = false;
            continue;
        }
        let fds = match listpidinfo::<ListFDs>(pid, info.pbi_nfiles as usize + 16) {
            Ok(fds) => fds,
            Err(_) => {
                complete = false;
                continue;
            }
        };
        let first = result.len();
        for fd in fds {
            if !matches!(fd.proc_fdtype.into(), ProcFDType::Socket) {
                continue;
            }
            let socket = match pidfdinfo::<SocketFDInfo>(pid, fd.proc_fd) {
                Ok(s) => s,
                Err(_) => {
                    complete = false;
                    continue;
                }
            };
            if !matches!(socket.psi.soi_kind.into(), SocketInfoKind::Tcp) {
                continue;
            }
            let tcp = unsafe { socket.psi.soi_proto.pri_tcp };
            if tcp.tcpsi_state != 1 {
                continue;
            }
            let inet = tcp.tcpsi_ini;
            let (family, address) = if socket.psi.soi_family == libc::AF_INET {
                (
                    "ipv4",
                    std::net::Ipv4Addr::from(
                        unsafe { inet.insi_laddr.ina_46.i46a_addr4.s_addr }.to_ne_bytes(),
                    )
                    .to_string(),
                )
            } else if socket.psi.soi_family == libc::AF_INET6 {
                (
                    "ipv6",
                    std::net::Ipv6Addr::from(unsafe { inet.insi_laddr.ina_6.s6_addr }).to_string(),
                )
            } else {
                continue;
            };
            let port = u16::from_be(inet.insi_lport as u16);
            if seen.insert((pid, family, address.clone(), port)) {
                result.push(json!({"pid":pid,"family":family,"address":address,"port":port,
                    "protocol":"tcp","socket":if socket.psi.soi_so>0 {Some(format!("socket:{}", socket.psi.soi_so))} else {None}}));
            }
        }
        // Socket enumeration races with exit/PID reuse just like accounting does.
        let identity_matches = pidinfo::<BSDInfo>(pid, 0).ok().is_some_and(|info| {
            row.start.as_deref()
                == Some(&format!(
                    "{}:{}",
                    info.pbi_start_tvsec, info.pbi_start_tvusec
                ))
        });
        if !identity_matches {
            result.truncate(first);
            complete = false;
        }
    }
    Ok(json!({"rows":result,"complete":complete}))
}
