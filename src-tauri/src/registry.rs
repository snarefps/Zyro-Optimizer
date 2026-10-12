use crate::model::Res;
use serde::{Deserialize, Serialize};
use winreg::enums::*;
use winreg::{RegKey, RegValue};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Raw {
    pub vtype: u32,
    pub bytes: Vec<u8>,
}

impl Raw {
    pub fn dword(n: u32) -> Raw {
        Raw { vtype: 4, bytes: n.to_le_bytes().to_vec() }
    }
    pub fn sz(s: &str) -> Raw {
        let mut bytes: Vec<u8> = s.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        bytes.extend([0, 0]);
        Raw { vtype: 1, bytes }
    }
    pub fn binary(b: Vec<u8>) -> Raw {
        Raw { vtype: 3, bytes: b }
    }
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn as_dword(&self) -> Option<u32> {
        if self.vtype == 4 && self.bytes.len() == 4 {
            Some(u32::from_le_bytes([self.bytes[0], self.bytes[1], self.bytes[2], self.bytes[3]]))
        } else {
            None
        }
    }
    pub fn as_string(&self) -> Option<String> {
        if self.vtype != 1 && self.vtype != 2 {
            return None;
        }
        let units: Vec<u16> = self.bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        Some(String::from_utf16_lossy(&units).trim_end_matches('\0').to_string())
    }
    pub fn same(&self, other: &Raw) -> bool {
        if self.vtype != other.vtype {
            return false;
        }
        match (self.as_string(), other.as_string()) {
            (Some(a), Some(b)) => a.eq_ignore_ascii_case(&b),
            _ => self.bytes == other.bytes,
        }
    }
}

fn vtype_to_enum(v: u32) -> RegType {
    match v {
        1 => REG_SZ,
        2 => REG_EXPAND_SZ,
        3 => REG_BINARY,
        4 => REG_DWORD,
        7 => REG_MULTI_SZ,
        11 => REG_QWORD,
        _ => REG_BINARY,
    }
}

fn enum_to_vtype(t: &RegType) -> u32 {
    match t {
        REG_NONE => 0,
        REG_SZ => 1,
        REG_EXPAND_SZ => 2,
        REG_BINARY => 3,
        REG_DWORD => 4,
        REG_MULTI_SZ => 7,
        REG_QWORD => 11,
        _ => 3,
    }
}

fn split(key: &str) -> Res<(RegKey, &str)> {
    let (root, rest) = key.split_once('\\').unwrap_or((key, ""));
    let hive = match root {
        "HKCU" => HKEY_CURRENT_USER,
        "HKLM" => HKEY_LOCAL_MACHINE,
        other => return Err(format!("Unsupported registry root {other}")),
    };
    Ok((RegKey::predef(hive), rest))
}

pub fn read(key: &str, name: &str) -> Option<Raw> {
    let (root, path) = split(key).ok()?;
    let k = root.open_subkey_with_flags(path, KEY_READ).ok()?;
    let v = k.get_raw_value(name).ok()?;
    Some(Raw { vtype: enum_to_vtype(&v.vtype), bytes: v.bytes.to_vec() })
}

pub fn write(key: &str, name: &str, value: &Raw) -> Res<()> {
    let (root, path) = split(key)?;
    let (k, _) = root.create_subkey_with_flags(path, KEY_READ | KEY_WRITE).map_err(|e| e.to_string())?;
    let v = RegValue { bytes: value.bytes.clone(), vtype: vtype_to_enum(value.vtype) };
    k.set_raw_value(name, &v).map_err(|e| e.to_string())
}

pub fn delete_value(key: &str, name: &str) -> Res<()> {
    let (root, path) = split(key)?;
    let k = root.open_subkey_with_flags(path, KEY_WRITE).map_err(|e| e.to_string())?;
    k.delete_value(name).map_err(|e| e.to_string())
}

pub fn delete_key(key: &str) -> Res<()> {
    let (root, path) = split(key)?;
    root.delete_subkey_all(path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = r"HKCU\Software\ZyroOptimizerRustTest";

    #[test]
    fn writes_reads_restores_and_deletes_values() {
        let _ = delete_key(KEY);
        assert!(read(KEY, "Nope").is_none());

        write(KEY, "Enabled", &Raw::dword(1)).unwrap();
        write(KEY, "Delay", &Raw::sz("400")).unwrap();
        assert_eq!(read(KEY, "Enabled").unwrap().as_dword(), Some(1));
        assert_eq!(read(KEY, "Delay").unwrap().as_string().as_deref(), Some("400"));

        let old = read(KEY, "Enabled").unwrap();
        write(KEY, "Enabled", &Raw::dword(0)).unwrap();
        assert_eq!(read(KEY, "Enabled").unwrap().as_dword(), Some(0));
        write(KEY, "Enabled", &old).unwrap();
        assert!(read(KEY, "Enabled").unwrap().same(&Raw::dword(1)));

        write(KEY, "Fresh", &Raw::dword(5)).unwrap();
        delete_value(KEY, "Fresh").unwrap();
        assert!(read(KEY, "Fresh").is_none());

        write(KEY, "Big", &Raw::dword(0xffff_ffff)).unwrap();
        assert_eq!(read(KEY, "Big").unwrap().as_dword(), Some(0xffff_ffff));

        write(&format!(r"{KEY}\Sub"), "", &Raw::sz("")).unwrap();
        assert!(read(&format!(r"{KEY}\Sub"), "").is_some());
        delete_key(&format!(r"{KEY}\Sub")).unwrap();
        assert!(read(&format!(r"{KEY}\Sub"), "").is_none());

        delete_key(KEY).unwrap();
    }

    #[test]
    fn compares_values_by_meaning() {
        assert!(Raw::sz("ABC").same(&Raw::sz("abc")));
        assert!(!Raw::dword(1).same(&Raw::dword(2)));
        assert!(!Raw::dword(1).same(&Raw::sz("1")));
    }

    #[test]
    fn rejects_unknown_roots() {
        assert!(write(r"HKXX\Foo", "a", &Raw::dword(1)).is_err());
    }
}
