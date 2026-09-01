//! Safe on-disk registry for data-only pet packs.

use super::manifest::{ManifestError, PetPackManifest};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use zip::ZipArchive;

const MAX_ARCHIVE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 50 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_FILES: usize = 256;
const MANIFEST_FILE: &str = "manifest.json";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PetPackSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: Option<String>,
    pub source: PetPackSource,
    pub renderer: PetPackRenderer,
    pub preview: String,
    pub removable: bool,
    pub content_hash: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PetPackSource {
    Bundled,
    Installed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PetPackRenderer {
    Sprite,
    Rive,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PetPackDiagnostic {
    pub id: Option<String>,
    pub code: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PetPackInstallResult {
    pub pack: PetPackSummary,
    pub installed: bool,
}

#[derive(Debug)]
pub struct PackError {
    pub code: &'static str,
    pub detail: String,
}

impl PackError {
    fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

impl From<ManifestError> for PackError {
    fn from(error: ManifestError) -> Self {
        Self::new(error.code, error.detail)
    }
}

impl std::fmt::Display for PackError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for PackError {}

/// Pack roots are injected in tests. Production uses the application's
/// resource directory for bundled packs and app data for installed packs.
pub struct PetPackManager {
    bundled_root: PathBuf,
    installed_root: PathBuf,
    staging_root: PathBuf,
    quarantine_root: PathBuf,
    registry_path: PathBuf,
    diagnostics: Mutex<Vec<PetPackDiagnostic>>,
}

impl PetPackManager {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, PackError> {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|error| PackError::new("appDataUnavailable", error.to_string()))?;
        let resources = app
            .path()
            .resource_dir()
            .map_err(|error| PackError::new("resourceUnavailable", error.to_string()))?;
        Ok(Self::with_roots(
            resources.join("pets"),
            app_data.join("pet-packs"),
        ))
    }

    pub fn with_roots(bundled_root: PathBuf, app_data_root: PathBuf) -> Self {
        Self {
            bundled_root,
            installed_root: app_data_root.join("installed"),
            staging_root: app_data_root.join("staging"),
            quarantine_root: app_data_root.join("quarantine"),
            registry_path: app_data_root.join("registry.json"),
            diagnostics: Mutex::new(Vec::new()),
        }
    }

    pub fn initialize(&self) -> Result<(), PackError> {
        fs::create_dir_all(&self.installed_root)
            .map_err(|error| PackError::new("storageUnavailable", error.to_string()))?;
        fs::create_dir_all(&self.staging_root)
            .map_err(|error| PackError::new("storageUnavailable", error.to_string()))?;
        fs::create_dir_all(&self.quarantine_root)
            .map_err(|error| PackError::new("storageUnavailable", error.to_string()))?;
        self.clean_staging()?;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<PetPackSummary>, PackError> {
        self.initialize()?;
        self.clear_diagnostics();
        let mut packs = self.scan_bundled();
        let bundled_ids = packs
            .iter()
            .map(|pack| pack.id.clone())
            .collect::<HashSet<_>>();
        packs.extend(
            self.scan_installed()
                .into_iter()
                .filter(|pack| !bundled_ids.contains(&pack.id)),
        );
        packs.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));
        self.write_registry(&packs)?;
        Ok(packs)
    }

    pub fn install(
        &self,
        archive_path: &Path,
        allow_downgrade: bool,
    ) -> Result<PetPackInstallResult, PackError> {
        self.initialize()?;
        if archive_path
            .extension()
            .and_then(|extension| extension.to_str())
            != Some("opet")
        {
            return Err(PackError::new(
                "invalidArchiveExtension",
                "expected a .opet archive",
            ));
        }
        let metadata = fs::metadata(archive_path)
            .map_err(|error| PackError::new("archiveUnavailable", error.to_string()))?;
        if metadata.len() > MAX_ARCHIVE_BYTES {
            return Err(PackError::new("archiveTooLarge", "archive exceeds 20 MiB"));
        }

        let staging = self.staging_root.join(unique_staging_name());
        let install_result = (|| {
            unpack_archive(archive_path, &staging)?;
            let manifest = load_manifest(&staging)?;
            verify_referenced_assets(&staging, &manifest)?;
            if manifest.id.starts_with("dev.opencoder.") || self.has_bundled_pack(&manifest.id) {
                return Err(PackError::new("reservedPackId", manifest.id));
            }
            let destination = self
                .installed_root
                .join(&manifest.id)
                .join(&manifest.version);
            if destination.exists() {
                return Err(PackError::new("alreadyInstalled", manifest.id));
            }
            if !allow_downgrade {
                if let Some(installed_version) = self.highest_installed_version(&manifest.id)? {
                    let candidate = semver::Version::parse(&manifest.version)
                        .map_err(|error| PackError::new("invalidVersion", error.to_string()))?;
                    if candidate < installed_version {
                        return Err(PackError::new(
                            "downgradeRequiresConfirmation",
                            format!("{} is older than {installed_version}", manifest.version),
                        ));
                    }
                }
            }
            let parent = destination.parent().ok_or_else(|| {
                PackError::new("invalidInstallPath", "pack destination has no parent")
            })?;
            fs::create_dir_all(parent)
                .map_err(|error| PackError::new("storageUnavailable", error.to_string()))?;
            fs::rename(&staging, &destination)
                .map_err(|error| PackError::new("installFailed", error.to_string()))?;
            let pack = summarize(&destination, &manifest, PetPackSource::Installed)?;
            self.list()?;
            Ok(PetPackInstallResult {
                pack,
                installed: true,
            })
        })();
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging);
        }
        install_result
    }

    pub fn remove(&self, id: &str, selected_pack_id: Option<&str>) -> Result<(), PackError> {
        validate_pack_id(id)?;
        if selected_pack_id == Some(id) {
            return Err(PackError::new("currentPackCannotBeRemoved", id));
        }
        let target = self.installed_root.join(id);
        if !target.exists() {
            return Err(PackError::new("packNotFound", id));
        }
        fs::remove_dir_all(&target)
            .map_err(|error| PackError::new("removeFailed", error.to_string()))?;
        self.list()?;
        Ok(())
    }

    pub fn read_asset(&self, id: &str, relative_path: &str) -> Result<Vec<u8>, PackError> {
        validate_pack_id(id)?;
        validate_relative_path(relative_path)?;
        let mut candidate_roots = vec![self.installed_root.join(id)];
        candidate_roots.push(self.bundled_root.join(id));
        for root in candidate_roots {
            if root.exists() {
                if root.starts_with(&self.installed_root) {
                    let Some(version) = self.highest_installed_version(id)? else {
                        continue;
                    };
                    let path = root.join(version.to_string()).join(relative_path);
                    if let Some(bytes) =
                        read_asset_within_root(&root.join(version.to_string()), &path)?
                    {
                        return Ok(bytes);
                    }
                } else {
                    let path = root.join(relative_path);
                    if let Some(bytes) = read_asset_within_root(&root, &path)? {
                        return Ok(bytes);
                    }
                }
            }
        }
        Err(PackError::new("assetNotFound", relative_path))
    }

    pub fn diagnostics(&self) -> Vec<PetPackDiagnostic> {
        self.diagnostics
            .lock()
            .map(|items| items.clone())
            .unwrap_or_default()
    }

    fn scan_bundled(&self) -> Vec<PetPackSummary> {
        let Ok(entries) = fs::read_dir(&self.bundled_root) else {
            return Vec::new();
        };
        entries
            .flatten()
            .filter_map(|entry| {
                let root = entry.path();
                if !root.is_dir() {
                    return None;
                }
                match self.inspect(root, PetPackSource::Bundled) {
                    Ok(summary) => Some(summary),
                    Err(error) => {
                        self.record_diagnostic(None, error.code, &error.detail);
                        None
                    }
                }
            })
            .collect()
    }

    fn scan_installed(&self) -> Vec<PetPackSummary> {
        let Ok(pack_ids) = fs::read_dir(&self.installed_root) else {
            return Vec::new();
        };
        let mut packs = Vec::new();
        for pack_id in pack_ids.flatten() {
            let root = pack_id.path();
            if !root.is_dir() {
                continue;
            }
            let Ok(versions) = fs::read_dir(&root) else {
                self.record_diagnostic(
                    Some(pack_id.file_name().to_string_lossy().into_owned()),
                    "corruptPack",
                    "cannot read installed versions",
                );
                continue;
            };
            let mut newest: Option<PetPackSummary> = None;
            for version in versions.flatten() {
                let path = version.path();
                if path.is_dir() {
                    match self.inspect(path.clone(), PetPackSource::Installed) {
                        Ok(summary) => {
                            let replace = match newest.as_ref() {
                                None => true,
                                Some(current) => {
                                    semver::Version::parse(&summary.version)
                                        .expect("validated manifest versions are semver")
                                        > semver::Version::parse(&current.version)
                                            .expect("validated manifest versions are semver")
                                }
                            };
                            if replace {
                                newest = Some(summary);
                            }
                        }
                        Err(error) => {
                            self.record_diagnostic(
                                Some(pack_id.file_name().to_string_lossy().into_owned()),
                                error.code,
                                &error.detail,
                            );
                            if let Err(quarantine_error) = self.quarantine(path) {
                                self.record_diagnostic(
                                    Some(pack_id.file_name().to_string_lossy().into_owned()),
                                    quarantine_error.code,
                                    &quarantine_error.detail,
                                );
                            }
                        }
                    }
                }
            }
            if let Some(summary) = newest {
                packs.push(summary);
            }
        }
        packs
    }

    fn inspect(&self, root: PathBuf, source: PetPackSource) -> Result<PetPackSummary, PackError> {
        let manifest = load_manifest(&root)?;
        verify_referenced_assets(&root, &manifest)?;
        summarize(&root, &manifest, source)
    }

    fn highest_installed_version(&self, id: &str) -> Result<Option<semver::Version>, PackError> {
        let root = self.installed_root.join(id);
        let Ok(entries) = fs::read_dir(root) else {
            return Ok(None);
        };
        let mut versions = entries
            .flatten()
            .filter_map(|entry| semver::Version::parse(&entry.file_name().to_string_lossy()).ok())
            .collect::<Vec<_>>();
        versions.sort();
        Ok(versions.pop())
    }

    fn clean_staging(&self) -> Result<(), PackError> {
        let entries = fs::read_dir(&self.staging_root)
            .map_err(|error| PackError::new("storageUnavailable", error.to_string()))?;
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                fs::remove_dir_all(entry.path())
                    .map_err(|error| PackError::new("stagingCleanupFailed", error.to_string()))?;
            }
        }
        Ok(())
    }

    fn has_bundled_pack(&self, id: &str) -> bool {
        self.scan_bundled().iter().any(|pack| pack.id == id)
    }

    fn quarantine(&self, path: PathBuf) -> Result<(), PackError> {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("invalid-pack");
        let target = self
            .quarantine_root
            .join(format!("{name}-{}", unique_staging_name()));
        fs::rename(path, target)
            .map_err(|error| PackError::new("quarantineFailed", error.to_string()))
    }

    fn write_registry(&self, packs: &[PetPackSummary]) -> Result<(), PackError> {
        let parent = self
            .registry_path
            .parent()
            .ok_or_else(|| PackError::new("storageUnavailable", "registry path has no parent"))?;
        fs::create_dir_all(parent)
            .map_err(|error| PackError::new("storageUnavailable", error.to_string()))?;
        let contents = serde_json::to_vec_pretty(packs)
            .map_err(|error| PackError::new("registryWriteFailed", error.to_string()))?;
        let temporary = self.registry_path.with_extension("json.tmp");
        fs::write(&temporary, contents)
            .map_err(|error| PackError::new("registryWriteFailed", error.to_string()))?;
        fs::rename(&temporary, &self.registry_path)
            .map_err(|error| PackError::new("registryWriteFailed", error.to_string()))
    }

    fn clear_diagnostics(&self) {
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            diagnostics.clear();
        }
    }

    fn record_diagnostic(&self, id: Option<String>, code: &str, detail: &str) {
        if let Ok(mut diagnostics) = self.diagnostics.lock() {
            diagnostics.push(PetPackDiagnostic {
                id,
                code: code.to_string(),
                detail: detail.to_string(),
            });
        }
    }
}

fn unpack_archive(archive_path: &Path, destination: &Path) -> Result<(), PackError> {
    let archive_file = File::open(archive_path)
        .map_err(|error| PackError::new("archiveUnavailable", error.to_string()))?;
    let mut archive = ZipArchive::new(archive_file)
        .map_err(|error| PackError::new("invalidArchive", error.to_string()))?;
    if archive.len() > MAX_FILES {
        return Err(PackError::new(
            "tooManyFiles",
            "archive has more than 256 entries",
        ));
    }
    fs::create_dir_all(destination)
        .map_err(|error| PackError::new("storageUnavailable", error.to_string()))?;
    let mut seen = HashSet::new();
    let mut expanded = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| PackError::new("invalidArchive", error.to_string()))?;
        let name = entry.name().to_string();
        validate_archive_entry(&name)?;
        if !seen.insert(name.clone()) {
            return Err(PackError::new("duplicateArchiveEntry", name));
        }
        if entry.is_symlink() || (!entry.is_dir() && !entry.is_file()) {
            return Err(PackError::new("unsupportedArchiveEntry", name));
        }
        let relative = Path::new(&name);
        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(output)
                .map_err(|error| PackError::new("extractFailed", error.to_string()))?;
            continue;
        }
        if is_nested_archive(&name) {
            return Err(PackError::new("nestedArchive", name));
        }
        if entry.size() > MAX_FILE_BYTES {
            return Err(PackError::new("fileTooLarge", name));
        }
        expanded = expanded.saturating_add(entry.size());
        if expanded > MAX_EXPANDED_BYTES {
            return Err(PackError::new(
                "expandedArchiveTooLarge",
                "archive exceeds 50 MiB",
            ));
        }
        if let Some(parent) = output.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| PackError::new("extractFailed", error.to_string()))?;
        }
        let mut file = File::create(output)
            .map_err(|error| PackError::new("extractFailed", error.to_string()))?;
        let copied = std::io::copy(&mut entry, &mut file)
            .map_err(|error| PackError::new("extractFailed", error.to_string()))?;
        if copied != entry.size() {
            return Err(PackError::new(
                "invalidArchive",
                "entry size changed while extracting",
            ));
        }
    }
    Ok(())
}

fn load_manifest(root: &Path) -> Result<PetPackManifest, PackError> {
    let contents = fs::read_to_string(root.join(MANIFEST_FILE))
        .map_err(|error| PackError::new("manifestMissing", error.to_string()))?;
    PetPackManifest::parse(&contents).map_err(Into::into)
}

fn verify_referenced_assets(root: &Path, manifest: &PetPackManifest) -> Result<(), PackError> {
    for relative in manifest.referenced_assets() {
        let path = root.join(relative);
        if !path.is_file() {
            return Err(PackError::new("assetMissing", relative));
        }
        let bytes = fs::read(&path)
            .map_err(|error| PackError::new("assetUnavailable", error.to_string()))?;
        if bytes.len() as u64 > MAX_FILE_BYTES || !matches_media_magic(relative, &bytes) {
            return Err(PackError::new("invalidAsset", relative));
        }
    }
    Ok(())
}

fn read_asset_within_root(root: &Path, path: &Path) -> Result<Option<Vec<u8>>, PackError> {
    if !path.is_file() {
        return Ok(None);
    }
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| PackError::new("assetUnavailable", error.to_string()))?;
    let canonical_path = fs::canonicalize(path)
        .map_err(|error| PackError::new("assetUnavailable", error.to_string()))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err(PackError::new(
            "assetPathEscape",
            path.display().to_string(),
        ));
    }
    fs::read(canonical_path)
        .map(Some)
        .map_err(|error| PackError::new("assetUnavailable", error.to_string()))
}

fn summarize(
    root: &Path,
    manifest: &PetPackManifest,
    source: PetPackSource,
) -> Result<PetPackSummary, PackError> {
    Ok(PetPackSummary {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        author: manifest.author.clone(),
        description: manifest.description.clone(),
        source,
        renderer: match manifest.renderer {
            super::manifest::PetRendererManifest::Sprite { .. } => PetPackRenderer::Sprite,
            super::manifest::PetRendererManifest::Rive { .. } => PetPackRenderer::Rive,
        },
        preview: manifest.preview.clone(),
        removable: source == PetPackSource::Installed,
        content_hash: hash_directory(root)?,
    })
}

fn hash_directory(root: &Path) -> Result<String, PackError> {
    let mut paths = Vec::new();
    collect_files(root, root, &mut paths)?;
    paths.sort();
    let mut hasher = Sha256::new();
    for relative in paths {
        hasher.update(relative.as_bytes());
        hasher.update([0]);
        let bytes = fs::read(root.join(&relative))
            .map_err(|error| PackError::new("assetUnavailable", error.to_string()))?;
        hasher.update(bytes);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn collect_files(root: &Path, directory: &Path, paths: &mut Vec<String>) -> Result<(), PackError> {
    for entry in fs::read_dir(directory)
        .map_err(|error| PackError::new("assetUnavailable", error.to_string()))?
        .flatten()
    {
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, paths)?;
        } else if path.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| PackError::new("assetUnavailable", error.to_string()))?;
            paths.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(())
}

fn validate_archive_entry(name: &str) -> Result<(), PackError> {
    if name.is_empty() || name.contains('\\') || is_nested_archive(name) {
        return Err(PackError::new("invalidArchivePath", name));
    }
    let path = Path::new(name);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(PackError::new("pathTraversal", name));
    }
    Ok(())
}

fn validate_relative_path(path: &str) -> Result<(), PackError> {
    validate_archive_entry(path)
}

fn validate_pack_id(id: &str) -> Result<(), PackError> {
    if id.is_empty()
        || id.len() > 128
        || !id.contains('.')
        || id.split('.').any(|part| {
            part.is_empty()
                || part.starts_with('-')
                || part.ends_with('-')
                || !part.chars().all(|character| {
                    character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
                })
        })
    {
        return Err(PackError::new("invalidPackId", id));
    }
    Ok(())
}

fn is_nested_archive(path: &str) -> bool {
    path.ends_with(".zip") || path.ends_with(".opet")
}

fn matches_media_magic(path: &str, bytes: &[u8]) -> bool {
    if path.ends_with(".png") {
        return bytes.starts_with(b"\x89PNG\r\n\x1a\n");
    }
    if path.ends_with(".webp") {
        return bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP";
    }
    path.ends_with(".riv") && bytes.starts_with(b"RIVE")
}

fn unique_staging_name() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("install-{}-{nanos}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

    fn temp_root() -> PathBuf {
        let id = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("opencoder-pet-pack-{id}"))
    }

    fn png() -> Vec<u8> {
        b"\x89PNG\r\n\x1a\nfixture".to_vec()
    }

    fn write_fixture_archive(path: &Path, extra: Option<(&str, Vec<u8>)>) {
        write_archive(
            path,
            include_str!("../../../tests/fixtures/pet-packs/valid-sprite/manifest.json"),
            extra,
        );
    }

    fn write_archive(path: &Path, manifest: &str, extra: Option<(&str, Vec<u8>)>) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file(MANIFEST_FILE, options).unwrap();
        zip.write_all(manifest.as_bytes()).unwrap();
        for asset in [
            "preview.webp",
            "assets/idle.webp",
            "assets/working.webp",
            "assets/waiting.webp",
            "assets/success.webp",
            "assets/error.webp",
            "assets/attention.webp",
            "assets/reactions.webp",
        ] {
            zip.start_file(asset, options).unwrap();
            zip.write_all(b"RIFFxxxxWEBPfixture").unwrap();
        }
        if let Some((name, bytes)) = extra {
            zip.start_file(name, options).unwrap();
            zip.write_all(&bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn installs_lists_reads_and_removes_a_valid_pack() {
        let root = temp_root();
        let archive = root.with_extension("opet");
        write_fixture_archive(&archive, None);
        let manager = PetPackManager::with_roots(root.join("bundled"), root.join("data"));
        let installed = manager.install(&archive, false).unwrap();
        assert!(installed.installed);
        assert!(installed.pack.removable);
        assert_eq!(manager.list().unwrap().len(), 1);
        assert_eq!(
            manager
                .read_asset("dev.example.nova", "preview.webp")
                .unwrap(),
            b"RIFFxxxxWEBPfixture"
        );
        manager.remove("dev.example.nova", None).unwrap();
        assert!(manager.list().unwrap().is_empty());
        let _ = fs::remove_file(archive);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_path_traversal_before_writing_outside_staging() {
        let root = temp_root();
        let archive = root.with_extension("opet");
        write_fixture_archive(&archive, Some(("../outside.png", png())));
        let manager = PetPackManager::with_roots(root.join("bundled"), root.join("data"));
        let error = manager.install(&archive, false).unwrap_err();
        assert_eq!(error.code, "pathTraversal");
        assert!(!root.join("outside.png").exists());
        let _ = fs::remove_file(archive);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_non_media_asset_bytes() {
        let root = temp_root();
        let archive = root.with_extension("opet");
        write_fixture_archive(&archive, None);
        let manager = PetPackManager::with_roots(root.join("bundled"), root.join("data"));
        assert!(manager.install(&archive, false).is_ok());
        let path = root.join("data/installed/dev.example.nova/1.2.3/assets/idle.webp");
        fs::write(path, b"not-an-image").unwrap();
        assert!(manager.list().unwrap().is_empty());
        assert_eq!(manager.diagnostics().len(), 1);
        assert!(root
            .join("data/quarantine")
            .read_dir()
            .unwrap()
            .next()
            .is_some());
        let _ = fs::remove_file(archive);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_reserved_ids_and_active_pack_removal() {
        let root = temp_root();
        let archive = root.with_extension("opet");
        let manager = PetPackManager::with_roots(root.join("bundled"), root.join("data"));
        let bundled_manifest =
            include_str!("../../../tests/fixtures/pet-packs/valid-sprite/manifest.json")
                .replace("dev.example.nova", "dev.opencoder.nova");
        write_archive(&archive, &bundled_manifest, None);
        assert_eq!(
            manager.install(&archive, false).unwrap_err().code,
            "reservedPackId"
        );

        let external_manifest =
            include_str!("../../../tests/fixtures/pet-packs/valid-sprite/manifest.json")
                .replace("dev.example.nova", "com.example.nova");
        write_archive(&archive, &external_manifest, None);
        manager.install(&archive, false).unwrap();
        assert_eq!(
            manager
                .remove("com.example.nova", Some("com.example.nova"))
                .unwrap_err()
                .code,
            "currentPackCannotBeRemoved"
        );
        let _ = fs::remove_file(archive);
        let _ = fs::remove_dir_all(root);
    }
}
