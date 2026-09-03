#[derive(Debug)]
pub struct DeploymentConfig {
    pub port: u16,
    pub secret: String,
    data_dir: String,
}

impl DeploymentConfig {
    pub fn from_env() -> Result<Self, String> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    pub(crate) fn from_lookup<F>(lookup: F) -> Result<Self, String>
    where
        F: Fn(&str) -> Option<String>,
    {
        let port = lookup("PORT").unwrap_or_else(|| "4000".to_owned());
        let port = port
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0)
            .ok_or_else(|| "PORT must be an integer from 1 through 65535".to_owned())?;

        let secret = lookup("VOXELIZE_SECRET").unwrap_or_else(|| "test".to_owned());
        if secret.trim().is_empty() {
            return Err("VOXELIZE_SECRET must not be blank".to_owned());
        }

        Ok(Self {
            port,
            secret,
            data_dir: lookup("VOXELIZE_DATA_DIR").unwrap_or_else(|| "data".to_owned()),
        })
    }

    pub fn world_save_dir(&self, world: &str) -> String {
        format!("{}/worlds/{world}", self.data_dir.trim_end_matches('/'))
    }
}
