"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Trader {
  id: string;
  traders: string;
  date?: string;
  created_at?: string;
  [key: string]: any;
}

interface DayDetailsCardProps {
  date: Date;
  traders: Trader[];
  onClose: () => void;
}

const formatDate = (date: Date) => {
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
  });
};

export function DayDetailsCard({
  date,
  traders,
  onClose,
}: DayDetailsCardProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>{formatDate(date)}</CardTitle>
            <CardDescription>
              {traders.length === 0
                ? "Нет записей на этот день"
                : `${traders.length} ${traders.length === 1 ? "запись" : "записей"}`}
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
        <CardContent>
          {traders.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              На этот день нет записей
            </p>
          ) : (
            <div className="space-y-4">
              {traders.map((trader, index) => (
                <div
                  key={trader.id || index}
                  className="p-4 border rounded-lg bg-muted/50"
                >
                  <div className="font-medium mb-2">{trader.traders}</div>
                  {Object.entries(trader)
                    .filter(([key]) => key !== "id" && key !== "traders")
                    .map(([key, value]) => (
                      <div key={key} className="text-sm text-muted-foreground">
                        <span className="font-medium capitalize">
                          {key.replace(/_/g, " ")}:
                        </span>{" "}
                        {String(value)}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

