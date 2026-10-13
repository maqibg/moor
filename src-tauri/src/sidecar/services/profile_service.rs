//! Profile 领域服务。
//!
//! 封装 Profile 持久化和领域事件发射,让路由层只负责 HTTP 形状。

use crate::sidecar::db::profile_repo::{
    Profile, ProfileDetailServer, ProfileRepository, ProfileServerState, ProfileServerUpsertInput,
    RemoveResult,
};
use crate::sidecar::db::server_repo::ServerRepository;
use crate::sidecar::db::Database;
use crate::sidecar::services::event_bus::{EventBus, Evt};
use crate::sidecar::services::tool_catalog::{ProfileToolGroup, ToolCatalogService};
use std::collections::HashSet;
use std::sync::Arc;

pub struct ProfileService;

/// profile 操作可能产生的领域错误。与 ServerServiceError 对齐,
/// 让路由层能把 NotFound 等映射到正确的 HTTP 状态码。
#[derive(Debug)]
pub enum ProfileServiceError {
    NotFound(String),
    Validation(String),
    Active(String),
    Internal(String),
}

/// 单一映射点:ProfileServiceError → AppError。
impl From<ProfileServiceError> for crate::sidecar::http::app_error::AppError {
    fn from(e: ProfileServiceError) -> Self {
        match e {
            ProfileServiceError::NotFound(m) => Self::not_found(m),
            ProfileServiceError::Validation(m) => Self::validation(m),
            ProfileServiceError::Active(m) => Self::active_profile(m),
            ProfileServiceError::Internal(m) => Self::internal(m),
        }
    }
}

impl ProfileService {
    pub fn list(db: &Database) -> Result<Vec<Profile>, ProfileServiceError> {
        ProfileRepository::new(db)
            .find_all()
            .map_err(ProfileServiceError::Internal)
    }

    pub fn create(db: &Database, name: &str) -> Result<Profile, ProfileServiceError> {
        if name.is_empty() {
            return Err(ProfileServiceError::Validation("name is required".into()));
        }
        ProfileRepository::new(db)
            .create(name)
            .map_err(ProfileServiceError::Internal)
    }

    pub fn get_detail(
        db: &Database,
        id: &str,
    ) -> Result<(Profile, Vec<ProfileDetailServer>), ProfileServiceError> {
        let repo = ProfileRepository::new(db);
        let profile = repo
            .find_by_id(id)
            .map_err(ProfileServiceError::Internal)?
            .ok_or_else(|| ProfileServiceError::NotFound("Profile not found".into()))?;
        let servers = repo
            .find_profile_servers(id)
            .map_err(ProfileServiceError::Internal)?;
        Ok((profile, servers))
    }

    pub fn update(
        db: &Database,
        id: &str,
        name: Option<&str>,
    ) -> Result<Profile, ProfileServiceError> {
        ProfileRepository::new(db)
            .update(id, name)
            .map_err(ProfileServiceError::Internal)?
            .ok_or_else(|| ProfileServiceError::NotFound("Profile not found".into()))
    }

    pub fn remove(db: &Database, id: &str) -> Result<(), ProfileServiceError> {
        match ProfileRepository::new(db)
            .remove(id)
            .map_err(ProfileServiceError::Internal)?
        {
            RemoveResult::Success => Ok(()),
            RemoveResult::NotFound => {
                Err(ProfileServiceError::NotFound("Profile not found".into()))
            }
            RemoveResult::Active => Err(ProfileServiceError::Active(
                "Cannot delete active profile".into(),
            )),
        }
    }

    /// 激活 profile 并发出 `profile:activated` 事件。
    /// 事件发射是领域规则——切了活动 profile,相关缓存(profiles/servers/logs)该失效——
    /// 所以它属于 service,不属于路由层。
    pub fn activate(
        db: &Database,
        event_bus: &Arc<EventBus>,
        id: &str,
    ) -> Result<Profile, ProfileServiceError> {
        let profile = ProfileRepository::new(db)
            .activate(id)
            .map_err(ProfileServiceError::Internal)?
            .ok_or_else(|| ProfileServiceError::NotFound("Profile not found".into()))?;
        event_bus.emit(Evt::ProfileActivated {
            profile_id: id.to_string(),
        });
        Ok(profile)
    }

    pub fn get_profile_server(
        db: &Database,
        profile_id: &str,
        server_id: &str,
    ) -> Result<ProfileDetailServer, ProfileServiceError> {
        let servers = ProfileRepository::new(db)
            .find_profile_servers(profile_id)
            .map_err(ProfileServiceError::Internal)?;
        servers
            .into_iter()
            .find(|s| s.server.id == server_id)
            .ok_or_else(|| ProfileServiceError::NotFound("Server not found in profile".into()))
    }

    pub fn upsert_profile_server(
        db: &Database,
        event_bus: &Arc<EventBus>,
        profile_id: &str,
        server_id: &str,
        enabled: Option<bool>,
        disabled_tools: Option<&Vec<String>>,
    ) -> Result<ProfileServerState, ProfileServiceError> {
        let repo = ProfileRepository::new(db);
        let state = repo
            .upsert_profile_server(profile_id, server_id, enabled, disabled_tools)
            .map_err(ProfileServiceError::Internal)?;
        let active_profile_id = repo
            .find_active_id()
            .map_err(ProfileServiceError::Internal)?;
        if active_profile_id.as_deref() == Some(profile_id) {
            event_bus.emit(Evt::ServerTools {
                server_id: server_id.to_string(),
            });
        }
        Ok(state)
    }

    /// 批量治理写入。与单条接口共用 ProfileRepository 的合并语义，
    /// 并在目标 profile 处于激活态时按服务器发出目录变更事件。
    pub fn upsert_profile_servers_batch(
        db: &Database,
        event_bus: &Arc<EventBus>,
        profile_id: &str,
        items: &[ProfileServerUpsertInput],
    ) -> Result<(), ProfileServiceError> {
        let repo = ProfileRepository::new(db);
        repo.find_by_id(profile_id)
            .map_err(ProfileServiceError::Internal)?
            .ok_or_else(|| ProfileServiceError::NotFound("Profile not found".into()))?;
        if items.is_empty() {
            return Ok(());
        }
        let server_ids: Vec<String> = items.iter().map(|item| item.server_id.clone()).collect();
        Self::ensure_servers_exist(db, &server_ids)?;
        // 先读激活态：放在写入之后会把「已落库但读激活态失败」误报为整体失败。
        let active_profile_id = repo
            .find_active_id()
            .map_err(ProfileServiceError::Internal)?;
        repo.upsert_profile_servers_batch(profile_id, items)
            .map_err(ProfileServiceError::Internal)?;

        if active_profile_id.as_deref() == Some(profile_id) {
            let mut emitted: HashSet<&str> = HashSet::new();
            for server_id in &server_ids {
                if emitted.insert(server_id.as_str()) {
                    event_bus.emit(Evt::ServerTools {
                        server_id: server_id.clone(),
                    });
                }
            }
        }
        Ok(())
    }

    /// 克隆 profile（含服务器绑定与工具禁用态），新 profile 恒为非激活。
    pub fn clone_profile(
        db: &Database,
        source_id: &str,
        name: &str,
    ) -> Result<Profile, ProfileServiceError> {
        if name.trim().is_empty() {
            return Err(ProfileServiceError::Validation("name is required".into()));
        }
        ProfileRepository::new(db)
            .clone_profile(source_id, name)
            .map_err(ProfileServiceError::Internal)?
            .ok_or_else(|| ProfileServiceError::NotFound("Profile not found".into()))
    }

    /// 治理面板的分组工具矩阵。profile 不存在时返回 NotFound。
    pub fn get_profile_tool_groups(
        db: &Database,
        profile_id: &str,
    ) -> Result<Vec<ProfileToolGroup>, ProfileServiceError> {
        ProfileRepository::new(db)
            .find_by_id(profile_id)
            .map_err(ProfileServiceError::Internal)?
            .ok_or_else(|| ProfileServiceError::NotFound("Profile not found".into()))?;
        Ok(ToolCatalogService::get_profile_tool_groups(db, profile_id))
    }

    /// 批量写入前统一校验服务器存在，避免部分写入后才发现无效 id。
    fn ensure_servers_exist(
        db: &Database,
        server_ids: &[String],
    ) -> Result<(), ProfileServiceError> {
        let known: HashSet<String> = ServerRepository::new(db)
            .find_by_ids(server_ids)
            .map_err(ProfileServiceError::Internal)?
            .into_iter()
            .map(|server| server.id)
            .collect();
        let missing: Vec<&str> = server_ids
            .iter()
            .filter(|id| !known.contains(*id))
            .map(|id| id.as_str())
            .collect();
        if !missing.is_empty() {
            return Err(ProfileServiceError::Validation(format!(
                "unknown server ids: {missing:?}"
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use std::time::SystemTime;

    fn temp_db_path(test_name: &str) -> std::path::PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system time is before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("moor-profile-service-{test_name}-{timestamp}.db"))
    }

    #[test]
    fn validation_error_maps_to_bad_request() {
        let err: crate::sidecar::http::app_error::AppError =
            ProfileServiceError::Validation("name is required".into()).into();

        assert_eq!(err.status_code(), StatusCode::BAD_REQUEST);
        assert_eq!(err.code(), "VALIDATION_ERROR");
    }

    #[test]
    fn active_profile_tool_changes_emit_catalog_event() {
        let db_path = temp_db_path("catalog-event");
        let db = Database::open(&db_path).expect("failed to open db");
        db.run_migrations().expect("failed to migrate db");
        let profile_repo = ProfileRepository::new(&db);
        profile_repo.seed_default().expect("failed to seed profile");
        let profile_id = profile_repo
            .find_active_id()
            .expect("failed to read active profile")
            .expect("active profile should exist");
        let server_id = "server-a";
        crate::sidecar::db::server_repo::ServerRepository::new(&db)
            .insert_one_with_id(
                server_id,
                0,
                &crate::sidecar::db::server_repo::ServerInsertInput {
                    name: "Server A".to_string(),
                    connection_type: "stdio".to_string(),
                    command: Some("node".to_string()),
                    args: None,
                    url: None,
                    env: None,
                    headers: None,
                    working_dir: None,
                    auto_start: false,
                },
            )
            .expect("failed to insert server");
        profile_repo
            .assign_to_active_profile(&[server_id.to_string()])
            .expect("failed to assign server");

        let event_bus = Arc::new(EventBus::new(4));
        let mut receiver = event_bus.subscribe();
        ProfileService::upsert_profile_server(
            &db,
            &event_bus,
            &profile_id,
            server_id,
            Some(false),
            None,
        )
        .expect("profile server update should succeed");

        match receiver
            .try_recv()
            .expect("catalog event should be emitted")
        {
            Evt::ServerTools { server_id: emitted } => assert_eq!(emitted, server_id),
            event => panic!("unexpected event: {}", event.name()),
        }
        drop(db);
        let _ = std::fs::remove_file(db_path);
    }
}
