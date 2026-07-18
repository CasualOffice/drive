//! Roles, the capability set (`Permission`), and the role → permission matrix.
//! Spec: docs/design/foundation-access-rag-mcp.md §2.
//!
//! This module is pure (no I/O): the RBAC truth table lives here so handlers
//! never hard-code role strings. `dochub-authz`'s resolver (`crate::resolve`)
//! unions role permissions with `acl_grants` to produce effective permissions.

/// A role, per scope (workspace and project). `Owner ⊃ Admin ⊃ Editor ⊃
/// Viewer`. The legacy workspace `member` maps to `Editor`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    Viewer,
    Editor,
    Admin,
    Owner,
}

impl Role {
    /// Parse a stored role string (`acl_grants.role`, `project_members.role`,
    /// `workspace_members.role`). Deny-by-default in spirit: an unknown string
    /// maps to the least-privileged real role (`Editor`) only for the legacy
    /// `member` alias; anything else falls back to `Viewer`.
    #[must_use]
    pub fn from_db(s: &str) -> Option<Self> {
        match s {
            "viewer" => Some(Self::Viewer),
            // Legacy workspace membership stored `member`; it maps to Editor
            // (see the 0023 backfill note).
            "editor" | "member" => Some(Self::Editor),
            "admin" => Some(Self::Admin),
            "owner" => Some(Self::Owner),
            _ => None,
        }
    }

    /// Canonical lowercase name for persistence.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Viewer => "viewer",
            Self::Editor => "editor",
            Self::Admin => "admin",
            Self::Owner => "owner",
        }
    }

    /// The permissions this role grants (the §2 matrix).
    #[must_use]
    pub fn permissions(self) -> PermSet {
        role_permissions(self)
    }
}

/// The capability set. Each variant is one bit in a [`PermSet`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Permission {
    View,
    Download,
    Comment,
    Edit,
    Create,
    Delete,
    Share,
    ManageMembers,
    ManageSettings,
    ManageRetention,
    ManageKeys,
}

impl Permission {
    #[must_use]
    const fn bit(self) -> u16 {
        match self {
            Self::View => 1 << 0,
            Self::Download => 1 << 1,
            Self::Comment => 1 << 2,
            Self::Edit => 1 << 3,
            Self::Create => 1 << 4,
            Self::Delete => 1 << 5,
            Self::Share => 1 << 6,
            Self::ManageMembers => 1 << 7,
            Self::ManageSettings => 1 << 8,
            Self::ManageRetention => 1 << 9,
            Self::ManageKeys => 1 << 10,
        }
    }
}

/// A bitset of [`Permission`]s. Cheap to copy, union, and test.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PermSet(u16);

impl PermSet {
    /// The empty set — deny-by-default.
    pub const EMPTY: Self = Self(0);

    /// Every permission (a superadmin's effective set).
    #[must_use]
    pub const fn all() -> Self {
        Self(
            Permission::View.bit()
                | Permission::Download.bit()
                | Permission::Comment.bit()
                | Permission::Edit.bit()
                | Permission::Create.bit()
                | Permission::Delete.bit()
                | Permission::Share.bit()
                | Permission::ManageMembers.bit()
                | Permission::ManageSettings.bit()
                | Permission::ManageRetention.bit()
                | Permission::ManageKeys.bit(),
        )
    }

    /// Build a set from a slice of permissions.
    #[must_use]
    pub fn from_slice(perms: &[Permission]) -> Self {
        let mut bits = 0u16;
        for p in perms {
            bits |= p.bit();
        }
        Self(bits)
    }

    /// Union of two sets (used to accumulate role perms + grants).
    #[must_use]
    pub fn union(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }

    /// True when `perm` is present.
    #[must_use]
    pub fn contains(self, perm: Permission) -> bool {
        self.0 & perm.bit() != 0
    }

    /// True when `self` holds every permission in `other` (i.e. `other ⊆ self`).
    /// Used to enforce that a grant never exceeds the granter's own access.
    #[must_use]
    pub fn is_superset(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    /// True when no permission is set.
    #[must_use]
    pub fn is_empty(self) -> bool {
        self.0 == 0
    }
}

/// The role → permission matrix (§2). `Owner` and `Admin` share the same
/// capability bitset; the Owner-only distinctions (transfer / delete workspace)
/// are enforced separately, not modelled as permission bits.
#[must_use]
pub fn role_permissions(role: Role) -> PermSet {
    use Permission::{
        Comment, Create, Delete, Download, Edit, ManageKeys, ManageMembers, ManageRetention,
        ManageSettings, Share, View,
    };
    match role {
        Role::Viewer => PermSet::from_slice(&[View, Download, Comment]),
        Role::Editor => {
            PermSet::from_slice(&[View, Download, Comment, Edit, Create, Delete, Share])
        }
        Role::Admin | Role::Owner => PermSet::from_slice(&[
            View,
            Download,
            Comment,
            Edit,
            Create,
            Delete,
            Share,
            ManageMembers,
            ManageSettings,
            ManageRetention,
            ManageKeys,
        ]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewer_can_view_but_not_edit() {
        let p = role_permissions(Role::Viewer);
        assert!(p.contains(Permission::View));
        assert!(p.contains(Permission::Download));
        assert!(p.contains(Permission::Comment));
        assert!(!p.contains(Permission::Edit));
        assert!(!p.contains(Permission::Create));
        assert!(!p.contains(Permission::Delete));
        assert!(!p.contains(Permission::Share));
        assert!(!p.contains(Permission::ManageMembers));
    }

    #[test]
    fn editor_can_edit_and_share_but_not_manage() {
        let p = role_permissions(Role::Editor);
        assert!(p.contains(Permission::View));
        assert!(p.contains(Permission::Edit));
        assert!(p.contains(Permission::Create));
        assert!(p.contains(Permission::Delete));
        assert!(p.contains(Permission::Share));
        assert!(!p.contains(Permission::ManageMembers));
        assert!(!p.contains(Permission::ManageSettings));
        assert!(!p.contains(Permission::ManageRetention));
        assert!(!p.contains(Permission::ManageKeys));
    }

    #[test]
    fn admin_and_owner_can_manage_everything() {
        for role in [Role::Admin, Role::Owner] {
            let p = role_permissions(role);
            assert!(p.contains(Permission::ManageMembers));
            assert!(p.contains(Permission::ManageSettings));
            assert!(p.contains(Permission::ManageRetention));
            assert!(p.contains(Permission::ManageKeys));
            assert!(p.contains(Permission::Edit));
        }
        assert_eq!(role_permissions(Role::Admin), role_permissions(Role::Owner));
        assert_eq!(role_permissions(Role::Owner), PermSet::all());
    }

    #[test]
    fn empty_set_denies_by_default() {
        let p = PermSet::EMPTY;
        for perm in [
            Permission::View,
            Permission::Edit,
            Permission::Delete,
            Permission::ManageKeys,
        ] {
            assert!(!p.contains(perm));
        }
        assert!(p.is_empty());
    }

    #[test]
    fn union_accumulates() {
        let a = PermSet::from_slice(&[Permission::View]);
        let b = PermSet::from_slice(&[Permission::Edit]);
        let u = a.union(b);
        assert!(u.contains(Permission::View));
        assert!(u.contains(Permission::Edit));
        assert!(!u.contains(Permission::Delete));
    }

    #[test]
    fn role_roundtrips_through_db_string() {
        for role in [Role::Viewer, Role::Editor, Role::Admin, Role::Owner] {
            assert_eq!(Role::from_db(role.as_str()), Some(role));
        }
        assert_eq!(Role::from_db("member"), Some(Role::Editor));
        assert_eq!(Role::from_db("nonsense"), None);
    }
}
