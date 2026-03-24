"use client";

import { useState, useEffect, useCallback } from "react";

export type Theme = "dark" | "light";

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((config) => {
        const t = config.preferences?.theme === "dark" ? "dark" : "light";
        setTheme(t);
        document.documentElement.setAttribute("data-theme", t);
      })
      .catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    fetch("/api/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferences: { theme: next } }),
    }).catch(() => {});
  }, [theme]);

  return [theme, toggle];
}
