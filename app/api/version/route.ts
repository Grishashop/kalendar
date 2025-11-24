import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

export async function GET() {
  try {
    // Читаем версию из package.json
    const packagePath = join(process.cwd(), "package.json");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf-8"));
    const version = packageJson.version || "1.0.0";

    // Получаем git commit hash из переменных окружения (устанавливается при деплое)
    // Или пытаемся прочитать из .git/HEAD если доступно
    let commitHash = process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 
                     process.env.NEXT_PUBLIC_GIT_COMMIT_SHA ||
                     "unknown";
    let commitDate = process.env.VERCEL_GIT_COMMIT_MESSAGE || "unknown";
    let commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE || "unknown";
    
    // Пытаемся получить информацию из git, если доступно
    if (commitHash === "unknown") {
      try {
        const { execSync } = await import("child_process");
        commitHash = execSync("git rev-parse --short HEAD", {
          cwd: process.cwd(),
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        
        commitDate = execSync("git log -1 --format=%ci HEAD", {
          cwd: process.cwd(),
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        
        commitMessage = execSync("git log -1 --format=%s HEAD", {
          cwd: process.cwd(),
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      } catch {
        // Git может быть недоступен на хостинге, это нормально
        console.log("Git info not available");
      }
    }

    return NextResponse.json({
      version,
      commitHash,
      commitDate,
      commitMessage,
      buildTime: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      vercelUrl: process.env.VERCEL_URL || "local",
    });
  } catch (error) {
    console.error("Error getting version:", error);
    return NextResponse.json(
      { error: "Failed to get version info" },
      { status: 500 }
    );
  }
}

