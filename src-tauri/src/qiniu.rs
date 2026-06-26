use anyhow::{Context, Result};
use base64::engine::general_purpose::{STANDARD, URL_SAFE};
use base64::Engine;
use hmac::{Hmac, Mac};
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha1 = Hmac<Sha1>;

const DEFAULT_UP_HOST: &str = "https://up.qiniup.com";
const KEY_PREFIX: &str = "abratab";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QiniuConfig {
    pub access_key: String,
    pub secret_key: String,
    pub bucket: String,
    pub domain: String,
    #[serde(default)]
    pub up_host: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QiniuStatus {
    pub configured: bool,
    pub access_key: String,
    pub bucket: String,
    pub domain: String,
    pub up_host: String,
    pub config_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UploadResult {
    pub url: String,
    pub key: String,
}

#[derive(Debug, Deserialize)]
struct QiniuUploadResponse {
    key: Option<String>,
    error: Option<String>,
}

pub fn load_status() -> Result<QiniuStatus> {
    let config = load_config().ok();
    Ok(QiniuStatus {
        configured: config.as_ref().is_some_and(|value| {
            !value.access_key.trim().is_empty()
                && !value.secret_key.trim().is_empty()
                && !value.bucket.trim().is_empty()
                && !value.domain.trim().is_empty()
        }),
        access_key: config
            .as_ref()
            .map(|value| value.access_key.clone())
            .unwrap_or_default(),
        bucket: config
            .as_ref()
            .map(|value| value.bucket.clone())
            .unwrap_or_default(),
        domain: config
            .as_ref()
            .map(|value| value.domain.clone())
            .unwrap_or_default(),
        up_host: config
            .as_ref()
            .map(|value| up_host_or_default(&value.up_host))
            .unwrap_or_else(|| DEFAULT_UP_HOST.to_string()),
        config_path: config_path()?.display().to_string(),
    })
}

pub fn save_config(
    access_key: &str,
    secret_key: &str,
    bucket: &str,
    domain: &str,
    up_host: Option<&str>,
) -> Result<QiniuStatus> {
    let existing = load_config().ok();
    let secret_key = secret_key.trim().to_string();
    let config = QiniuConfig {
        access_key: access_key.trim().to_string(),
        // Keep the stored secret if the form left it blank (it is never sent back to the UI).
        secret_key: if secret_key.is_empty() {
            existing
                .as_ref()
                .map(|value| value.secret_key.clone())
                .unwrap_or_default()
        } else {
            secret_key
        },
        bucket: bucket.trim().to_string(),
        domain: normalize_domain(domain.trim()),
        up_host: up_host
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_UP_HOST.to_string()),
    };

    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(&config)?;
    fs::write(&path, json).with_context(|| format!("writing {}", path.display()))?;
    load_status()
}

pub async fn upload(filename: &str, data_base64: &str) -> Result<UploadResult> {
    let config = load_config().context("Qiniu image host is not configured")?;
    if config.access_key.trim().is_empty()
        || config.secret_key.trim().is_empty()
        || config.bucket.trim().is_empty()
        || config.domain.trim().is_empty()
    {
        anyhow::bail!("Qiniu image host is not configured");
    }

    let bytes = STANDARD
        .decode(data_base64.trim())
        .context("decoding pasted image data")?;
    if bytes.is_empty() {
        anyhow::bail!("pasted image was empty");
    }

    let ext = extension_for(filename);
    let key = object_key(&ext)?;
    let token = upload_token(&config);

    let part = Part::bytes(bytes)
        .file_name(format!("paste.{ext}"))
        .mime_str(mime_for(&ext))?;
    let form = Form::new()
        .text("token", token)
        .text("key", key.clone())
        .part("file", part);

    let host = up_host_or_default(&config.up_host);
    let response = Client::new().post(&host).multipart(form).send().await?;
    let status = response.status();
    let text = response.text().await?;
    if !status.is_success() {
        anyhow::bail!("Qiniu upload returned {status}: {text}");
    }

    let parsed: QiniuUploadResponse =
        serde_json::from_str(&text).context("parsing Qiniu upload response")?;
    if let Some(error) = parsed.error {
        anyhow::bail!("Qiniu upload failed: {error}");
    }
    let returned_key = parsed.key.unwrap_or(key);
    let url = format!(
        "{}/{}",
        config.domain.trim_end_matches('/'),
        returned_key.trim_start_matches('/')
    );
    Ok(UploadResult {
        url,
        key: returned_key,
    })
}

fn upload_token(config: &QiniuConfig) -> String {
    let deadline = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
        + 3600;
    let policy = serde_json::json!({
        "scope": config.bucket,
        "deadline": deadline,
    })
    .to_string();
    let encoded_policy = URL_SAFE.encode(policy.as_bytes());

    let mut mac = HmacSha1::new_from_slice(config.secret_key.as_bytes())
        .expect("HMAC accepts keys of any size");
    mac.update(encoded_policy.as_bytes());
    let sign = URL_SAFE.encode(mac.finalize().into_bytes());

    format!("{}:{}:{}", config.access_key, sign, encoded_policy)
}

fn object_key(ext: &str) -> Result<String> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?;
    Ok(format!(
        "{KEY_PREFIX}/{}{:09}.{ext}",
        now.as_secs(),
        now.subsec_nanos()
    ))
}

fn extension_for(filename: &str) -> String {
    filename
        .rsplit('.')
        .next()
        .filter(|ext| !ext.is_empty() && ext.len() <= 5 && *ext != filename)
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_else(|| "png".to_string())
}

fn mime_for(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

fn normalize_domain(domain: &str) -> String {
    let trimmed = domain.trim_end_matches('/');
    if trimmed.is_empty() || trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    }
}

fn up_host_or_default(host: &str) -> String {
    let trimmed = host.trim();
    if trimmed.is_empty() {
        DEFAULT_UP_HOST.to_string()
    } else {
        trimmed.trim_end_matches('/').to_string()
    }
}

fn load_config() -> Result<QiniuConfig> {
    let path = config_path()?;
    let text = fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parsing {}", path.display()))
}

fn config_path() -> Result<PathBuf> {
    let base = dirs::data_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join(".local/share")))
        .context("could not find a data directory")?;
    Ok(base.join("AbraTab").join("qiniu.json"))
}
