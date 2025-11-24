"use client";

import { useEffect, useState } from "react";

interface VersionInfo {
  version: string;
  commitHash: string;
  commitDate: string;
  commitMessage: string;
  buildTime: string;
  environment: string;
}

export function VersionInfo() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const response = await fetch("/api/version");
        if (response.ok) {
          const data = await response.json();
          setVersionInfo(data);
          
          // Выводим версию в консоль при загрузке страницы
          console.log(
            "%c═══════════════════════════════════════════════════════════",
            "color: #4CAF50; font-weight: bold;"
          );
          console.log(
            "%c📦 Версия приложения",
            "color: #4CAF50; font-weight: bold; font-size: 16px;"
          );
          console.log(
            "%c═══════════════════════════════════════════════════════════",
            "color: #4CAF50; font-weight: bold;"
          );
          console.log("%cВерсия:", "color: #2196F3; font-weight: bold;", data.version);
          console.log("%cCommit:", "color: #2196F3; font-weight: bold;", data.commitHash);
          console.log(
            "%cДата коммита:",
            "color: #2196F3; font-weight: bold;",
            new Date(data.commitDate).toLocaleString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          );
          console.log("%cСообщение:", "color: #2196F3; font-weight: bold;", data.commitMessage);
          console.log(
            "%cВремя сборки:",
            "color: #2196F3; font-weight: bold;",
            new Date(data.buildTime).toLocaleString("ru-RU")
          );
          console.log("%cОкружение:", "color: #2196F3; font-weight: bold;", data.environment);
          if (data.vercelUrl && data.vercelUrl !== "local") {
            console.log("%cURL:", "color: #2196F3; font-weight: bold;", data.vercelUrl);
          }
          console.log(
            "%c═══════════════════════════════════════════════════════════",
            "color: #4CAF50; font-weight: bold;"
          );
        } else {
          console.warn("Не удалось получить информацию о версии");
        }
      } catch (error) {
        console.error("Ошибка при получении версии:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchVersion();
  }, []);

  if (isLoading || !versionInfo) {
    return null;
  }

  return (
    <div className="fixed bottom-2 right-2 text-xs text-muted-foreground bg-background/80 backdrop-blur-sm border border-border rounded-md px-2 py-1 z-50">
      <div className="flex flex-col gap-0.5">
        <div>
          <span className="font-semibold">v{versionInfo.version}</span>
          {" "}
          <span className="text-muted-foreground/70">
            ({versionInfo.commitHash})
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground/60">
          {new Date(versionInfo.commitDate).toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

