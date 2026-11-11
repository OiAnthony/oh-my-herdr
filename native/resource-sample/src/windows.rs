use super::*;
use std::{ffi::c_void, mem, ptr};
type Handle = *mut c_void;
#[repr(C)]
struct Entry {
    size: u32,
    usage: u32,
    pid: u32,
    heap: usize,
    module: u32,
    threads: u32,
    parent: u32,
    priority: i32,
    flags: u32,
    name: [u16; 260],
}
#[repr(C)]
#[derive(Default)]
struct FileTime {
    low: u32,
    high: u32,
}
#[repr(C)]
#[derive(Default)]
struct Memory {
    size: u32,
    faults: u32,
    peak: usize,
    working: usize,
    paged_peak: usize,
    paged: usize,
    nonpaged_peak: usize,
    nonpaged: usize,
    pagefile: usize,
    pagefile_peak: usize,
}
#[repr(C)]
#[derive(Default)]
struct Host {
    length: u32,
    load: u32,
    total: u64,
    available: u64,
    page_total: u64,
    page_available: u64,
    virtual_total: u64,
    virtual_available: u64,
    extended: u64,
}
#[link(name = "kernel32")]
extern "system" {
    fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
    fn Process32FirstW(handle: Handle, entry: *mut Entry) -> i32;
    fn Process32NextW(handle: Handle, entry: *mut Entry) -> i32;
    fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
    fn CloseHandle(handle: Handle) -> i32;
    fn GetProcessTimes(
        handle: Handle,
        created: *mut FileTime,
        exit: *mut FileTime,
        kernel: *mut FileTime,
        user: *mut FileTime,
    ) -> i32;
    fn K32GetProcessMemoryInfo(handle: Handle, memory: *mut Memory, size: u32) -> i32;
    fn GlobalMemoryStatusEx(host: *mut Host) -> i32;
    fn QueryPerformanceCounter(value: *mut i64) -> i32;
    fn QueryPerformanceFrequency(value: *mut i64) -> i32;
    fn GetLastError() -> u32;
}
fn ticks(t: &FileTime) -> u64 {
    (t.high as u64) << 32 | t.low as u64
}
pub fn topology(
    _roots: &[u32],
    _include_unmanaged: bool,
) -> Result<(Vec<Process>, bool, bool), String> {
    unsafe {
        let handle = CreateToolhelp32Snapshot(2, 0);
        if handle as isize == -1 {
            return Err("Process snapshot failed".into());
        }
        let mut e: Entry = mem::zeroed();
        e.size = mem::size_of::<Entry>() as u32;
        let mut rows = Vec::new();
        let mut next = Process32FirstW(handle, &mut e);
        while next != 0 {
            if e.pid > 0 && e.pid != std::process::id() {
                let end = e.name.iter().position(|c| *c == 0).unwrap_or(e.name.len());
                rows.push(Process {
                    pid: e.pid,
                    ppid: e.parent,
                    name: String::from_utf16_lossy(&e.name[..end]),
                    start: None,
                    seconds: None,
                    memory: None,
                    footprint: None,
                });
            }
            next = Process32NextW(handle, &mut e);
        }
        let complete = GetLastError() == 18;
        CloseHandle(handle);
        if rows.is_empty() {
            Err("Process snapshot was empty".into())
        } else {
            Ok((rows, complete, complete))
        }
    }
}
pub fn metrics(row: &mut Process) {
    unsafe {
        let handle = OpenProcess(0x1000, 0, row.pid); // PROCESS_QUERY_LIMITED_INFORMATION
        if handle.is_null() {
            return;
        }
        let (mut c, mut e, mut k, mut u) = (
            FileTime::default(),
            FileTime::default(),
            FileTime::default(),
            FileTime::default(),
        );
        if GetProcessTimes(handle, &mut c, &mut e, &mut k, &mut u) != 0 {
            row.start = Some(ticks(&c).to_string());
            row.seconds = Some((ticks(&k) as f64 + ticks(&u) as f64) / 1e7);
        }
        let mut m = Memory::default();
        m.size = mem::size_of::<Memory>() as u32;
        if K32GetProcessMemoryInfo(handle, &mut m, m.size) != 0 {
            row.memory = Some(m.working as u64);
        }
        CloseHandle(handle);
    }
}
pub fn monotonic() -> f64 {
    unsafe {
        let (mut value, mut rate) = (0, 0);
        QueryPerformanceCounter(&mut value);
        QueryPerformanceFrequency(&mut rate);
        if rate > 0 {
            value as f64 / rate as f64
        } else {
            0.0
        }
    }
}
pub fn host() -> Value {
    unsafe {
        let mut h = Host::default();
        h.length = mem::size_of::<Host>() as u32;
        if GlobalMemoryStatusEx(&mut h) != 0 {
            json!({"total":h.total,"available":h.available})
        } else {
            json!({"total":null,"available":null})
        }
    }
}
#[link(name = "iphlpapi")]
extern "system" {
    fn GetExtendedTcpTable(
        table: *mut c_void,
        size: *mut u32,
        order: i32,
        family: u32,
        class: u32,
        reserved: u32,
    ) -> u32;
}
pub fn listeners(_rows: &[Process], _selected: &HashSet<u32>) -> Result<Value, String> {
    let mut rows = Vec::new();
    unsafe {
        for family in [2u32, 23u32] {
            let mut size = 0;
            let code = GetExtendedTcpTable(ptr::null_mut(), &mut size, 0, family, 3, 0); // TCP_TABLE_OWNER_PID_LISTENER
            if code != 122 && code != 0 {
                return Err(format!("TCP table failed: {code}"));
            }
            if size < 4 {
                continue;
            }
            let mut buf = vec![0u32; (size as usize + 3) / 4];
            let code = GetExtendedTcpTable(buf.as_mut_ptr() as _, &mut size, 0, family, 3, 0);
            if code != 0 {
                return Err(format!("TCP table failed: {code}"));
            }
            let stride = if family == 2 { 6 } else { 14 };
            let count = buf[0] as usize;
            if 1 + count * stride > buf.len() {
                return Err("Invalid TCP table".into());
            }
            for f in buf[1..].chunks_exact(stride).take(count) {
                let (address, port, pid) = if family == 2 {
                    (
                        std::net::Ipv4Addr::from(f[1].to_ne_bytes()).to_string(),
                        f[2],
                        f[5],
                    )
                } else {
                    let mut b = [0u8; 16];
                    for (dst, n) in b.chunks_mut(4).zip(&f[..4]) {
                        dst.copy_from_slice(&n.to_ne_bytes());
                    }
                    let addr = std::net::Ipv6Addr::from(b).to_string();
                    (
                        if f[4] > 0 {
                            format!("{addr}%{}", f[4])
                        } else {
                            addr
                        },
                        f[5],
                        f[13],
                    )
                };
                rows.push(json!({"pid":pid,"family":if family==2 {"ipv4"} else {"ipv6"},"address":address,"port":u16::from_be(port as u16),"protocol":"tcp","socket":null}));
            }
        }
    }
    Ok(json!({"rows":rows,"complete":true}))
}
