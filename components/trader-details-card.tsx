"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Check } from "lucide-react";

interface TraderDetails {
  id: string;
  name?: string;
  name_short?: string;
  photo?: string;
  mail?: string;
  phone?: string;
  mozno_dezurit?: boolean;
  admin?: boolean;
}

interface TraderDetailsCardProps {
  trader: TraderDetails;
  isAdmin: boolean;
  onClose: () => void;
}

export function TraderDetailsCard({
  trader,
  isAdmin,
  onClose,
}: TraderDetailsCardProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = async (text: string, fieldName: string) => {
    if (!text || text === "Не указано") return;
    
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>Информация о трейдере</CardTitle>
            <CardDescription>
              {trader.name_short || "Трейдер"}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Фото трейдера */}
          {trader.photo && (
            <div className="flex justify-center pb-4 border-b">
              <img
                src={trader.photo}
                alt={trader.name_short || "Трейдер"}
                className="w-32 h-32 rounded-full object-cover border-4 border-border"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
          )}

          {/* ФИО трейдера */}
          <div className="space-y-2 pb-4 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ФИО трейдера</p>
            <div
              onClick={() => handleCopy(trader.name || "", "name")}
              className="text-lg font-medium cursor-pointer hover:bg-muted/50 p-2 rounded-md transition-colors flex items-center justify-between group"
            >
              <span>{trader.name || "Не указано"}</span>
              {copiedField === "name" ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : trader.name ? (
                <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                  Клик для копирования
                </span>
              ) : null}
            </div>
          </div>

          {/* Краткое имя трейдера */}
          <div className="space-y-2 pb-4 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Краткое имя трейдера</p>
            <div
              onClick={() => handleCopy(trader.name_short || "", "name_short")}
              className="text-base font-medium cursor-pointer hover:bg-muted/50 p-2 rounded-md transition-colors flex items-center justify-between group"
            >
              <span>{trader.name_short || "Не указано"}</span>
              {copiedField === "name_short" ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : trader.name_short ? (
                <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                  Клик для копирования
                </span>
              ) : null}
            </div>
          </div>

          {/* Фото трейдера (ссылка) */}
          <div className="space-y-2 pb-4 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Фото трейдера</p>
            {trader.photo ? (
              <div
                onClick={() => handleCopy(trader.photo || "", "photo")}
                className="text-sm text-primary cursor-pointer hover:bg-muted/50 p-2 rounded-md transition-colors flex items-center justify-between group break-all"
              >
                <span>{trader.photo}</span>
                {copiedField === "photo" ? (
                  <Check className="h-4 w-4 text-green-500 ml-2 flex-shrink-0" />
                ) : (
                  <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0">
                    Клик для копирования
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Не указано</p>
            )}
          </div>

          {/* Почта трейдера */}
          <div className="space-y-2 pb-4 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Почта трейдера</p>
            <div
              onClick={() => handleCopy(trader.mail || "", "mail")}
              className="text-base cursor-pointer hover:bg-muted/50 p-2 rounded-md transition-colors flex items-center justify-between group"
            >
              <span>{trader.mail || "Не указано"}</span>
              {copiedField === "mail" ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : trader.mail ? (
                <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                  Клик для копирования
                </span>
              ) : null}
            </div>
          </div>

          {/* Телефон трейдера */}
          <div className="space-y-2 pb-4 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Телефон трейдера</p>
            <div
              onClick={() => handleCopy(trader.phone || "", "phone")}
              className="text-base cursor-pointer hover:bg-muted/50 p-2 rounded-md transition-colors flex items-center justify-between group"
            >
              <span>{trader.phone || "Не указано"}</span>
              {copiedField === "phone" ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : trader.phone ? (
                <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                  Клик для копирования
                </span>
              ) : null}
            </div>
          </div>

          {/* Можно дежурить */}
          <div className="space-y-2 pb-4 border-b">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Можно дежурить</p>
            <p className="text-base font-medium">
              {trader.mozno_dezurit === true
                ? "Да"
                : trader.mozno_dezurit === false
                ? "Нет"
                : "Не указано"}
            </p>
          </div>

          {/* Админ (только для админов) */}
          {isAdmin && (
            <div className="space-y-2 pb-4 border-b">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Администратор</p>
              <p className="text-base font-medium">
                {trader.admin === true
                  ? "Да"
                  : trader.admin === false
                  ? "Нет"
                  : "Не указано"}
              </p>
            </div>
          )}

          {/* Кнопка закрыть */}
          <div className="pt-2">
            <Button onClick={onClose} className="w-full">
              Закрыть
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

