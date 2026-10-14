use crate::model::Res;
use crate::util::{ps_arg, run_ps, run_raw};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

const COMMON: [&str; 3] = ["--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"];
const INSTALL_TIMEOUT: Duration = Duration::from_secs(1500);

pub struct Winget {
    exe: String,
    prefix: Vec<String>,
}

impl Winget {
    pub fn system() -> Self {
        Winget { exe: "winget".into(), prefix: vec![] }
    }

    #[cfg(test)]
    pub fn script(path: &std::path::Path) -> Self {
        Winget {
            exe: "powershell.exe".into(),
            prefix: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"].iter().map(|s| s.to_string()).chain([path.to_string_lossy().to_string()]).collect(),
        }
    }

    pub fn run(&self, args: &[&str], timeout: Duration) -> Res<(bool, String, String)> {
        let all: Vec<&str> = self.prefix.iter().map(|s| s.as_str()).chain(args.iter().copied()).collect();
        run_raw(&self.exe, &all, timeout)
    }

    pub fn ready(&self) -> Res<()> {
        match self.run(&["--version"], Duration::from_secs(20)) {
            Ok((true, _, _)) => Ok(()),
            _ => Err("winget was not found. Install \"App Installer\" from the Microsoft Store (it ships with current Windows 11), then press Retry.".into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub name: String,
    pub version: String,
    pub available: String,
}

pub fn parse_list(text: &str) -> HashMap<String, Row> {
    let lines: Vec<&str> = text.lines().map(|l| l.trim_end_matches('\r')).collect();
    let mut out = HashMap::new();
    let Some(h) = lines.iter().position(|l| l.starts_with("Name") && l.contains("Id") && l.contains("Version")) else { return out };
    let header = lines[h];
    let off = |key: &str| header.find(key).map(|b| header[..b].chars().count());
    let (Some(id), Some(ver)) = (off("Id"), off("Version")) else { return out };
    let (avail, source) = (off("Available"), off("Source"));
    for line in &lines[h + 1..] {
        let c: Vec<char> = line.chars().collect();
        if c.len() <= ver || line.trim().chars().all(|x| x == '-') {
            continue;
        }
        let cut = |a: usize, b: usize| c.iter().skip(a).take(b.saturating_sub(a)).collect::<String>().trim().to_string();
        let end_ver = avail.or(source).unwrap_or(c.len());
        let newer = avail.map(|a| cut(a, source.unwrap_or(c.len()))).unwrap_or_default();
        let key = cut(id, ver).to_lowercase();
        if !key.is_empty() {
            out.insert(key, Row { name: cut(0, id), version: cut(ver, end_ver), available: newer });
        }
    }
    out
}

pub fn list_all(w: &Winget) -> Res<HashMap<String, Row>> {
    let (_, stdout, _) = w.run(&["list", "--accept-source-agreements", "--disable-interactivity"], Duration::from_secs(90))?;
    Ok(parse_list(&stdout))
}

pub fn installed_row(w: &Winget, id: &str) -> Res<Option<Row>> {
    let (_, stdout, _) = w.run(&["list", "--id", id, "--exact", "--accept-source-agreements", "--disable-interactivity"], Duration::from_secs(60))?;
    Ok(parse_list(&stdout).remove(&id.to_lowercase()).filter(|r| !r.version.is_empty()))
}

pub fn installed_version(w: &Winget, id: &str) -> Res<Option<String>> {
    Ok(installed_row(w, id)?.map(|r| r.version))
}

pub fn up_to_date(text: &str) -> bool {
    let t = text.to_lowercase();
    t.contains("no available upgrade") || t.contains("no newer package versions")
}

fn files_in_use(text: &str) -> bool {
    let t = text.to_lowercase();
    t.contains("currently in use by a different application") || t.contains("installer failed with exit code: 6")
}

fn blockers(app_name: &str) -> Vec<String> {
    let words: Vec<String> = app_name.to_lowercase().split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect();
    if words.join("").len() < 5 {
        return vec![];
    }
    let script = format!(
        "{}$pat = '*' + ($a.words -join '*') + '*'; Get-Process | ForEach-Object {{ $n = $_.ProcessName; try {{ if ($_.Modules | Where-Object {{ $_.FileName -like $pat }}) {{ $n }} }} catch {{}} }} | Sort-Object -Unique",
        ps_arg(&json!({ "words": words }))
    );
    run_ps(&script)
        .map(|out| out.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty() && !l.eq_ignore_ascii_case("Zyro Optimizer")).collect())
        .unwrap_or_default()
}

fn last_line(text: &str) -> String {
    text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("The installer failed").trim().to_string()
}

pub fn explain_failure(name: &str, text: &str) -> String {
    let t = text.to_lowercase();
    if files_in_use(text) {
        let who = blockers(name);
        return if who.is_empty() {
            format!("Files of {name} are in use. Close it and any app that loads parts of it (browsers, chat or recording apps), then try again")
        } else {
            format!("Close {} and try again. {} files of {name} open, so the installer can not replace them", who.join(", "), if who.len() == 1 { "It keeps" } else { "They keep" })
        };
    }
    if t.contains("hash does not match") || t.contains("0x8a150011") {
        return "Integrity check failed: the downloaded installer does not match the checksum published for it, so winget refused to run it. Nothing was changed".into();
    }
    if t.contains("no applicable installer") || t.contains("no applicable") {
        return format!("This version of {name} has no installer that fits this PC (Windows version or architecture)");
    }
    if t.contains("another installation is already in progress") || t.contains("exit code: 1618") {
        return "Another installation is running. Wait for it to finish, then try again".into();
    }
    if t.contains("cancelled") || t.contains("canceled") || t.contains("exit code: 1223") {
        return "The Windows permission prompt was cancelled".into();
    }
    if t.contains("no package found") || t.contains("no installed package found") {
        return format!("winget does not know {name}");
    }
    last_line(text)
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Installed { version: String },
    Updated { from: String, to: String, note: Option<String> },
    UpToDate,
    Failed(String),
}

pub struct Applied {
    pub outcome: Outcome,
    pub undo: Option<Value>,
}

fn failed(msg: impl Into<String>) -> Applied {
    Applied { outcome: Outcome::Failed(msg.into()), undo: None }
}

fn join(out: &str, err: &str) -> String {
    format!("{out}\n{err}")
}

fn reinstall_args<'a>(id: &'a str, version: &'a str) -> Vec<&'a str> {
    let mut a = vec!["install", "--id", id, "--exact", "--version", version, "--silent", "--force"];
    a.extend(COMMON);
    a
}

fn install_version(w: &Winget, id: &str, name: &str, version: &str) -> Res<()> {
    let (ok, out, err) = w.run(&reinstall_args(id, version), INSTALL_TIMEOUT)?;
    if !ok {
        return Err(explain_failure(name, &join(&out, &err)));
    }
    match installed_version(w, id)? {
        Some(v) if v == version => Ok(()),
        Some(v) => Err(format!("winget finished, but {name} is at {v}, not {version}")),
        None => Err(format!("winget finished, but {name} is not listed as installed")),
    }
}

pub fn install_or_update(w: &Winget, id: &str, name: &str, allow_fresh: bool, progress: &dyn Fn(&str)) -> Applied {
    progress("Checking the installed version");
    let before = match installed_version(w, id) {
        Ok(v) => v,
        Err(e) => return failed(e),
    };
    let Some(before) = before else {
        if !allow_fresh {
            return failed(format!("{name} is not installed"));
        }
        progress("Downloading and installing");
        let mut args = vec!["install", "--id", id, "--exact", "--source", "winget", "--silent"];
        args.extend(COMMON);
        let (ok, out, err) = match w.run(&args, INSTALL_TIMEOUT) {
            Ok(r) => r,
            Err(e) => return failed(e),
        };
        if !ok {
            return failed(explain_failure(name, &join(&out, &err)));
        }
        progress("Verifying the installation");
        return match installed_version(w, id) {
            Ok(Some(version)) => Applied { outcome: Outcome::Installed { version }, undo: None },
            Ok(None) => failed(format!("winget finished, but {name} is not listed as installed afterwards")),
            Err(e) => failed(e),
        };
    };

    progress("Downloading and installing the update");
    let mut args = vec!["upgrade", "--id", id, "--exact", "--silent"];
    args.extend(COMMON);
    let (ok, out, err) = match w.run(&args, INSTALL_TIMEOUT) {
        Ok(r) => r,
        Err(e) => return failed(e),
    };
    let text = join(&out, &err);
    if ok && up_to_date(&text) {
        return Applied { outcome: Outcome::UpToDate, undo: None };
    }
    if !ok {
        let reason = explain_failure(name, &text);
        return match installed_version(w, id) {
            Ok(None) => progress_restore(w, id, name, &before, reason, progress),
            _ => failed(reason),
        };
    }
    progress("Verifying the new version");
    match installed_version(w, id) {
        Ok(Some(after)) if after != before => Applied {
            outcome: Outcome::Updated {
                from: before.clone(),
                to: after,
                note: text.to_lowercase().contains("restart").then(|| "Restart Windows to finish the update".to_string()),
            },
            undo: Some(json!({ "id": id, "name": name, "version": before })),
        },
        Ok(Some(_)) => failed(format!("winget reported success, but {name} is still at {before}. The installer may need a restart or a closed app to finish")),
        Ok(None) => progress_restore(w, id, name, &before, format!("{name} is no longer listed after the update"), progress),
        Err(e) => failed(e),
    }
}

fn progress_restore(w: &Winget, id: &str, name: &str, previous: &str, reason: String, progress: &dyn Fn(&str)) -> Applied {
    progress("Restoring the previous version");
    match install_version(w, id, name, previous) {
        Ok(()) => failed(format!("{reason}. The update removed {name}, so version {previous} was reinstalled")),
        Err(e) => failed(format!("{reason}. {name} was removed and version {previous} could not be reinstalled ({e}). Install it again from Install Apps")),
    }
}

pub fn roll_back(w: &Winget, undo: &Value) -> Res<()> {
    let text = |k: &str| undo.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
    let (id, name, version) = (text("id"), text("name"), text("version"));
    if id.is_empty() || version.is_empty() || !crate::updates::is_safe_winget_id(&id) || version.chars().any(|c| c.is_control() || c == ' ') {
        return Err("The saved undo information is incomplete".into());
    }
    install_version(w, &id, if name.is_empty() { &id } else { &name }, &version)
}

#[cfg(test)]
pub static REAL_WINGET: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::now_ms;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;

    const FAKE: &str = r#"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$path = Join-Path $dir 'state.json'
$state = Get-Content $path -Raw | ConvertFrom-Json
$cmd = $args[0]
$id = $null; $ver = $null
for ($i = 0; $i -lt $args.Count; $i++) {
  if ($args[$i] -eq '--id') { $id = $args[$i + 1] }
  if ($args[$i] -eq '--version' -and $args.Count -gt $i + 1 -and $cmd -ne '--version') { $ver = $args[$i + 1] }
}
function Save { $state | ConvertTo-Json -Depth 6 | Set-Content $path }
function App($i) { $state.apps.PSObject.Properties | Where-Object { $_.Name -eq $i } | ForEach-Object { $_.Value } }
function Row($n, $i, $v, $a) { $n.PadRight(24) + $i.PadRight(22) + $v.PadRight(12) + $a.PadRight(12) + 'winget' }
if ($cmd -eq '--version') { 'v1.9.0'; exit 0 }
if ($cmd -eq 'list') {
  $rows = @($state.apps.PSObject.Properties | Where-Object { $_.Value.installed -and (-not $id -or $_.Name -eq $id) })
  if ($rows.Count -eq 0) { 'No installed package found matching input criteria.'; exit 1 }
  'Name'.PadRight(24) + 'Id'.PadRight(22) + 'Version'.PadRight(12) + 'Available'.PadRight(12) + 'Source'
  ('-' * 80)
  foreach ($r in $rows) { $a = ''; if ($r.Value.available -and $r.Value.available -ne $r.Value.version) { $a = $r.Value.available }; Row $r.Value.name $r.Name $r.Value.version $a }
  exit 0
}
$app = App $id
if (-not $app) { 'No package found matching input criteria.'; exit 1 }
if ($cmd -eq 'upgrade') {
  switch ($app.upgrade) {
    'ok' { $app.version = $app.available; Save; 'Found an existing package already installed. Trying to upgrade the installed package...'; 'Successfully installed'; exit 0 }
    'restart' { $app.version = $app.available; Save; 'Successfully installed. Restart the application to complete the upgrade.'; exit 0 }
    'uptodate' { 'No available upgrade found.'; 'No newer package versions are available from the configured sources.'; exit 0 }
    'hash' { 'Installer hash does not match; this cannot be overridden when running as admin'; exit 1 }
    'inuse' { 'Files modified by the installer are currently in use by a different application. Exit the applications then try again.'; 'Installer failed with exit code: 6'; exit 1 }
    'notapplicable' { 'No applicable installer found; see logs for more details.'; exit 1 }
    'busy' { 'Another installation is already in progress. Try again later.'; exit 1 }
    'cancelled' { 'Installation was cancelled by the user'; exit 1 }
    'noop' { 'Successfully installed'; exit 0 }
    'crash' { $app.installed = $false; Save; 'Installer failed with exit code: 1603'; exit 1 }
  }
}
if ($cmd -eq 'install') {
  if ($ver) {
    if ($app.rollback -eq 'ok') { $app.version = $ver; $app.installed = $true; Save; 'Successfully installed'; exit 0 }
    'Installer failed with exit code: 1603'; exit 1
  }
  switch ($app.fresh) {
    'ok' { $app.installed = $true; $app.version = $app.available; Save; 'Successfully installed'; exit 0 }
    'noop' { 'Successfully installed'; exit 0 }
    default { 'Installer failed with exit code: 1603'; exit 1 }
  }
}
exit 1
"#;

    struct Fake {
        dir: PathBuf,
        w: Winget,
    }

    impl Fake {
        fn new(app: Value) -> Fake {
            static N: AtomicU64 = AtomicU64::new(0);
            let dir = std::env::temp_dir().join(format!("zyro-winget-{}-{}-{}", now_ms(), std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
            std::fs::create_dir_all(&dir).unwrap();
            let script = dir.join("winget.ps1");
            std::fs::write(&script, FAKE).unwrap();
            std::fs::write(dir.join("state.json"), json!({ "apps": { "Zyro.FakeApp": app } }).to_string()).unwrap();
            Fake { w: Winget::script(&script), dir }
        }

        fn version(&self) -> Option<String> {
            installed_version(&self.w, "Zyro.FakeApp").unwrap()
        }

        fn state(&self) -> Value {
            serde_json::from_str(&std::fs::read_to_string(self.dir.join("state.json")).unwrap()).unwrap()
        }
    }

    fn app(version: &str, available: &str, upgrade: &str) -> Value {
        json!({ "name": "Zyro Fake App", "installed": true, "version": version, "available": available, "upgrade": upgrade, "rollback": "ok" })
    }

    fn run(f: &Fake, allow_fresh: bool) -> (Applied, Vec<String>) {
        let steps = Mutex::new(vec![]);
        let r = install_or_update(&f.w, "Zyro.FakeApp", "Zyro Fake App", allow_fresh, &|s| steps.lock().unwrap().push(s.to_string()));
        (r, steps.into_inner().unwrap())
    }

    #[test]
    fn the_fake_winget_reports_versions() {
        let f = Fake::new(app("1.0.0", "2.0.0", "ok"));
        assert!(f.w.ready().is_ok());
        assert_eq!(f.version().as_deref(), Some("1.0.0"));
        let all = list_all(&f.w).unwrap();
        assert_eq!(all["zyro.fakeapp"].version, "1.0.0");
        assert_eq!(all["zyro.fakeapp"].available, "2.0.0");
        assert_eq!(all["zyro.fakeapp"].name, "Zyro Fake App");
        assert_eq!(installed_row(&f.w, "Zyro.FakeApp").unwrap().unwrap().name, "Zyro Fake App");
    }

    #[test]
    fn an_update_installs_verifies_and_records_how_to_go_back() {
        let f = Fake::new(app("1.0.0", "2.0.0", "ok"));
        let (r, steps) = run(&f, false);
        assert_eq!(r.outcome, Outcome::Updated { from: "1.0.0".into(), to: "2.0.0".into(), note: None });
        assert_eq!(r.undo.unwrap(), json!({ "id": "Zyro.FakeApp", "name": "Zyro Fake App", "version": "1.0.0" }));
        assert_eq!(f.version().as_deref(), Some("2.0.0"));
        assert_eq!(steps, ["Checking the installed version", "Downloading and installing the update", "Verifying the new version"]);
    }

    #[test]
    fn a_restart_requirement_is_passed_on() {
        let f = Fake::new(app("1.0.0", "2.0.0", "restart"));
        let (r, _) = run(&f, false);
        assert_eq!(r.outcome, Outcome::Updated { from: "1.0.0".into(), to: "2.0.0".into(), note: Some("Restart Windows to finish the update".into()) });
    }

    #[test]
    fn an_app_that_is_current_is_not_reported_as_updated() {
        let f = Fake::new(app("2.0.0", "2.0.0", "uptodate"));
        let (r, _) = run(&f, false);
        assert_eq!(r.outcome, Outcome::UpToDate);
        assert!(r.undo.is_none());
    }

    #[test]
    fn a_corrupted_installer_is_refused_and_nothing_changes() {
        let f = Fake::new(app("1.0.0", "2.0.0", "hash"));
        let (r, _) = run(&f, false);
        let Outcome::Failed(msg) = r.outcome else { panic!("expected failure") };
        assert!(msg.contains("Integrity check failed") && msg.contains("Nothing was changed"), "{msg}");
        assert!(r.undo.is_none());
        assert_eq!(f.version().as_deref(), Some("1.0.0"));
    }

    #[test]
    fn an_incompatible_installer_is_explained() {
        let f = Fake::new(app("1.0.0", "2.0.0", "notapplicable"));
        let Outcome::Failed(msg) = run(&f, false).0.outcome else { panic!() };
        assert!(msg.contains("fits this PC"), "{msg}");
        assert_eq!(f.version().as_deref(), Some("1.0.0"));
    }

    #[test]
    fn files_in_use_busy_and_cancelled_are_explained() {
        for (scenario, expect) in [("inuse", "in use"), ("busy", "Another installation"), ("cancelled", "permission prompt")] {
            let f = Fake::new(app("1.0.0", "2.0.0", scenario));
            let Outcome::Failed(msg) = run(&f, false).0.outcome else { panic!("{scenario}") };
            assert!(msg.contains(expect), "{scenario}: {msg}");
            assert_eq!(f.version().as_deref(), Some("1.0.0"), "{scenario}");
        }
    }

    #[test]
    fn a_false_success_is_caught_by_reading_the_version_back() {
        let f = Fake::new(app("1.0.0", "2.0.0", "noop"));
        let (r, _) = run(&f, false);
        let Outcome::Failed(msg) = r.outcome else { panic!("a false success was accepted") };
        assert!(msg.contains("still at 1.0.0"), "{msg}");
        assert!(r.undo.is_none());
    }

    #[test]
    fn an_installer_that_removes_the_app_gets_the_old_version_reinstalled() {
        let f = Fake::new(app("1.0.0", "2.0.0", "crash"));
        let (r, steps) = run(&f, false);
        let Outcome::Failed(msg) = r.outcome else { panic!() };
        assert!(msg.contains("version 1.0.0 was reinstalled"), "{msg}");
        assert_eq!(f.version().as_deref(), Some("1.0.0"));
        assert_eq!(steps.last().unwrap(), "Restoring the previous version");
    }

    #[test]
    fn when_the_old_version_cannot_come_back_the_user_is_told_exactly_that() {
        let mut a = app("1.0.0", "2.0.0", "crash");
        a["rollback"] = json!("fail");
        let f = Fake::new(a);
        let Outcome::Failed(msg) = run(&f, false).0.outcome else { panic!() };
        assert!(msg.contains("could not be reinstalled") && msg.contains("Install it again"), "{msg}");
        assert_eq!(f.version(), None);
    }

    #[test]
    fn a_rollback_restores_the_recorded_version_and_checks_it() {
        let f = Fake::new(app("1.0.0", "2.0.0", "ok"));
        let undo = run(&f, false).0.undo.unwrap();
        assert_eq!(f.version().as_deref(), Some("2.0.0"));
        roll_back(&f.w, &undo).expect("rollback");
        assert_eq!(f.version().as_deref(), Some("1.0.0"));
        assert_eq!(f.state()["apps"]["Zyro.FakeApp"]["version"], "1.0.0");
    }

    #[test]
    fn a_failed_rollback_is_an_error_not_a_success() {
        let mut a = app("1.0.0", "2.0.0", "ok");
        a["rollback"] = json!("fail");
        let f = Fake::new(a);
        let undo = run(&f, false).0.undo.unwrap();
        let err = roll_back(&f.w, &undo).unwrap_err();
        assert!(err.contains("1603"), "{err}");
        assert_eq!(f.version().as_deref(), Some("2.0.0"));
        assert!(roll_back(&f.w, &json!({ "id": "bad id;calc", "version": "1.0.0" })).is_err());
        assert!(roll_back(&f.w, &json!({ "id": "Zyro.FakeApp" })).is_err());
    }

    #[test]
    fn a_fresh_install_is_verified_and_only_when_allowed() {
        let mut a = app("0.0.0", "3.0.0", "ok");
        a["installed"] = json!(false);
        a["fresh"] = json!("ok");
        let f = Fake::new(a.clone());
        let Outcome::Failed(msg) = run(&f, false).0.outcome else { panic!() };
        assert!(msg.contains("is not installed"), "{msg}");
        let (r, steps) = run(&f, true);
        assert_eq!(r.outcome, Outcome::Installed { version: "3.0.0".into() });
        assert_eq!(steps.last().unwrap(), "Verifying the installation");
        a["fresh"] = json!("noop");
        let g = Fake::new(a.clone());
        let Outcome::Failed(msg) = run(&g, true).0.outcome else { panic!("false success accepted") };
        assert!(msg.contains("not listed as installed"), "{msg}");
        a["fresh"] = json!("fail");
        let h = Fake::new(a);
        assert!(matches!(run(&h, true).0.outcome, Outcome::Failed(_)));
    }

    #[test]
    fn parses_the_winget_table_with_and_without_updates() {
        let text = "Name                 Id                       Version   Available  Source\n------------------------------------------------------------------------\nGit                  Git.Git                  2.45.1    2.46.0     winget\nVLC media player     VideoLAN.VLC             3.0.21               winget\n";
        let t = parse_list(text);
        assert_eq!(t["git.git"], Row { name: "Git".into(), version: "2.45.1".into(), available: "2.46.0".into() });
        assert_eq!(t["videolan.vlc"], Row { name: "VLC media player".into(), version: "3.0.21".into(), available: String::new() });
        assert!(parse_list("No installed package found matching input criteria.").is_empty());
    }

    #[test]
    fn explains_real_winget_messages() {
        assert!(explain_failure("X", "Installer hash does not match; this cannot be overridden").contains("Integrity"));
        assert!(explain_failure("X", "No applicable installer found; see logs for more details.").contains("fits this PC"));
        assert!(explain_failure("X", "Installer failed with exit code: 1618").contains("Another installation"));
        assert_eq!(explain_failure("X", "Something odd\nInstaller failed with exit code: 77\n"), "Installer failed with exit code: 77");
        assert!(up_to_date("No available upgrade found."));
        assert!(!up_to_date("Successfully installed"));
    }

    #[test]
    fn the_real_winget_list_is_readable() {
        let _turn = REAL_WINGET.lock().unwrap_or_else(|e| e.into_inner());
        let w = Winget::system();
        w.ready().expect("winget missing");
        let all = list_all(&w).unwrap();
        assert!(!all.is_empty());
        let known = ["Microsoft.VCRedist.2015+.x64", "Microsoft.VCRedist.2015+.x86", "Git.Git", "7zip.7zip", "VideoLAN.VLC", "Notepad++.Notepad++"];
        let (id, row) = known.iter().find_map(|id| all.get(&id.to_lowercase()).map(|r| (*id, r))).expect("none of the well-known apps is installed here");
        assert_eq!(installed_version(&w, id).unwrap().as_deref(), Some(row.version.as_str()));
        assert_eq!(installed_version(&w, "Zyro.Does.Not.Exist").unwrap(), None);
    }
}
