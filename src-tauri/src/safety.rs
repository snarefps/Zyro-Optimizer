
const PROTECTED_PREFIXES: &[&str] = &[
    "/windows",
    "/program files",
    "/program files (x86)",
    "/programdata/microsoft/windows defender",
    "/recovery",
    "/system volume information",
    "/boot",
];
const PROTECTED_USER_DIRS: &[&str] = &["documents", "desktop", "pictures", "videos", "music", "downloads", "onedrive"];
// junk folders inside otherwise protected trees
const JUNK_EXCEPTIONS: &[&str] = &[
    "/windows/temp",
    "/windows/prefetch",
    "/windows/softwaredistribution/download",
    "/windows/minidump",
    "/windows/memory.dmp",
    "/programdata/microsoft/windows/wer",
    "/windows/logs/cbs",
    "/windows/system32/logfiles",
];

pub fn normalize(p: &str) -> String {
    let s = p.replace('\\', "/");
    let s = if s.len() >= 2 && s.as_bytes()[1] == b':' { s[2..].to_string() } else { s };
    let mut stack: Vec<&str> = Vec::new();
    for part in s.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                stack.pop();
            }
            x => stack.push(x),
        }
    }
    let joined = stack.join("/").to_lowercase();
    if joined.is_empty() {
        String::new()
    } else {
        format!("/{joined}")
    }
}

fn under_or_equal(n: &str, base: &str) -> bool {
    n == base || n.starts_with(&format!("{base}/"))
}

pub fn is_protected_path(p: &str) -> bool {
    if p.is_empty() {
        return true;
    }
    let n = normalize(p);
    if n.is_empty() || n == "/users" {
        return true;
    }
    if JUNK_EXCEPTIONS.iter().any(|b| under_or_equal(&n, b)) {
        return false;
    }
    if PROTECTED_PREFIXES.iter().any(|b| under_or_equal(&n, b)) {
        return true;
    }
    if let Some(rest) = n.strip_prefix("/users/") {
        let mut parts = rest.splitn(2, '/');
        let _user = parts.next();
        match parts.next() {
            None | Some("") => return true, // the profile root itself
            Some(sub) => {
                let top = sub.split('/').next().unwrap_or("");
                if PROTECTED_USER_DIRS.iter().any(|d| top == *d || top.starts_with(&format!("{d} -"))) {
                    return true;
                }
            }
        }
    }
    false
}

pub fn is_system_path(p: &str) -> bool {
    if p.is_empty() {
        return true;
    }
    let n = normalize(p);
    if n.is_empty() || n == "/users" {
        return true;
    }
    if PROTECTED_PREFIXES.iter().any(|b| under_or_equal(&n, b)) {
        return true;
    }
    if let Some(rest) = n.strip_prefix("/users/") {
        let mut parts = rest.splitn(2, '/');
        let _user = parts.next();
        match parts.next() {
            None | Some("") => return true,
            Some(sub) => return sub == "appdata" || sub.starts_with("appdata/"),
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protects_system_and_personal_roots() {
        for p in [
            r"C:\Windows",
            r"c:\windows\system32\kernel32.dll",
            r"C:\Program Files\App\a.exe",
            r"C:\Users\bob\Documents",
            r"C:\Users\bob\Desktop\x.txt",
            r"C:\Users\bob",
            "C:/",
        ] {
            assert!(is_protected_path(p), "{p}");
        }
    }

    #[test]
    fn allows_temp_and_cache_paths() {
        for p in [r"C:\Users\bob\AppData\Local\Temp\x.tmp", r"C:\Windows\Temp\x.tmp", r"C:\Windows\Prefetch\a.pf"] {
            assert!(!is_protected_path(p), "{p}");
        }
    }

    #[test]
    fn normalizes_traversal() {
        assert!(is_protected_path(r"C:\Users\bob\AppData\Local\Temp\..\..\..\Documents\a.docx"));
        assert!(is_protected_path(r"C:\Windows\Temp\..\System32\x.dll"));
    }

    #[test]
    fn system_path_blocks_os_but_allows_user_media() {
        assert!(is_system_path(r"C:\Windows\System32\a.dll"));
        assert!(is_system_path(r"C:\Program Files\X\a.exe"));
        assert!(is_system_path(r"C:\Users\bob\AppData\Local\x"));
        assert!(!is_system_path(r"C:\Users\bob\Videos\movie.mkv"));
    }
}
