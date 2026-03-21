"use client";

import { useState, useEffect } from "react";
import { Activity, Clock, CheckCircle, AlertCircle } from "lucide-react";

interface Job {
  id: string;
  agent: string;
  status: "running" | "completed" | "failed";
  description: string;
  startedAt: string;
  duration?: string;
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    // TODO: connect to real job tracking
    // For now, show placeholder
  }, []);

  const statusIcon = (status: Job["status"]) => {
    switch (status) {
      case "running":
        return <Activity size={14} className="text-[var(--accent)] animate-pulse" />;
      case "completed":
        return <CheckCircle size={14} className="text-[var(--success)]" />;
      case "failed":
        return <AlertCircle size={14} className="text-[var(--error)]" />;
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Jobs</h1>
        <span className="text-xs text-[var(--text-muted)]">
          Active agent tasks and history
        </span>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-12 text-center space-y-3">
          <Activity size={40} className="text-[var(--text-muted)] mx-auto" />
          <p className="text-[var(--text-secondary)]">No active jobs</p>
          <p className="text-xs text-[var(--text-muted)]">
            Jobs will appear here when your coding agent is working on
            something. Go to the Workspace and start a session.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg px-4 py-3 flex items-center gap-4"
            >
              {statusIcon(job.status)}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--text-primary)] truncate">
                  {job.description}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {job.agent} &middot; Started {job.startedAt}
                  {job.duration && ` &middot; ${job.duration}`}
                </p>
              </div>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  job.status === "running"
                    ? "bg-blue-500/20 text-blue-400"
                    : job.status === "completed"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-red-500/20 text-red-400"
                }`}
              >
                {job.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
