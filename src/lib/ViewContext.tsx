"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

export type ViewId =
  | "workspace"
  | "jobs"
  | "usage"
  | "ports"
  | "project"
  | "settings"
  | "data"
  | "appify"
  | "projects";

const VIEW_PATHS: Record<ViewId, string> = {
  workspace: "/workspace",
  jobs: "/jobs",
  usage: "/usage",
  ports: "/ports",
  project: "/project",
  settings: "/settings",
  data: "/data",
  appify: "/appify",
  projects: "/projects",
};

const PATH_TO_VIEW: Record<string, ViewId> = Object.fromEntries(
  Object.entries(VIEW_PATHS).map(([k, v]) => [v, k as ViewId])
);

interface ViewContextType {
  view: ViewId;
  setView: (view: ViewId) => void;
  viewHistory: ViewId[];
  goBack: () => void;
}

const ViewContext = createContext<ViewContextType | null>(null);

// ── URL helpers that preserve ?project= param ─────────────────────────────

function buildUrl(viewPath: string): string {
  if (typeof window === "undefined") return viewPath;
  const url = new URL(window.location.href);
  url.pathname = viewPath;
  // Preserve project param
  return url.pathname + url.search;
}

function getInitialView(): ViewId {
  if (typeof window === "undefined") return "workspace";
  const path = window.location.pathname;
  return PATH_TO_VIEW[path] || "workspace";
}

export function ViewProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<ViewId>(getInitialView);
  const [viewHistory, setViewHistory] = useState<ViewId[]>([]);

  // Sync URL bar — preserve query params
  useEffect(() => {
    const targetPath = VIEW_PATHS[view] || "/workspace";
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(null, "", buildUrl(targetPath));
    }
  }, [view]);

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      const v = PATH_TO_VIEW[window.location.pathname];
      if (v) setViewState(v);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const setView = useCallback(
    (next: ViewId) => {
      setViewHistory((h) => [...h.slice(-20), view]);
      setViewState(next);
      const targetPath = VIEW_PATHS[next] || "/workspace";
      window.history.pushState(null, "", buildUrl(targetPath));
    },
    [view]
  );

  const goBack = useCallback(() => {
    setViewHistory((h) => {
      const prev = h[h.length - 1];
      if (prev) {
        setViewState(prev);
        window.history.replaceState(null, "", buildUrl(VIEW_PATHS[prev]));
        return h.slice(0, -1);
      }
      return h;
    });
  }, []);

  return (
    <ViewContext.Provider value={{ view, setView, viewHistory, goBack }}>
      {children}
    </ViewContext.Provider>
  );
}

export function useView() {
  const ctx = useContext(ViewContext);
  if (!ctx) throw new Error("useView must be used within ViewProvider");
  return ctx;
}
