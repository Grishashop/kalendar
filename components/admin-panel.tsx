"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { X, Edit, Trash2, Plus, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

interface Trader {
  id: string;
  name?: string;
  name_short?: string;
  photo?: string;
  mail?: string;
  phone?: string;
  mozno_dezurit?: boolean;
  admin?: boolean;
  chat?: boolean;
  zametki?: boolean;
}

interface Duty {
  id: string;
  traders?: string;
  date_dezurztva_or_otdyh?: string;
  tip_dezursva_or_otdyh?: string;
  utverzdeno?: boolean;
  created_at?: string;
}

interface DutyType {
  id: string;
  tip_dezursva_or_otdyh?: string;
  color?: string;
  ves?: number;
}

interface AdminPanelProps {
  onClose: () => void;
}

export function AdminPanel({ onClose }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<"traders" | "dezurstva" | "typ_dezurstva">("traders");
  const [traders, setTraders] = useState<Trader[]>([]);
  const [duties, setDuties] = useState<Duty[]>([]);
  const [dutyTypes, setDutyTypes] = useState<DutyType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editingTable, setEditingTable] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    const supabase = createClient();

    try {
      if (activeTab === "traders") {
        const { data, error } = await supabase
          .from("traders")
          .select("*")
          .order("name_short", { ascending: true });
        if (!error && data) setTraders(data);
      } else if (activeTab === "dezurstva") {
        const { data, error } = await supabase
          .from("dezurstva")
          .select("*")
          .order("date_dezurztva_or_otdyh", { ascending: false });
        if (!error && data) setDuties(data);
      } else if (activeTab === "typ_dezurstva") {
        const { data, error } = await supabase
          .from("typ_dezurstva")
          .select("*")
          .order("ves", { ascending: true });
        if (!error && data) setDutyTypes(data);
      }
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, table: string) => {
    if (!confirm("Вы уверены, что хотите удалить эту запись?")) return;

    const supabase = createClient();
    const { error } = await supabase.from(table).delete().eq("id", id);

    if (error) {
      alert(`Ошибка при удалении: ${error.message}`);
    } else {
      fetchData();
    }
  };

  const handleEdit = (item: any, table: string) => {
    setEditingItem(item);
    setEditingTable(table);
  };

  const handleSaveWithData = async (data: any, table: string) => {
    if (!data || !table) return;

    const supabase = createClient();
    
    // Подготавливаем данные для сохранения
    const hasId = data.id && data.id !== "";
    const { id, created_at, ...dataToSave } = data;
    
    // Очищаем от undefined, но оставляем null, false, 0, пустые строки
    const cleanData: any = {};
    Object.keys(dataToSave).forEach((key) => {
      const value = dataToSave[key];
      // Исключаем undefined и пустые строки для необязательных полей
      if (value !== undefined) {
        // Для пустых строк оставляем null для необязательных полей
        if (value === "" && (key === "photo" || key === "phone")) {
          cleanData[key] = null;
        } else {
          cleanData[key] = value;
        }
      }
    });

    let error;
    if (hasId) {
      // Обновление существующей записи
      ({ error } = await supabase
        .from(table)
        .update(cleanData)
        .eq("id", id));
    } else {
      // Создание новой записи - гарантируем, что id не передается
      const insertData = { ...cleanData };
      delete insertData.id; // На всякий случай удаляем id, если он каким-то образом попал
      
      ({ error } = await supabase
        .from(table)
        .insert(insertData)
        .select());
    }

    if (error) {
      alert(`Ошибка при сохранении: ${error.message}`);
      console.error("Save error:", error);
      console.error("Data being saved:", cleanData);
      console.error("Has ID:", hasId);
    } else {
      setEditingItem(null);
      setEditingTable(null);
      fetchData();
    }
  };

  const handleSave = async () => {
    // Эта функция больше не используется напрямую, но оставляем для совместимости
    if (!editingItem || !editingTable) return;
    await handleSaveWithData(editingItem, editingTable);
  };

  const renderTable = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Загрузка...</p>
        </div>
      );
    }

    if (activeTab === "traders") {
      return (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Трейдеры ({traders.length})</h3>
            <Button
              onClick={() => {
                const newTrader: Partial<Trader> = {
                  name: "",
                  name_short: "",
                  mail: "",
                  phone: "",
                  mozno_dezurit: false,
                  admin: false,
                  chat: false,
                  zametki: false,
                };
                handleEdit(newTrader, "traders");
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Добавить
            </Button>
          </div>
          <div className="space-y-2">
            {traders.map((trader) => (
              <Card key={trader.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{trader.name_short || "Без имени"}</span>
                      {trader.admin && (
                        <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded">АДМИН</span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>ФИО: {trader.name || "Не указано"}</p>
                      <p>Email: {trader.mail || "Не указано"}</p>
                      <p>Телефон: {trader.phone || "Не указано"}</p>
                      <div className="flex gap-4 mt-2">
                        <span>Дежурить: {trader.mozno_dezurit ? "Да" : "Нет"}</span>
                        <span>Чат: {trader.chat ? "Да" : "Нет"}</span>
                        <span>Заметки: {trader.zametki ? "Да" : "Нет"}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleEdit(trader, "traders")}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() => handleDelete(trader.id, "traders")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      );
    }

    if (activeTab === "dezurstva") {
      return (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Дежурства ({duties.length})</h3>
            <Button
              onClick={() => {
                const newDuty: Partial<Duty> = {
                  traders: "",
                  date_dezurztva_or_otdyh: new Date().toISOString().split("T")[0],
                  tip_dezursva_or_otdyh: "",
                  utverzdeno: false,
                };
                handleEdit(newDuty, "dezurstva");
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Добавить
            </Button>
          </div>
          <div className="space-y-2">
            {duties.map((duty) => (
              <Card key={duty.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="font-medium">{duty.traders || "Не указано"}</div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <p>Дата: {duty.date_dezurztva_or_otdyh || "Не указано"}</p>
                      <p>Тип: {duty.tip_dezursva_or_otdyh || "Не указано"}</p>
                      <p>Утверждено: {duty.utverzdeno ? "Да" : "Нет"}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleEdit(duty, "dezurstva")}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() => handleDelete(duty.id, "dezurstva")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      );
    }

    if (activeTab === "typ_dezurstva") {
      return (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Типы дежурств ({dutyTypes.length})</h3>
            <Button
              onClick={() => {
                const newType: Partial<DutyType> = {
                  tip_dezursva_or_otdyh: "",
                  color: "#000000",
                  ves: 0,
                };
                handleEdit(newType, "typ_dezurstva");
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Добавить
            </Button>
          </div>
          <div className="space-y-2">
            {dutyTypes.map((type) => (
              <Card key={type.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{type.tip_dezursva_or_otdyh || "Не указано"}</span>
                      {type.color && (
                        <div
                          className="w-6 h-6 rounded border"
                          style={{ backgroundColor: type.color }}
                        />
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <p>Вес: {type.ves !== null && type.ves !== undefined ? type.ves : "Не указано"}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleEdit(type, "typ_dezurstva")}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() => handleDelete(type.id, "typ_dezurstva")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <Card className="w-full max-w-6xl max-h-[90vh] flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>Панель администратора</CardTitle>
            <CardDescription>Управление данными системы</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex-1 flex gap-4 overflow-hidden">
          {/* Вертикальные вкладки слева */}
          <div className="w-48 flex-shrink-0 border-r pr-4">
            <div className="space-y-2">
              <Button
                variant={activeTab === "traders" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => setActiveTab("traders")}
              >
                Трейдеры
              </Button>
              <Button
                variant={activeTab === "dezurstva" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => setActiveTab("dezurstva")}
              >
                Дежурства
              </Button>
              <Button
                variant={activeTab === "typ_dezurstva" ? "default" : "ghost"}
                className="w-full justify-start"
                onClick={() => setActiveTab("typ_dezurstva")}
              >
                Типы дежурств
              </Button>
            </div>
          </div>

          {/* Контент справа */}
          <div className="flex-1 overflow-y-auto pr-4">
            {editingItem && editingTable ? (
              <EditForm
                item={editingItem}
                table={editingTable}
                onSave={async (data: any) => {
                  // Сохраняем данные напрямую, используя переданные данные из формы
                  await handleSaveWithData(data, editingTable);
                }}
                onCancel={() => {
                  setEditingItem(null);
                  setEditingTable(null);
                }}
              />
            ) : (
              renderTable()
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EditForm({ item, table, onSave, onCancel }: any) {
  // Сохраняем id если он есть (для редактирования), иначе не включаем (для создания)
  const initialData: any = {};
  Object.keys(item).forEach((key) => {
    if (key === "id" && item.id) {
      // Сохраняем id только если он существует (для редактирования)
      initialData[key] = item[key];
    } else if (key !== "id" && key !== "created_at") {
      initialData[key] = item[key];
    }
  });
  
  const [formData, setFormData] = useState(initialData);

  const handleChange = (field: string, value: any) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleSubmit = () => {
    // Передаем обновленные данные из формы, включая id если он был в исходном item
    const dataToSave = { ...formData };
    // Восстанавливаем id из исходного item, если он был
    if (item.id) {
      dataToSave.id = item.id;
    }
    console.log("Submitting form data:", dataToSave);
    onSave(dataToSave);
  };

  const getFieldLabel = (key: string): string => {
    const labels: Record<string, string> = {
      name: "ФИО",
      name_short: "Краткое имя",
      mail: "Email",
      phone: "Телефон",
      photo: "Фото (ссылка)",
      mozno_dezurit: "Можно дежурить",
      admin: "Администратор",
      chat: "Чат",
      zametki: "Заметки",
      traders: "Трейдер",
      date_dezurztva_or_otdyh: "Дата дежурства",
      tip_dezursva_or_otdyh: "Тип дежурства",
      utverzdeno: "Утверждено",
      color: "Цвет",
      ves: "Вес",
    };
    return labels[key] || key.replace(/_/g, " ");
  };

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-6">
        {item.id ? "Редактирование" : "Добавление новой записи"}
      </h3>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
        {Object.keys(formData)
          .filter((key) => key !== "id" && key !== "created_at" && formData[key] !== undefined)
          .map((key) => (
            <div key={key} className="space-y-2">
              <Label className="text-sm font-medium">
                {getFieldLabel(key)}
              </Label>
              {typeof formData[key] === "boolean" ? (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={formData[key] || false}
                    onCheckedChange={(checked) => handleChange(key, checked === true)}
                  />
                  <span className="text-sm text-muted-foreground">
                    {formData[key] ? "Да" : "Нет"}
                  </span>
                </div>
              ) : key === "color" ? (
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={formData[key] || "#000000"}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className="w-20 h-10"
                  />
                  <Input
                    type="text"
                    value={formData[key] || ""}
                    onChange={(e) => handleChange(key, e.target.value)}
                    placeholder="#000000"
                  />
                </div>
              ) : key === "date_dezurztva_or_otdyh" ? (
                <Input
                  type="date"
                  value={formData[key] || ""}
                  onChange={(e) => handleChange(key, e.target.value)}
                />
              ) : (
                <Input
                  type="text"
                  value={formData[key] || ""}
                  onChange={(e) => handleChange(key, e.target.value)}
                  placeholder={`Введите ${getFieldLabel(key).toLowerCase()}`}
                />
              )}
            </div>
          ))}
        <div className="flex gap-2 pt-4 border-t">
          <Button onClick={handleSubmit} className="flex items-center gap-2">
            <Save className="h-4 w-4" />
            Сохранить
          </Button>
          <Button variant="outline" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </div>
    </Card>
  );
}

