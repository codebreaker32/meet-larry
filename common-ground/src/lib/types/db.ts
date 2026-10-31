// The repository interface lives in src/lib/db/types.ts; this re-export lets callers import every
// shared type from src/lib/types/*.
export type {
  AccountsRepo,
  FriendLink,
  FriendsRepo,
  InvitesRepo,
  PodiumRepo,
  PodiumRow,
  ProfileRecord,
  ProfilesRepo,
  Repo,
  RepoKv,
  StoredAccount,
  StoredInvite,
  SyncRepo,
  UsernamesRepo,
} from "../db/types";
