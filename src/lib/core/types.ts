// ── Service & Run Config Types ──────────────────────────────────────────────

export type ServiceType = "web" | "api" | "worker" | "database" | "cache" | "custom";

export interface ServiceDef {
  type: ServiceType;
  command: string;
  cwd: string; // relative to project root
  port?: number;
  auto_port?: boolean;
  health_check?: string;
  ready_pattern?: string; // regex to detect "service ready" in output
  depends_on?: string[];
  env?: Record<string, string>;
}

export interface RunConfigMetadata {
  created_by: string;
  created_at: string;
  last_modified_by: string;
  last_modified_at: string;
}

export interface RunConfigEnvironment {
  node_version?: string;
  required_tools?: string[];
}

export interface RunConfig {
  version: number;
  project_name: string;
  services: Record<string, ServiceDef>;
  environment?: RunConfigEnvironment;
  metadata?: RunConfigMetadata;
}

// ── Service Runtime Status ──────────────────────────────────────────────────

export type ServiceState = "stopped" | "starting" | "running" | "error" | "stopping";

export interface ServiceStatus {
  name: string;
  state: ServiceState;
  port?: number;
  pid?: number;
  sessionId?: string;
  error?: string;
}

export interface ServiceTopology {
  services: Record<string, ServiceDef>;
  startOrder: string[];
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Skills Types ────────────────────────────────────────────────────────────

export type SkillsScope = "global" | "project";

// ── Re-export existing types for convenience ────────────────────────────────

export type { GlobalConfig, ProjectEntry, GlobalPermissions } from "@/lib/globalConfig";
export type { OpenCanvasConfig, AgentConfig, McpServer, SessionConfig } from "@/lib/config";
