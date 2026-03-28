export interface GitRepoStatus {
  branch: string;
  isClean: boolean;
  staged: number;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
  lastCommit: {
    hash: string;
    shortHash: string;
    message: string;
    author: string;
    date: string;
  } | null;
}

export interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
  tracking?: string;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  refs: string;
}

export interface GitFileChange {
  path: string;
  status: "M" | "A" | "D" | "R" | "?" | "U";
  staged: boolean;
}

export interface GitStashEntry {
  index: number;
  message: string;
  date: string;
}

export interface GitConfig {
  userName: string;
  userEmail: string;
}
