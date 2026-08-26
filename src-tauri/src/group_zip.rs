use crate::{cookies, profile};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupManifest {
    pub version: u32,
    pub group_name: String,
    pub exported_at: String,
    pub profiles_count: usize,
    pub profiles: Vec<GroupProfileItem>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupProfileItem {
    pub original_id: String,
    pub name: String,
    pub cookie_file: Option<String>,
    pub cookies_count: usize,
    pub payload: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupExportSummary {
    pub group_name: String,
    pub profiles_count: usize,
    pub total_cookies_count: usize,
    pub file_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GroupImportSummary {
    pub group_name: String,
    pub profiles_imported: usize,
    pub cookies_imported: usize,
    pub profile_ids: Vec<String>,
}

/// Export a group and all its profiles (including decrypted cookies) to a .zip archive.
pub fn export_group_to_zip(folder: &str, zip_path: &Path) -> Result<GroupExportSummary> {
    let folder_name = folder.trim();
    let stored_profiles = profile::load_folder_profiles(folder_name)
        .with_context(|| format!("failed to load profiles for folder '{folder_name}'"))?;

    let file = File::create(zip_path)
        .with_context(|| format!("failed to create zip file at {}", zip_path.display()))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);

    let mut profile_items = Vec::new();
    let mut total_cookies = 0;

    for p in &stored_profiles {
        let profile_id = &p.meta.id;
        let profile_name = p
            .config
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("untitled")
            .to_string();

        // 1. Export cookies for this profile if available
        let profile_cookies = cookies::export(profile_id).unwrap_or_default();
        let cookies_count = profile_cookies.len();
        total_cookies += cookies_count;

        let cookie_rel_path = if cookies_count > 0 {
            let rel_path = format!("cookies/{profile_id}.json");
            zip.start_file(&rel_path, options)?;
            let cookies_json = serde_json::to_string_pretty(&profile_cookies)?;
            zip.write_all(cookies_json.as_bytes())?;
            Some(rel_path)
        } else {
            None
        };

        // 2. Wrap profile payload
        let payload = serde_json::to_value(p)?;
        profile_items.push(GroupProfileItem {
            original_id: profile_id.clone(),
            name: profile_name,
            cookie_file: cookie_rel_path,
            cookies_count,
            payload,
        });
    }

    // 3. Write group manifest (group-data.json)
    let manifest = GroupManifest {
        version: 1,
        group_name: folder_name.to_string(),
        exported_at: chrono_now_iso(),
        profiles_count: profile_items.len(),
        profiles: profile_items,
    };

    zip.start_file("group-data.json", options)?;
    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    zip.write_all(manifest_json.as_bytes())?;

    zip.finish()?;

    Ok(GroupExportSummary {
        group_name: folder_name.to_string(),
        profiles_count: stored_profiles.len(),
        total_cookies_count: total_cookies,
        file_path: zip_path.to_string_lossy().to_string(),
    })
}

/// Import a group and its profile cookies from a .zip archive.
/// Features Zip Slip protection, schema validation, and automatic rollback on failure.
pub fn import_group_from_zip(
    zip_path: &Path,
    target_folder_override: Option<String>,
) -> Result<GroupImportSummary> {
    let file = File::open(zip_path)
        .with_context(|| format!("failed to open zip file at {}", zip_path.display()))?;
    let mut archive = ZipArchive::new(file)
        .with_context(|| format!("invalid or corrupted zip archive: {}", zip_path.display()))?;

    // 1. Read and parse group-data.json manifest
    let mut manifest_data = String::new();
    {
        let mut manifest_file = archive.by_name("group-data.json").context(
            "Zip archive is missing required 'group-data.json' group manifest",
        )?;
        manifest_file.read_to_string(&mut manifest_data)?;
    }

    let manifest: GroupManifest = serde_json::from_str(&manifest_data)
        .context("Failed to parse 'group-data.json' in zip archive")?;

    let final_group_name = match target_folder_override {
        Some(ref f) if !f.trim().is_empty() => f.trim().to_string(),
        _ => {
            if manifest.group_name.is_empty() || manifest.group_name.eq_ignore_ascii_case("all") {
                "Imported Group".to_string()
            } else {
                manifest.group_name.clone()
            }
        }
    };

    // 2. Pre-cache all cookie files from zip into memory (Zip Slip safe)
    let mut cookie_map: std::collections::HashMap<String, Vec<cookies::Cookie>> =
        std::collections::HashMap::new();

    for i in 0..archive.len() {
        let mut zip_entry = archive.by_index(i)?;
        let raw_name = zip_entry.name().to_string();

        // --- Zip Slip (Path Traversal) Protection ---
        let safe_path = match zip_entry.enclosed_name() {
            Some(p) => p.to_owned(),
            None => continue, // Discard unsafe path traversal entries
        };
        if safe_path.is_absolute() || raw_name.contains("..") {
            continue;
        }

        if raw_name.starts_with("cookies/") && raw_name.ends_with(".json") {
            let mut content = Vec::new();
            zip_entry.read_to_end(&mut content)?;
            if let Ok(cookie_list) = serde_json::from_slice::<Vec<cookies::Cookie>>(&content) {
                cookie_map.insert(raw_name, cookie_list);
            }
        }
    }

    // 3. Sequential profile creation with Rollback mechanism
    let mut created_ids: Vec<String> = Vec::new();
    let mut total_cookies_imported = 0;

    let import_result: Result<()> = (|| {
        for item in manifest.profiles {
            let mut payload = item.payload;

            // Generate fresh unique profile ID
            let new_profile_id = uuid::Uuid::new_v4().to_string();

            if let Some(obj) = payload.as_object_mut() {
                match obj.get_mut("_meta").and_then(|m| m.as_object_mut()) {
                    Some(meta) => {
                        meta.insert("id".into(), serde_json::Value::String(new_profile_id.clone()));
                        meta.insert(
                            "folder".into(),
                            serde_json::Value::String(final_group_name.clone()),
                        );
                        meta.insert(
                            "created_at".into(),
                            serde_json::Value::String(chrono_now_iso()),
                        );
                    }
                    None => {
                        obj.insert(
                            "_meta".into(),
                            serde_json::json!({
                                "id": new_profile_id.clone(),
                                "folder": final_group_name.clone(),
                                "created_at": chrono_now_iso(),
                            }),
                        );
                    }
                }
            }

            // Save profile config
            let mut stored: profile::StoredProfile = serde_json::from_value(payload)?;
            stored.meta.id = new_profile_id.clone();
            stored.meta.folder = final_group_name.clone();
            profile::save_raw(&mut stored)?;

            created_ids.push(new_profile_id.clone());

            // Import cookies if present
            if let Some(ref cookie_file_path) = item.cookie_file {
                if let Some(cookies_to_import) = cookie_map.get(cookie_file_path) {
                    if !cookies_to_import.is_empty() {
                        match cookies::import(&new_profile_id, cookies_to_import) {
                            Ok(n) => total_cookies_imported += n,
                            Err(e) => eprintln!(
                                "[zip-import] Warning: Failed to import cookies for profile {}: {}",
                                new_profile_id, e
                            ),
                        }
                    }
                }
            }
        }
        Ok(())
    })();

    // 4. Handle rollback if any error occurred
    if let Err(err) = import_result {
        eprintln!("[zip-import] Error occurred during import. Rolling back {} created profiles...", created_ids.len());
        for id in created_ids {
            let _ = profile::delete(&id);
        }
        bail!("Group import failed and was rolled back: {:#}", err);
    }

    crate::notify_store_changed("profiles");

    Ok(GroupImportSummary {
        group_name: final_group_name,
        profiles_imported: created_ids.len(),
        cookies_imported: total_cookies_imported,
        profile_ids: created_ids,
    })
}

fn chrono_now_iso() -> String {
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("@{s}")
}
