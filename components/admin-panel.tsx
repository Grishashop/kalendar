"use client";

import { useState, useEffect, useRef } from "react";
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
  const editingItemIdRef = useRef<any>(null);

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
        if (!error && data) {
          console.log("Loaded typ_dezurstva data:", data);
          console.log("First item:", data[0]);
          console.log("First item keys:", data[0] ? Object.keys(data[0]) : "no keys");
          setDutyTypes(data);
        } else if (error) {
          console.error("Error loading typ_dezurstva:", error);
        }
      }
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string | number, table: string) => {
    if (!confirm("Вы уверены, что хотите удалить эту запись?")) return;

    // Проверяем, что id передан
    if (id === undefined || id === null || id === "") {
      console.error("Delete error: ID is undefined, null, or empty");
      console.error("ID value:", id, "Type:", typeof id);
      alert("Ошибка: ID записи не найден. Невозможно удалить запись без ID.");
      return;
    }

    const supabase = createClient();
    
    // Для таблицы typ_dezurstva может не быть колонки id
    // В этом случае используем tip_dezursva_or_otdyh как уникальный идентификатор
    let deleteQuery;
    if (table === "typ_dezurstva") {
      // Проверяем, является ли id числом (значит это id) или строкой (значит это tip_dezursva_or_otdyh)
      if (typeof id === "number") {
        // Пробуем удалить по id
        deleteQuery = supabase.from(table).delete().eq("id", id);
      } else {
        // Удаляем по tip_dezursva_or_otdyh
        deleteQuery = supabase.from(table).delete().eq("tip_dezursva_or_otdyh", id);
      }
    } else {
      deleteQuery = supabase.from(table).delete().eq("id", id);
    }
    
    const { error } = await deleteQuery;

    if (error) {
      console.error("Delete error:", error);
      console.error("Table:", table);
      console.error("ID:", id, "Type:", typeof id);
      
      // Если ошибка связана с отсутствием колонки id, пробуем удалить по tip_dezursva_or_otdyh
      if (table === "typ_dezurstva" && error.message.includes("column typ_dezurstva.id does not exist")) {
        console.log("Trying to delete by tip_dezursva_or_otdyh instead of id");
        const { error: error2 } = await supabase
          .from(table)
          .delete()
          .eq("tip_dezursva_or_otdyh", id);
        
        if (error2) {
          console.error("Delete error (by tip_dezursva_or_otdyh):", error2);
          alert(`Ошибка при удалении: ${error2.message}`);
        } else {
          fetchData();
        }
      } else {
        alert(`Ошибка при удалении: ${error.message}`);
      }
    } else {
      fetchData();
    }
  };

  const handleEdit = (item: any, table: string) => {
    console.log("=== handleEdit ===");
    console.log("Editing item:", item);
    console.log("Item ID:", item?.id, "Type:", typeof item?.id);
    console.log("Item keys:", item ? Object.keys(item) : "no keys");
    console.log("Item values:", item ? Object.values(item) : "no values");
    console.log("Table:", table);
    
    // Проверяем, что id есть в item
    if (!item || (item.id === undefined && item.id === null)) {
      console.warn("WARNING: Item has no ID! This might be a new record.");
      editingItemIdRef.current = null;
    } else {
      // Сохраняем id в ref для надежности
      editingItemIdRef.current = item.id;
      console.log("Saved ID to ref:", editingItemIdRef.current);
    }
    
    setEditingItem(item);
    setEditingTable(table);
  };

  const handleSaveWithData = async (data: any, table: string) => {
    if (!data || !table) {
      console.error("Missing data or table:", { data, table });
      return;
    }

    console.log("=== handleSaveWithData ENTRY ===");
    console.log("Received data:", data);
    console.log("Received table:", table);
    console.log("Data.id:", data?.id, "Type:", typeof data?.id);
    console.log("Data keys:", data ? Object.keys(data) : "no keys");
    console.log("Data has id property:", data ? 'id' in data : false);
    console.log("Data.id value:", data?.id);
    console.log("Data.id === undefined:", data?.id === undefined);
    console.log("Data.id === null:", data?.id === null);
    console.log("Data.id === '':", data?.id === "");
    
    // КРИТИЧЕСКИ ВАЖНО: Если id отсутствует, это ошибка (кроме typ_dezurstva, где может не быть id)
    if (!data.id && table !== "typ_dezurstva") {
      console.error("ERROR: data.id is missing!");
      console.error("Full data object:", data);
      alert("Ошибка: ID записи не найден. Невозможно обновить запись без ID.");
      return;
    }
    
    // Для typ_dezurstva, если id отсутствует, используем tip_dezursva_or_otdyh как идентификатор
    if (table === "typ_dezurstva" && !data.id && data.tip_dezursva_or_otdyh) {
      console.log("Using tip_dezursva_or_otdyh as identifier for typ_dezurstva:", data.tip_dezursva_or_otdyh);
      // Сохраняем оригинальное значение tip_dezursva_or_otdyh для поиска записи
      const originalTipDezursva = editingItem?.tip_dezursva_or_otdyh || data.tip_dezursva_or_otdyh;
      data._originalTipDezursva = originalTipDezursva;
    }

    const supabase = createClient();
    
    // Подготавливаем данные для сохранения
    // Проверяем наличие id более надежно (для числовых и строковых id)
    const id = data.id;
    // Для числовых id (BIGSERIAL): проверяем что это не undefined, null, пустая строка
    // Для BIGSERIAL id обычно начинается с 1, так что 0 не валидно
    // Но также проверяем, что это не пустая строка (для строковых id)
    const hasId = id !== undefined && id !== null && id !== "" && (typeof id === "number" ? id > 0 : true);
    
    // Копируем все данные кроме id, created_at и служебных полей (начинающихся с _)
    const dataToSave: any = {};
    Object.keys(data).forEach((key) => {
      if (key !== "id" && key !== "created_at" && !key.startsWith("_")) {
        dataToSave[key] = data[key];
      }
    });
    
    // Сохраняем _originalTipDezursva отдельно для typ_dezurstva
    const originalTipDezursva = data._originalTipDezursva;
    
    console.log("=== handleSaveWithData processing ===");
    console.log("Original data:", data);
    console.log("Data keys:", Object.keys(data));
    console.log("Data values:", Object.values(data));
    console.log("ID:", id, "Type:", typeof id, "Has ID:", hasId);
    console.log("DataToSave:", dataToSave);
    console.log("DataToSave keys:", Object.keys(dataToSave));
    console.log("DataToSave values:", Object.values(dataToSave));
    
    // Очищаем от undefined, но оставляем null, false, 0, пустые строки
    const cleanData: any = {};
    Object.keys(dataToSave).forEach((key) => {
      const value = dataToSave[key];
      // Исключаем undefined, id, и служебные поля (начинающиеся с _)
      if (value !== undefined && key !== "id" && !key.startsWith("_")) {
        // Для пустых строк оставляем null для необязательных полей
        if (value === "" && (key === "photo" || key === "phone")) {
          cleanData[key] = null;
        } else if (key === "ves") {
          // Преобразуем ves в число
          if (value === "" || value === null) {
            cleanData[key] = null;
          } else {
            cleanData[key] = typeof value === "string" ? parseInt(value, 10) || 0 : Number(value) || 0;
          }
        } else {
          cleanData[key] = value;
        }
      }
    });
    
    // Удаляем служебные поля из cleanData (на всякий случай)
    delete cleanData._originalTipDezursva;
    
    console.log("=== cleanData prepared ===");
    console.log("cleanData:", cleanData);
    console.log("cleanData keys:", Object.keys(cleanData));
    console.log("cleanData values:", Object.values(cleanData));
    console.log("originalTipDezursva:", originalTipDezursva);

    let error;
    if (hasId) {
      // Обновление существующей записи
      console.log("Updating record:", { table, id, cleanData });
      
      // Для typ_dezurstva может не быть колонки id, используем tip_dezursva_or_otdyh
      if (table === "typ_dezurstva" && typeof id === "string") {
        // Если id - это строка, значит это tip_dezursva_or_otdyh
        // Используем originalTipDezursva для поиска записи (старое значение)
        const searchValue = originalTipDezursva || id;
        console.log("Updating typ_dezurstva by tip_dezursva_or_otdyh:", searchValue);
        ({ error } = await supabase
          .from(table)
          .update(cleanData)
          .eq("tip_dezursva_or_otdyh", searchValue));
      } else {
        ({ error } = await supabase
          .from(table)
          .update(cleanData)
          .eq("id", id));
      }
    } else {
      // Создание новой записи - гарантируем, что id не передается
      const insertData = { ...cleanData };
      delete insertData.id; // На всякий случай удаляем id, если он каким-то образом попал
      delete insertData._originalTipDezursva; // Удаляем служебное поле
      
      console.log("Inserting new record:", { table, insertData });
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
      console.error("ID value:", id);
      console.error("Table:", table);
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
            {dutyTypes.map((type, index) => {
              console.log("Rendering type:", type, "ID:", type.id, "Keys:", Object.keys(type));
              return (
                <Card key={type.id || `type-${index}`} className="p-4">
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
                        onClick={() => {
                          console.log("Delete button clicked, type:", type, "type.id:", type.id, "type.tip_dezursva_or_otdyh:", type.tip_dezursva_or_otdyh);
                          // Для typ_dezurstva используем tip_dezursva_or_otdyh как идентификатор, если id отсутствует
                          const identifier = type.id || type.tip_dezursva_or_otdyh;
                          if (!identifier) {
                            alert("Ошибка: Не удалось найти идентификатор записи для удаления.");
                            return;
                          }
                          handleDelete(identifier, "typ_dezurstva");
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
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
                  // Проверяем, что данные не пустые
                  if (!data || Object.keys(data).length === 0) {
                    console.error("ERROR: Data is empty in onSave!");
                    alert("Ошибка: данные для сохранения пусты. Проверьте консоль.");
                    return;
                  }
                  
                  // КРИТИЧЕСКИ ВАЖНО: Всегда добавляем id из editingItem или ref ПЕРЕД всеми проверками
                  // Это гарантирует, что при редактировании id всегда будет в data
                  // Для typ_dezurstva может не быть id, используем tip_dezursva_or_otdyh как идентификатор
                  let idToUse = null;
                  
                  // Сначала пробуем взять из editingItem
                  if (editingItem?.id !== undefined && editingItem?.id !== null) {
                    idToUse = editingItem.id;
                  }
                  // Если не нашли, пробуем взять из ref
                  else if (editingItemIdRef.current !== undefined && editingItemIdRef.current !== null) {
                    idToUse = editingItemIdRef.current;
                  }
                  // Для typ_dezurstva, если id отсутствует, используем tip_dezursva_or_otdyh
                  else if (editingTable === "typ_dezurstva" && editingItem?.tip_dezursva_or_otdyh) {
                    idToUse = editingItem.tip_dezursva_or_otdyh;
                    console.log("Using tip_dezursva_or_otdyh as identifier for typ_dezurstva:", idToUse);
                  }
                  
                  if (idToUse !== null) {
                    data.id = idToUse;
                    // Сохраняем оригинальное значение tip_dezursva_or_otdyh для typ_dezurstva
                    if (editingTable === "typ_dezurstva" && editingItem?.tip_dezursva_or_otdyh) {
                      data._originalTipDezursva = editingItem.tip_dezursva_or_otdyh;
                    }
                    console.log("✓ ID added to data:", idToUse, "Type:", typeof idToUse);
                  } else {
                    console.error("✗ ERROR: No ID found in editingItem or ref!");
                    console.error("editingItem:", editingItem);
                    console.error("editingItem?.id:", editingItem?.id);
                    console.error("editingItemIdRef.current:", editingItemIdRef.current);
                  }
                  
                  console.log("Final data before handleSaveWithData:", data);
                  console.log("Final data.id:", data.id);
                  
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
  // Сохраняем все поля из item, включая id для редактирования
  // Убеждаемся, что все необходимые поля присутствуют
  const initialData: any = { ...item };
  // Удаляем только created_at, остальное сохраняем
  delete initialData.created_at;
  
  // ВАЖНО: Убеждаемся, что id всегда сохраняется, если он есть в item
  // Для числовых id проверяем, что это не undefined, null, и не пустая строка
  // Для числовых id также проверяем, что значение > 0 (BIGSERIAL начинается с 1)
  if (item.id !== undefined && item.id !== null) {
    // Для числовых id проверяем, что значение > 0
    if (typeof item.id === "number") {
      if (item.id > 0) {
        initialData.id = item.id;
      }
    } else if (item.id !== "") {
      // Для строковых id проверяем, что это не пустая строка
      initialData.id = item.id;
    }
  }
  
  // Для typ_dezurstva убеждаемся, что все поля присутствуют
  if (table === "typ_dezurstva") {
    // Убеждаемся, что все обязательные поля есть
    initialData.tip_dezursva_or_otdyh = initialData.tip_dezursva_or_otdyh ?? "";
    initialData.color = initialData.color ?? "#000000";
    initialData.ves = initialData.ves ?? 0;
  }
  
  console.log("EditForm initialized with:", { 
    item, 
    initialData, 
    table, 
    itemId: item.id, 
    initialDataId: initialData.id,
    hasId: initialData.id !== undefined && initialData.id !== null && initialData.id !== ""
  });
  
  const [formData, setFormData] = useState(initialData);
  
  // Логируем изменения formData
  useEffect(() => {
    console.log("FormData updated:", formData);
  }, [formData]);

  const handleChange = (field: string, value: any) => {
    const newFormData = { ...formData, [field]: value };
    console.log(`handleChange: ${field} =`, value, "New formData:", newFormData);
    setFormData(newFormData);
  };

  const handleSubmit = () => {
    console.log("=== handleSubmit START ===");
    console.log("item:", item);
    console.log("item.id:", item?.id, "Type:", typeof item?.id);
    console.log("formData:", formData);
    console.log("formData.id:", formData?.id, "Type:", typeof formData?.id);
    
    // Передаем все данные из формы, включая id если он был
    // Используем прямое копирование всех полей из formData
    const dataToSave: any = { ...formData };
    
    // Удаляем created_at если есть
    delete dataToSave.created_at;
    
    // КРИТИЧЕСКИ ВАЖНО: Сохраняем id из item ПЕРЕД всеми остальными проверками
    // Это гарантирует, что id всегда будет в dataToSave при редактировании
    // Приоритет: item.id (источник истины) > formData.id
    const itemId = item?.id;
    const formDataId = formData?.id;
    
    console.log("Before ID assignment - itemId:", itemId, "formDataId:", formDataId);
    
    // Сначала пробуем взять id из item (это источник истины при редактировании)
    if (itemId !== undefined && itemId !== null) {
      console.log("Checking itemId - value:", itemId, "type:", typeof itemId);
      if (typeof itemId === "number") {
        if (itemId > 0) {
          dataToSave.id = itemId;
          console.log("Assigned itemId (number):", itemId);
        } else {
          console.warn("itemId is number but <= 0:", itemId);
        }
      } else if (itemId !== "") {
        dataToSave.id = itemId;
        console.log("Assigned itemId (string):", itemId);
      } else {
        console.warn("itemId is empty string");
      }
    } else {
      console.warn("itemId is undefined or null");
    }
    
    // Если в item нет id, пробуем взять из formData
    if (dataToSave.id === undefined && formDataId !== undefined && formDataId !== null) {
      console.log("Checking formDataId - value:", formDataId, "type:", typeof formDataId);
      if (typeof formDataId === "number") {
        if (formDataId > 0) {
          dataToSave.id = formDataId;
          console.log("Assigned formDataId (number):", formDataId);
        } else {
          console.warn("formDataId is number but <= 0:", formDataId);
        }
      } else if (formDataId !== "") {
        dataToSave.id = formDataId;
        console.log("Assigned formDataId (string):", formDataId);
      } else {
        console.warn("formDataId is empty string");
      }
    }
    
    console.log("After ID assignment - dataToSave.id:", dataToSave.id, "Type:", typeof dataToSave.id);
    
    // Для typ_dezurstva убеждаемся, что все поля присутствуют с валидными значениями
    if (table === "typ_dezurstva") {
      // Убеждаемся, что все обязательные поля есть с дефолтными значениями
      dataToSave.tip_dezursva_or_otdyh = dataToSave.tip_dezursva_or_otdyh !== undefined 
        ? dataToSave.tip_dezursva_or_otdyh 
        : (formData.tip_dezursva_or_otdyh !== undefined ? formData.tip_dezursva_or_otdyh : "");
      dataToSave.color = dataToSave.color !== undefined 
        ? dataToSave.color 
        : (formData.color !== undefined ? formData.color : "#000000");
      dataToSave.ves = dataToSave.ves !== undefined && dataToSave.ves !== null
        ? dataToSave.ves 
        : (formData.ves !== undefined && formData.ves !== null ? formData.ves : 0);
    }
    
    console.log("=== handleSubmit ===");
    console.log("FormData state:", formData);
    console.log("FormData.id:", formDataId, "Type:", typeof formDataId);
    console.log("FormData keys:", Object.keys(formData));
    console.log("Original item:", item);
    console.log("Item.id:", itemId, "Type:", typeof itemId);
    console.log("Item keys:", Object.keys(item));
    console.log("Final ID to save:", dataToSave.id, "Type:", typeof dataToSave.id);
    console.log("Data to save BEFORE onSave:", dataToSave);
    console.log("Data keys:", Object.keys(dataToSave));
    console.log("Data values:", Object.values(dataToSave));
    console.log("ID in dataToSave:", dataToSave.id);
    console.log("ID in dataToSave type:", typeof dataToSave.id);
    console.log("ID in dataToSave === undefined:", dataToSave.id === undefined);
    console.log("ID in dataToSave === null:", dataToSave.id === null);
    
    // Проверяем, что данные не пустые
    if (Object.keys(dataToSave).length === 0) {
      console.error("ERROR: dataToSave is empty!");
      alert("Ошибка: данные для сохранения пусты. Проверьте консоль.");
      return;
    }
    
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
          .filter((key) => key !== "id" && key !== "created_at")
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
              ) : key === "ves" ? (
                <Input
                  type="number"
                  value={formData[key] !== undefined && formData[key] !== null ? formData[key] : ""}
                  onChange={(e) => handleChange(key, e.target.value === "" ? "" : parseInt(e.target.value, 10) || 0)}
                  placeholder="Введите вес"
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

