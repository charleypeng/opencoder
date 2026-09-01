//! Pet pack manifest types and semantic validation.
//!
//! The JSON Schema in `docs/schemas/pet-pack-v1.schema.json` is the public
//! authoring contract. This module mirrors the security-sensitive rules in
//! Rust, because imported archives are untrusted and must not depend on a
//! frontend schema validator.

use semver::Version;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path};

pub const PACK_SCHEMA_VERSION: u32 = 1;
pub const MAX_TEXT_LENGTH: usize = 500;
pub const MAX_ASSET_PATH_LENGTH: usize = 240;
pub const PET_STATES: [&str; 6] = [
    "idle",
    "working",
    "waiting",
    "success",
    "error",
    "attention",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestError {
    pub code: &'static str,
    pub detail: String,
}

impl ManifestError {
    fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for ManifestError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.detail)
    }
}

impl std::error::Error for ManifestError {}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PetPackManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub license: Option<String>,
    pub description: Option<String>,
    pub preview: String,
    pub renderer: PetRendererManifest,
    pub interaction: Option<PetInteractionManifest>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PetRendererManifest {
    Sprite {
        pixelated: bool,
        canvas: PetCanvas,
        states: PetSpriteStates,
        reactions: Option<PetSpriteReactions>,
    },
    Rive {
        asset: String,
        artboard: String,
        state_machine: String,
        inputs: PetRiveInputs,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PetCanvas {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PetSpriteStates {
    pub idle: PetAnimation,
    pub working: Option<PetAnimation>,
    pub waiting: Option<PetAnimation>,
    pub success: Option<PetAnimation>,
    pub error: Option<PetAnimation>,
    pub attention: Option<PetAnimation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PetAnimation {
    pub asset: String,
    pub frames: u16,
    pub fps: u8,
    pub r#loop: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PetSpriteReactions {
    pub tap: Option<PetReaction>,
    pub hover: Option<PetReaction>,
    pub press: Option<PetReaction>,
    pub drag_start: Option<PetReaction>,
    pub drop: Option<PetReaction>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged, rename_all = "camelCase")]
pub enum PetReaction {
    State {
        state: String,
    },
    Frames {
        asset: String,
        #[serde(rename = "startFrame")]
        start_frame: u16,
        frames: u16,
        fps: u8,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PetRiveInputs {
    pub state: String,
    pub intensity: String,
    pub tap: Option<String>,
    pub hovered: Option<String>,
    pub dragging: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PetInteractionManifest {
    pub hitbox: Option<PetHitbox>,
    pub tap_reverts_after_ms: Option<u16>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PetHitbox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl PetPackManifest {
    pub fn parse(contents: &str) -> Result<Self, ManifestError> {
        let manifest: Self = serde_json::from_str(contents)
            .map_err(|err| ManifestError::new("invalidManifest", err.to_string()))?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate(&self) -> Result<(), ManifestError> {
        if self.schema_version != PACK_SCHEMA_VERSION {
            return Err(ManifestError::new(
                "unsupportedSchemaVersion",
                format!(
                    "expected {PACK_SCHEMA_VERSION}, got {}",
                    self.schema_version
                ),
            ));
        }
        validate_id(&self.id)?;
        validate_text("name", &self.name, 80)?;
        validate_semver(&self.version)?;
        validate_text("author", &self.author, 120)?;
        if let Some(license) = &self.license {
            validate_text("license", license, 120)?;
        }
        if let Some(description) = &self.description {
            validate_text("description", description, MAX_TEXT_LENGTH)?;
        }
        validate_asset_path(&self.preview, AssetKind::Image)?;
        match &self.renderer {
            PetRendererManifest::Sprite {
                canvas,
                states,
                reactions,
                ..
            } => {
                if !(16..=2048).contains(&canvas.width) || !(16..=2048).contains(&canvas.height) {
                    return Err(ManifestError::new(
                        "invalidCanvas",
                        "canvas must be 16-2048px",
                    ));
                }
                for animation in states.iter() {
                    validate_animation(animation)?;
                }
                if let Some(reactions) = reactions {
                    for reaction in reactions.iter() {
                        validate_reaction(reaction)?;
                    }
                }
            }
            PetRendererManifest::Rive {
                asset,
                artboard,
                state_machine,
                inputs,
            } => {
                validate_asset_path(asset, AssetKind::Rive)?;
                validate_text("artboard", artboard, 80)?;
                validate_text("stateMachine", state_machine, 80)?;
                for input in inputs.iter() {
                    validate_text("rive input", input, 80)?;
                }
            }
        }
        if let Some(interaction) = &self.interaction {
            if let Some(hitbox) = &interaction.hitbox {
                let values = [hitbox.x, hitbox.y, hitbox.width, hitbox.height];
                if values
                    .iter()
                    .any(|value| !value.is_finite() || !(0.0..=1.0).contains(value))
                    || hitbox.width == 0.0
                    || hitbox.height == 0.0
                {
                    return Err(ManifestError::new(
                        "invalidHitbox",
                        "hitbox values must be 0-1",
                    ));
                }
            }
            if let Some(duration) = interaction.tap_reverts_after_ms {
                if !(250..=10_000).contains(&duration) {
                    return Err(ManifestError::new(
                        "invalidTapDuration",
                        "tapRevertsAfterMs must be 250-10000",
                    ));
                }
            }
        }
        Ok(())
    }

    pub fn referenced_assets(&self) -> Vec<&str> {
        let mut assets = vec![self.preview.as_str()];
        match &self.renderer {
            PetRendererManifest::Sprite {
                states, reactions, ..
            } => {
                assets.extend(states.iter().map(|animation| animation.asset.as_str()));
                if let Some(reactions) = reactions {
                    assets.extend(reactions.iter().filter_map(|reaction| match reaction {
                        PetReaction::Frames { asset, .. } => Some(asset.as_str()),
                        PetReaction::State { .. } => None,
                    }));
                }
            }
            PetRendererManifest::Rive { asset, .. } => assets.push(asset),
        }
        assets
    }
}

impl PetSpriteStates {
    fn iter(&self) -> impl Iterator<Item = &PetAnimation> {
        [
            Some(&self.idle),
            self.working.as_ref(),
            self.waiting.as_ref(),
            self.success.as_ref(),
            self.error.as_ref(),
            self.attention.as_ref(),
        ]
        .into_iter()
        .flatten()
    }
}

impl PetSpriteReactions {
    fn iter(&self) -> impl Iterator<Item = &PetReaction> {
        [
            self.tap.as_ref(),
            self.hover.as_ref(),
            self.press.as_ref(),
            self.drag_start.as_ref(),
            self.drop.as_ref(),
        ]
        .into_iter()
        .flatten()
    }
}

impl PetRiveInputs {
    fn iter(&self) -> impl Iterator<Item = &str> {
        [
            Some(self.state.as_str()),
            Some(self.intensity.as_str()),
            self.tap.as_deref(),
            self.hovered.as_deref(),
            self.dragging.as_deref(),
        ]
        .into_iter()
        .flatten()
    }
}

#[derive(Clone, Copy)]
enum AssetKind {
    Image,
    Rive,
}

fn validate_animation(animation: &PetAnimation) -> Result<(), ManifestError> {
    validate_asset_path(&animation.asset, AssetKind::Image)?;
    if !(1..=120).contains(&animation.frames) || !(1..=30).contains(&animation.fps) {
        return Err(ManifestError::new(
            "invalidAnimation",
            "frames must be 1-120 and fps must be 1-30",
        ));
    }
    Ok(())
}

fn validate_reaction(reaction: &PetReaction) -> Result<(), ManifestError> {
    match reaction {
        PetReaction::State { state } => {
            if PET_STATES.contains(&state.as_str()) {
                Ok(())
            } else {
                Err(ManifestError::new("invalidReactionState", state))
            }
        }
        PetReaction::Frames {
            asset, frames, fps, ..
        } => validate_animation(&PetAnimation {
            asset: asset.clone(),
            frames: *frames,
            fps: *fps,
            r#loop: false,
        }),
    }
}

fn validate_id(id: &str) -> Result<(), ManifestError> {
    if id.len() < 3
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
        return Err(ManifestError::new("invalidPackId", id));
    }
    Ok(())
}

fn validate_semver(version: &str) -> Result<(), ManifestError> {
    Version::parse(version).map_err(|err| ManifestError::new("invalidVersion", err.to_string()))?;
    Ok(())
}

fn validate_text(field: &str, value: &str, max_len: usize) -> Result<(), ManifestError> {
    if value.trim().is_empty() || value.len() > max_len || value.contains('\0') {
        return Err(ManifestError::new("invalidText", field));
    }
    Ok(())
}

fn validate_asset_path(path: &str, kind: AssetKind) -> Result<(), ManifestError> {
    let extension_ok = match kind {
        AssetKind::Image => path.ends_with(".png") || path.ends_with(".webp"),
        AssetKind::Rive => path.ends_with(".riv"),
    };
    let parsed = Path::new(path);
    if path.is_empty()
        || path.len() > MAX_ASSET_PATH_LENGTH
        || path.contains('\\')
        || parsed.is_absolute()
        || !extension_ok
        || parsed
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(ManifestError::new("invalidAssetPath", path));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sprite_manifest() -> PetPackManifest {
        PetPackManifest::parse(include_str!(
            "../../../tests/fixtures/pet-packs/valid-sprite/manifest.json"
        ))
        .unwrap()
    }

    #[test]
    fn parses_the_shared_sprite_fixture() {
        let manifest = sprite_manifest();
        assert_eq!(manifest.id, "dev.example.nova");
        assert_eq!(manifest.referenced_assets().len(), 9);
    }

    #[test]
    fn rejects_path_traversal_and_executable_assets() {
        let mut manifest = sprite_manifest();
        manifest.preview = "../preview.webp".to_string();
        assert_eq!(manifest.validate().unwrap_err().code, "invalidAssetPath");
        manifest.preview = "preview.js".to_string();
        assert_eq!(manifest.validate().unwrap_err().code, "invalidAssetPath");
    }

    #[test]
    fn rejects_invalid_ids_and_versions() {
        let mut manifest = sprite_manifest();
        manifest.id = "Nope".to_string();
        assert_eq!(manifest.validate().unwrap_err().code, "invalidPackId");
        manifest.id = "dev.example.nova".to_string();
        manifest.version = "version one".to_string();
        assert_eq!(manifest.validate().unwrap_err().code, "invalidVersion");
    }
}
