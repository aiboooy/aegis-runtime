import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const SCREENSHOT_WIDTH = 1280;
const SCREENSHOT_HEIGHT = 800;
const SERVER_FILES = ["server.py", "app.py", "server.js", "app.js", "index.js", "main.py"];

function findServableFile(workspacePath: string): "html" | "server" | null {
  if (existsSync(join(workspacePath, "index.html"))) {
    return "html";
  }
  for (const f of SERVER_FILES) {
    if (existsSync(join(workspacePath, f))) {
      return "server";
    }
  }
  return null;
}

async function tryPuppeteer(url: string, outputPath: string): Promise<boolean> {
  try {
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: SCREENSHOT_WIDTH, height: SCREENSHOT_HEIGHT });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
    await page.screenshot({ path: outputPath, type: "png" });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

function startSimpleServer(workspacePath: string, port: number): ChildProcess {
  return spawn("python3", ["-m", "http.server", String(port)], {
    cwd: workspacePath,
    stdio: "ignore",
  });
}

function startAppServer(workspacePath: string, serverFile: string): ChildProcess {
  const ext = serverFile.split(".").pop();
  const cmd = ext === "py" ? "python3" : "node";
  return spawn(cmd, [serverFile], {
    cwd: workspacePath,
    stdio: "ignore",
    env: { ...process.env, PORT: "18234" },
  });
}

async function waitForPort(port: number, maxMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const resp = await fetch(`http://localhost:${port}/`).catch(() => null);
      if (resp) {
        return true;
      }
    } catch {
      // ignore connection errors while waiting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function captureScreenshot(workspacePath: string): Promise<string | null> {
  const servable = findServableFile(workspacePath);
  if (!servable) {
    return null;
  }

  const outputPath = join(workspacePath, "screenshot.png");
  let server: ChildProcess | null = null;
  let port: number;

  try {
    if (servable === "html") {
      port = 18233;
      server = startSimpleServer(workspacePath, port);
    } else {
      port = 18234;
      const serverFile = SERVER_FILES.find((f) => existsSync(join(workspacePath, f)))!;
      server = startAppServer(workspacePath, serverFile);
    }

    const ready = await waitForPort(port, 8000);
    if (!ready) {
      return null;
    }

    const captured = await tryPuppeteer(`http://localhost:${port}`, outputPath);
    if (captured && existsSync(outputPath)) {
      return outputPath;
    }

    return null;
  } catch {
    return null;
  } finally {
    if (server) {
      try {
        server.kill();
      } catch {
        // ignore kill errors
      }
    }
  }
}
