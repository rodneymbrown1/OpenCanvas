import { NextResponse } from "next/server";
import { execSync } from "child_process";

interface PortInfo {
  port: number;
  pid: number;
  process: string;
  user: string;
  type: string;
  label: string;
}

const KNOWN_PORTS: Record<number, string> = {
  3000: "Next.js / React",
  3001: "Open Canvas PTY Server",
  3002: "Next.js (alt)",
  4200: "Angular",
  4321: "Astro",
  5000: "Flask / Vite preview",
  5173: "Vite",
  5174: "Vite (alt)",
  5500: "Live Server",
  6006: "Storybook",
  8000: "Django / FastAPI / Python",
  8080: "Webpack / Generic dev",
  8081: "Metro (React Native)",
  8443: "HTTPS dev",
  8787: "Cloudflare Workers",
  8888: "Jupyter Notebook",
  9000: "PHP / SonarQube",
  9090: "Prometheus",
  9229: "Node.js debugger",
  19000: "Expo",
  19006: "Expo web",
  24678: "Vite HMR",
  27017: "MongoDB",
  3306: "MySQL",
  5432: "PostgreSQL",
  6379: "Redis",
};

function scanPorts(): PortInfo[] {
  const platform = process.platform;
  const ports: PortInfo[] = [];

  try {
    let output: string;

    if (platform === "darwin" || platform === "linux") {
      // lsof to find listening TCP ports
      output = execSync(
        "lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null || true",
        { encoding: "utf-8", timeout: 5000 }
      );

      const lines = output.trim().split("\n").slice(1); // skip header
      const seen = new Set<number>();

      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;

        const processName = parts[0];
        const pid = parseInt(parts[1], 10);
        const user = parts[2];
        const nameField = parts[8] || "";

        // Extract port from NAME field like "*:3000" or "127.0.0.1:3000"
        const portMatch = nameField.match(/:(\d+)$/);
        if (!portMatch) continue;

        const port = parseInt(portMatch[1], 10);
        if (seen.has(port)) continue;
        seen.add(port);

        const label = KNOWN_PORTS[port] || "";

        ports.push({
          port,
          pid,
          process: processName,
          user,
          type: "TCP",
          label,
        });
      }
    } else if (platform === "win32") {
      output = execSync("netstat -ano -p TCP | findstr LISTENING", {
        encoding: "utf-8",
        timeout: 5000,
      });

      const seen = new Set<number>();
      for (const line of output.trim().split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;

        const addrPort = parts[1];
        const pid = parseInt(parts[4], 10);
        const portMatch = addrPort.match(/:(\d+)$/);
        if (!portMatch) continue;

        const port = parseInt(portMatch[1], 10);
        if (seen.has(port)) continue;
        seen.add(port);

        let processName = "unknown";
        try {
          processName = execSync(
            `tasklist /FI "PID eq ${pid}" /FO CSV /NH 2>nul`,
            { encoding: "utf-8", timeout: 2000 }
          )
            .trim()
            .split(",")[0]
            ?.replace(/"/g, "") || "unknown";
        } catch {}

        ports.push({
          port,
          pid,
          process: processName,
          user: "",
          type: "TCP",
          label: KNOWN_PORTS[port] || "",
        });
      }
    }
  } catch {
    // Failed to scan
  }

  return ports.sort((a, b) => a.port - b.port);
}

export async function GET() {
  const ports = scanPorts();
  return NextResponse.json({ ports });
}
