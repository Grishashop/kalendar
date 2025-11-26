"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { formatDateMoscow, parseDateMoscow, getMoscowDateComponents, createMoscowDate } from "@/lib/date-utils";

interface Duty {
  id: string;
  traders: string;
  date_dezurztva_or_otdyh?: string;
  tip_dezursva_or_otdyh?: string;
  utverzdeno?: boolean;
  created_at?: string;
}

interface CalendarProps {
  onDayClick: (date: Date, duties: Duty[]) => void;
  onDoubleClick?: (date: Date) => void;
  refreshTrigger?: number; // Триггер для обновления данных без перезагрузки
  onDutyAdded?: (duty: Duty) => void;
  onDutyDeleted?: (dutyId: string | number) => void;
}

const monthNames = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

// Функция для определения контрастного цвета текста
function getContrastColor(hexColor: string): string {
  // Удаляем # если есть
  const color = hexColor.replace("#", "");
  
  // Преобразуем в RGB
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  
  // Вычисляем яркость
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  
  // Возвращаем черный или белый в зависимости от яркости
  return brightness > 128 ? "#000000" : "#ffffff";
}

interface TraderFilter {
  id: string;
  name_short: string;
}

export function Calendar({ onDayClick, onDoubleClick, refreshTrigger }: CalendarProps) {
  // Сохраняем текущий месяц в localStorage, чтобы не сбрасывать при обновлении
  const getInitialDate = () => {
    if (typeof window !== 'undefined') {
      const savedDate = localStorage.getItem('calendarCurrentDate');
      if (savedDate) {
          try {
            const parsed = new Date(savedDate);
            if (!isNaN(parsed.getTime())) {
              return parsed;
            }
          } catch {
            // Игнорируем ошибки парсинга
          }
      }
    }
    // Используем московское время для начальной даты
    const now = new Date();
    const moscowComponents = getMoscowDateComponents(now);
    return createMoscowDate(moscowComponents.year, moscowComponents.month, moscowComponents.day);
  };

  const [currentDate, setCurrentDate] = useState(getInitialDate);
  
  // Сохраняем текущую дату в localStorage при изменении
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('calendarCurrentDate', currentDate.toISOString());
    }
  }, [currentDate]);
  const [duties, setDuties] = useState<Map<string, Duty[]>>(new Map());
  const [allDuties, setAllDuties] = useState<Map<string, Duty[]>>(new Map());
  const [loading, setLoading] = useState(true);
  // Отслеживаем диапазон загруженных месяцев: { startYear, startMonth, endYear, endMonth }
  const loadedRangeRef = useRef<{ startYear: number; startMonth: number; endYear: number; endMonth: number } | null>(null);
  const [lastClickTime, setLastClickTime] = useState<{ date: Date; time: number } | null>(null);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [traders, setTraders] = useState<TraderFilter[]>([]);
  const [selectedTraders, setSelectedTraders] = useState<Set<string>>(new Set());
  const [showApproved, setShowApproved] = useState<boolean | null>(null); // null = все, true = утвержденные, false = не утвержденные
  const [dutyTypeColors, setDutyTypeColors] = useState<Map<string, string>>(new Map());
  const [dutyTypeWeights, setDutyTypeWeights] = useState<Map<string, number>>(new Map());
  
  // Количество видимых строк в ячейке календаря (по умолчанию 4)
  const [visibleRows, setVisibleRows] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendarVisibleRows');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
          return parsed;
        }
      }
    }
    return 4; // По умолчанию 4 строки
  });
  
  // Размер ячейки календаря (1-5)
  const [cellSize, setCellSize] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendarCellSize');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
          return parsed;
        }
      }
    }
    return 3; // По умолчанию обычный размер
  });
  
  // Ширина календаря (50-100%)
  const [calendarWidth, setCalendarWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendarWidth');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 50 && parsed <= 100) {
          return parsed;
        }
      }
    }
    return 100; // По умолчанию 100%
  });
  
  // Отступ внутри ячейки (1-5)
  const [cellPadding, setCellPadding] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendarCellPadding');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
          return parsed;
        }
      }
    }
    return 2; // По умолчанию 2
  });
  
  // Скругление углов (1-5)
  const [borderRadius, setBorderRadius] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendarBorderRadius');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
          return parsed;
        }
      }
    }
    return 2; // По умолчанию 2
  });
  
  // Выделять выходные
  const [highlightWeekends, setHighlightWeekends] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendarHighlightWeekends');
      if (saved) {
        return saved === 'true';
      }
    }
    return true; // По умолчанию да
  });
  
  // Показывать номера недель
  const [showWeekNumbers, setShowWeekNumbers] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendarShowWeekNumbers');
      if (saved) {
        return saved === 'true';
      }
    }
    return false; // По умолчанию нет
  });
  
  // Точка отзывчивости (в пикселях)
  const [responsiveBreakpoint, setResponsiveBreakpoint] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendarResponsiveBreakpoint');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 320 && parsed <= 1920) {
          return parsed;
        }
      }
    }
    return 640; // По умолчанию 640px
  });
  
  // Минимальный масштаб (в процентах)
  const [minScale, setMinScale] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendarMinScale');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 50 && parsed <= 100) {
          return parsed;
        }
      }
    }
    return 100; // По умолчанию 100%
  });
  
  // Текущий масштаб календаря
  const [currentScale, setCurrentScale] = useState<number>(100);
  
  // Максимальная ширина (в пикселях, 0 = без ограничения)
  const [maxWidth, setMaxWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendarMaxWidth');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 3000) {
          return parsed;
        }
      }
    }
    return 1000; // По умолчанию 1000px
  });
  
  // Максимальная высота (в пикселях, 0 = без ограничения)
  const [maxHeight, setMaxHeight] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendarMaxHeight');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 3000) {
          return parsed;
        }
      }
    }
    return 0; // По умолчанию без ограничения
  });
  
  // Слушаем изменения настроек из других компонентов (например, из админ-панели)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'calendarVisibleRows' && e.newValue) {
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
          setVisibleRows(parsed);
        }
      }
      if (e.key === 'calendarCellSize' && e.newValue) {
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
          setCellSize(parsed);
        }
      }
      if (e.key === 'calendarWidth' && e.newValue) {
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed >= 50 && parsed <= 100) {
          setCalendarWidth(parsed);
        }
      }
      if (e.key === 'calendarCellPadding' && e.newValue) {
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
          setCellPadding(parsed);
        }
      }
      if (e.key === 'calendarBorderRadius' && e.newValue) {
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
          setBorderRadius(parsed);
        }
      }
      if (e.key === 'calendarHighlightWeekends' && e.newValue) {
        setHighlightWeekends(e.newValue === 'true');
      }
      if (e.key === 'calendarShowWeekNumbers' && e.newValue) {
        setShowWeekNumbers(e.newValue === 'true');
      }
      if (e.key === 'calendarResponsiveBreakpoint' && e.newValue) {
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed >= 320 && parsed <= 1920) {
          setResponsiveBreakpoint(parsed);
        }
      }
      if (e.key === 'calendarMinScale' && e.newValue) {
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed >= 50 && parsed <= 100) {
          setMinScale(parsed);
        }
      }
      if (e.key === 'calendarMaxWidth' && e.newValue) {
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 3000) {
          setMaxWidth(parsed);
        }
      }
      if (e.key === 'calendarMaxHeight' && e.newValue) {
        const parsed = parseInt(e.newValue, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 3000) {
          setMaxHeight(parsed);
        }
      }
    };
    
    // Также слушаем кастомное событие для обновления в той же вкладке
    const handleCustomEvent = (e: CustomEvent<{ type: string; value: number | boolean }>) => {
      const { type, value } = e.detail;
      if (type === 'visibleRows' && typeof value === 'number' && value >= 1 && value <= 10) {
        setVisibleRows(value);
      } else if (type === 'cellSize' && typeof value === 'number' && value >= 1 && value <= 5) {
        setCellSize(value);
      } else if (type === 'width' && typeof value === 'number' && value >= 50 && value <= 100) {
        setCalendarWidth(value);
      } else if (type === 'cellPadding' && typeof value === 'number' && value >= 1 && value <= 5) {
        setCellPadding(value);
      } else if (type === 'borderRadius' && typeof value === 'number' && value >= 1 && value <= 5) {
        setBorderRadius(value);
      } else if (type === 'highlightWeekends' && typeof value === 'boolean') {
        setHighlightWeekends(value);
      } else if (type === 'showWeekNumbers' && typeof value === 'boolean') {
        setShowWeekNumbers(value);
      } else if (type === 'responsiveBreakpoint' && typeof value === 'number' && value >= 320 && value <= 1920) {
        setResponsiveBreakpoint(value);
      } else if (type === 'minScale' && typeof value === 'number' && value >= 50 && value <= 100) {
        setMinScale(value);
      } else if (type === 'maxWidth' && typeof value === 'number' && value >= 0 && value <= 3000) {
        setMaxWidth(value);
      } else if (type === 'maxHeight' && typeof value === 'number' && value >= 0 && value <= 3000) {
        setMaxHeight(value);
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('calendarSettingsChanged', handleCustomEvent as EventListener);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('calendarSettingsChanged', handleCustomEvent as EventListener);
    };
  }, []);
  
  // Вычисление масштаба при изменении размера окна
  useEffect(() => {
    const calculateScale = () => {
      if (typeof window === 'undefined') return;
      
      const windowWidth = window.innerWidth;
      
      if (windowWidth >= responsiveBreakpoint) {
        // Экран достаточно широкий - масштаб 100%
        setCurrentScale(100);
      } else {
        // Вычисляем пропорциональный масштаб
        // От breakpoint до 320px масштаб уменьшается от 100% до minScale%
        const minWidth = 320;
        const scaleRange = 100 - minScale;
        const widthRange = responsiveBreakpoint - minWidth;
        
        if (widthRange > 0) {
          const widthRatio = (windowWidth - minWidth) / widthRange;
          const scale = minScale + (scaleRange * widthRatio);
          setCurrentScale(Math.max(minScale, Math.min(100, scale)));
        } else {
          setCurrentScale(minScale);
        }
      }
    };
    
    // Вычисляем начальный масштаб
    calculateScale();
    
    // Добавляем слушатель resize
    window.addEventListener('resize', calculateScale);
    
    return () => {
      window.removeEventListener('resize', calculateScale);
    };
  }, [responsiveBreakpoint, minScale]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Ref для хранения текущего года и месяца для использования в Realtime callbacks
  const currentYearMonthRef = useRef({ year, month });
  useEffect(() => {
    currentYearMonthRef.current = { year, month };
  }, [year, month]);

  // Функция для проверки, нужно ли загружать данные для месяца
  const needsDataForMonth = (checkYear: number, checkMonth: number): boolean => {
    if (!loadedRangeRef.current) return true;
    
    const { startYear, startMonth, endYear, endMonth } = loadedRangeRef.current;
    
    // Проверяем, находится ли месяц в загруженном диапазоне
    if (checkYear < startYear || (checkYear === startYear && checkMonth < startMonth)) {
      return true; // Месяц раньше загруженного диапазона
    }
    if (checkYear > endYear || (checkYear === endYear && checkMonth > endMonth)) {
      return true; // Месяц позже загруженного диапазона
    }
    
    return false; // Месяц уже загружен
  };

  // Функция для загрузки данных за диапазон месяцев
  const fetchDutiesForRange = async (startYear: number, startMonth: number, endYear: number, endMonth: number) => {
      // Проверка переменных окружения
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
        console.error("Supabase environment variables are not set");
        return;
      }
      
      const supabase = createClient();

    // Получаем первый день начального месяца и последний день конечного месяца
    const rangeStart = createMoscowDate(startYear, startMonth + 1, 1);
    const rangeEnd = createMoscowDate(endYear, endMonth + 2, 0);
    
    // Форматируем даты для фильтрации в Supabase
    const startDateStr = formatDateMoscow(rangeStart);
    const endDateStr = formatDateMoscow(rangeEnd);

    console.log(`Загрузка данных за диапазон: ${startDateStr} - ${endDateStr}`);

    // Получаем данные из таблицы dezurstva за диапазон дат
      const { data, error } = await supabase
        .from("dezurstva")
      .select("*")
      .gte("date_dezurztva_or_otdyh", startDateStr)
      .lte("date_dezurztva_or_otdyh", endDateStr);

      if (error) {
        console.error("Error fetching duties:", error);
        return;
      }

    console.log(`Загружено записей: ${data?.length || 0}`);

    // Добавляем загруженные данные в кэш
      if (data && data.length > 0) {
      setAllDuties((prev) => {
        const updated = new Map(prev);
        data.forEach((duty) => {
          const dateKey = 
            duty.date_dezurztva_or_otdyh || 
            duty.date_dezurstva_or_otdyh ||
            duty.date ||
            duty.created_at?.split("T")[0] || 
            "";
          
          if (dateKey) {
            const existing = updated.get(dateKey) || [];
            // Проверяем, нет ли уже такого дежурства (по ID)
            if (!existing.some((d) => d.id === duty.id)) {
              updated.set(dateKey, [...existing, duty]);
            }
          }
        });
        return updated;
      });
    }

    // Обновляем диапазон загруженных месяцев
    loadedRangeRef.current = { startYear, startMonth, endYear, endMonth };
  };

  // Основной useEffect для загрузки данных
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      
      const now = new Date();
      const moscowComponents = getMoscowDateComponents(now);
      const currentYear = moscowComponents.year;
      const currentMonth = moscowComponents.month - 1; // месяц в JS от 0 до 11
      
      // Вычисляем диапазон месяцев для загрузки (3 назад, текущий, 3 вперед)
      let startYear = currentYear;
      let startMonth = currentMonth - 3;
      let endYear = currentYear;
      let endMonth = currentMonth + 3;
      
      // Корректируем границы при выходе за пределы года
      while (startMonth < 0) {
        startMonth += 12;
        startYear -= 1;
      }
      while (endMonth > 11) {
        endMonth -= 12;
        endYear += 1;
      }
      
      // Проверяем, нужно ли загружать данные
      const needsInitialLoad = !loadedRangeRef.current;
      const needsCurrentMonth = needsDataForMonth(year, month);
      
      if (needsInitialLoad) {
        // Первая загрузка - загружаем диапазон месяцев
        console.log("Первая загрузка данных за диапазон месяцев");
        await fetchDutiesForRange(startYear, startMonth, endYear, endMonth);
      } else if (needsCurrentMonth && loadedRangeRef.current) {
        // Нужно загрузить данные для текущего месяца
        console.log("Загрузка данных для текущего месяца");
        const { startYear: loadedStartYear, startMonth: loadedStartMonth, endYear: loadedEndYear, endMonth: loadedEndMonth } = loadedRangeRef.current;
        
        // Определяем, нужно ли расширить диапазон вперед или назад
        let newStartYear = loadedStartYear;
        let newStartMonth = loadedStartMonth;
        let newEndYear = loadedEndYear;
        let newEndMonth = loadedEndMonth;
        
        if (year < loadedStartYear || (year === loadedStartYear && month < loadedStartMonth)) {
          // Нужно расширить диапазон назад
          newStartYear = year;
          newStartMonth = month;
          // Загружаем еще 3 месяца назад от нового начала
          let expandStartYear = year;
          let expandStartMonth = month - 3;
          while (expandStartMonth < 0) {
            expandStartMonth += 12;
            expandStartYear -= 1;
          }
          newStartYear = expandStartYear;
          newStartMonth = expandStartMonth;
        } else if (year > loadedEndYear || (year === loadedEndYear && month > loadedEndMonth)) {
          // Нужно расширить диапазон вперед
          newEndYear = year;
          newEndMonth = month;
          // Загружаем еще 3 месяца вперед от нового конца
          let expandEndYear = year;
          let expandEndMonth = month + 3;
          while (expandEndMonth > 11) {
            expandEndMonth -= 12;
            expandEndYear += 1;
          }
          newEndYear = expandEndYear;
          newEndMonth = expandEndMonth;
        }
        
        await fetchDutiesForRange(newStartYear, newStartMonth, newEndYear, newEndMonth);
      }
      
      setLoading(false);
    };

    loadData();
  }, [year, month, refreshTrigger]); // Зависимости: год, месяц и триггер обновления

  // Функция для немедленного добавления дежурства в кэш (для случаев, когда Realtime не работает)
  const addDutyToCache = useCallback((duty: Duty) => {
    const dateKey = 
      duty.date_dezurztva_or_otdyh || 
      duty.created_at?.split("T")[0] || 
      "";
          
          if (dateKey) {
      setAllDuties((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(dateKey) || [];
        // Проверяем, нет ли уже такого дежурства (по ID)
        if (!existing.some((d) => d.id === duty.id)) {
          updated.set(dateKey, [...existing, duty]);
          console.log("Added duty to cache immediately:", duty.id, "for date:", dateKey);
        }
        return updated;
      });
    }
  }, []);

  // Функция для немедленного удаления дежурства из кэша (для случаев, когда Realtime не работает)
  const removeDutyFromCache = useCallback((dutyId: string | number) => {
    console.log("removeDutyFromCache called with ID:", dutyId, "type:", typeof dutyId);
    
    setAllDuties((prev) => {
      const updated = new Map(prev);
      let found = false;
      
      // Нормализуем ID для сравнения (приводим к строке)
      const normalizedId = String(dutyId);
      
      updated.forEach((dutyArray, dateKey) => {
        const filtered = dutyArray.filter((d) => {
          // Сравниваем ID как строки для надежности
          const dutyIdStr = String(d.id);
          const matches = dutyIdStr !== normalizedId;
          if (!matches) {
            console.log("Found matching duty to remove:", d.id, "from date:", dateKey);
          }
          return matches;
        });
        
        if (filtered.length !== dutyArray.length) {
          found = true;
          if (filtered.length > 0) {
            updated.set(dateKey, filtered);
          } else {
            updated.delete(dateKey);
          }
        }
      });
      
      if (found) {
        console.log("Removed duty from cache immediately:", dutyId);
        
        // Используем ref для получения актуальных значений year и month
        const { year: currentYear, month: currentMonth } = currentYearMonthRef.current;
        
        // Сразу обновляем duties для текущего месяца
        const currentMonthDuties = new Map<string, Duty[]>();
        const firstDay = createMoscowDate(currentYear, currentMonth + 1, 1);
        const lastDay = createMoscowDate(currentYear, currentMonth + 2, 0);
        
        updated.forEach((dutyArray, dateKey) => {
          const dutyDate = parseDateMoscow(dateKey);
          if (
            dutyDate >= firstDay &&
            dutyDate <= lastDay &&
            dutyDate.getMonth() === currentMonth &&
            dutyDate.getFullYear() === currentYear
          ) {
            currentMonthDuties.set(dateKey, dutyArray);
          }
        });
        
        // Обновляем duties для текущего месяца сразу
        setDuties(currentMonthDuties);
      } else {
        console.warn("Duty not found in cache for removal:", dutyId);
      }
      
      return updated;
    });
  }, []); // Убираем зависимости, т.к. используем ref для актуальных значений

  // Экспортируем функции через callback props
  useEffect(() => {
    // Всегда экспортируем функции, независимо от наличия props
    if (typeof window !== 'undefined') {
      (window as Window & { __calendarAddDuty?: (duty: Duty) => void }).__calendarAddDuty = addDutyToCache;
      (window as Window & { __calendarDeleteDuty?: (dutyId: string | number) => void }).__calendarDeleteDuty = removeDutyFromCache;
      console.log("Exported calendar cache functions to window object");
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as Window & { __calendarAddDuty?: (duty: Duty) => void }).__calendarAddDuty;
        delete (window as Window & { __calendarDeleteDuty?: (dutyId: string | number) => void }).__calendarDeleteDuty;
      }
    };
  }, [addDutyToCache, removeDutyFromCache]);

  // Единый useEffect для обновления duties - фильтрует по месяцу, трейдерам и статусу утверждения
  useEffect(() => {
    // Сначала фильтруем по месяцу
    const firstDay = createMoscowDate(year, month + 1, 1);
    const lastDay = createMoscowDate(year, month + 2, 0);
    
    const filteredDuties = new Map<string, Duty[]>();
    
    allDuties.forEach((dutyArray, dateKey) => {
      const dutyDate = parseDateMoscow(dateKey);
      
      // Фильтр по месяцу
            if (
              dutyDate >= firstDay &&
              dutyDate <= lastDay &&
              dutyDate.getMonth() === month &&
              dutyDate.getFullYear() === year
            ) {
        // Фильтр по трейдерам и статусу утверждения
        const filtered = dutyArray.filter(duty => {
          // Фильтр по трейдерам (если выбраны)
          if (selectedTraders.size > 0 && !selectedTraders.has(duty.traders)) {
            return false;
          }
          
          // Фильтр по статусу утверждения
          if (showApproved !== null) {
            if (showApproved === true && duty.utverzdeno !== true) {
              return false;
            }
            if (showApproved === false && duty.utverzdeno === true) {
              return false;
            }
          }
          
          return true;
        });
        
        if (filtered.length > 0) {
          filteredDuties.set(dateKey, filtered);
        }
      }
    });
    
    setDuties(filteredDuties);
  }, [allDuties, year, month, selectedTraders, showApproved]);

  // Отдельный useEffect для подписки на Realtime изменения
  // НЕ зависит от year/month, чтобы не пересоздавать подписку при переключении месяцев
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let subscriptionCheckInterval: NodeJS.Timeout | null = null;
    let pollingInterval: NodeJS.Timeout | null = null;
    let isSubscribed = false;
    let lastRealtimeEventTime = Date.now();
    let usePolling = false;
    const POLLING_INTERVAL = 10000; // 10 секунд
    const REALTIME_TIMEOUT = 30000; // 30 секунд без событий = переключение на polling
    let isMounted = true; // Флаг для проверки, что компонент ещё смонтирован
    
    // Функция для обновления данных календаря после Realtime событий или polling
    const updateDuties = async (fullReplace = false) => {
      if (!isMounted) return; // Проверяем, что компонент ещё смонтирован
      
      // Если fullReplace = true, загружаем только данные для загруженного диапазона
      // Если false, загружаем все данные (для Realtime событий)
      let query = supabase.from("dezurstva").select("*");
      
      if (fullReplace && loadedRangeRef.current) {
        // Загружаем только данные для загруженного диапазона
        const { startYear, startMonth, endYear, endMonth } = loadedRangeRef.current;
        const rangeStart = createMoscowDate(startYear, startMonth + 1, 1);
        const rangeEnd = createMoscowDate(endYear, endMonth + 2, 0);
        const startDateStr = formatDateMoscow(rangeStart);
        const endDateStr = formatDateMoscow(rangeEnd);
        
        query = query
          .gte("date_dezurztva_or_otdyh", startDateStr)
          .lte("date_dezurztva_or_otdyh", endDateStr);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching duties after realtime event:", error);
        return;
      }

      // Если fullReplace, полностью заменяем данные для загруженного диапазона
      if (fullReplace && loadedRangeRef.current) {
        const { startYear, startMonth, endYear, endMonth } = loadedRangeRef.current;
        const rangeStart = createMoscowDate(startYear, startMonth + 1, 1);
        const rangeEnd = createMoscowDate(endYear, endMonth + 2, 0);
        
        setAllDuties((prev) => {
          const updated = new Map(prev);
          
          // Удаляем все данные для загруженного диапазона
          updated.forEach((dutyArray, dateKey) => {
            const dutyDate = parseDateMoscow(dateKey);
            if (dutyDate >= rangeStart && dutyDate <= rangeEnd) {
              updated.delete(dateKey);
            }
          });
          
          // Добавляем новые данные из базы
          if (data && data.length > 0) {
            data.forEach((duty) => {
              const dateKey = 
                duty.date_dezurztva_or_otdyh || 
                duty.created_at?.split("T")[0] || 
                "";
              
              if (dateKey) {
                const existing = updated.get(dateKey) || [];
                // Проверяем, нет ли уже такого дежурства (по ID)
                if (!existing.some((d) => String(d.id) === String(duty.id))) {
                  updated.set(dateKey, [...existing, duty]);
                }
              }
            });
          }
          
          // duties будет обновлён автоматически через основной useEffect
          return updated;
        });
      } else {
        // Для Realtime событий - добавляем/обновляем данные
        const updatedDuties = new Map<string, Duty[]>();
        if (data && data.length > 0) {
          data.forEach((duty) => {
            const dateKey = 
              duty.date_dezurztva_or_otdyh || 
              duty.created_at?.split("T")[0] || 
              "";
            
            if (dateKey) {
              const existing = updatedDuties.get(dateKey) || [];
              // Проверяем, нет ли уже такого дежурства (по ID)
              if (!existing.some((d) => String(d.id) === String(duty.id))) {
                updatedDuties.set(dateKey, [...existing, duty]);
              }
            }
          });
        }

        setAllDuties((prev) => {
          const merged = new Map(prev);
          updatedDuties.forEach((dutyArray, dateKey) => {
            merged.set(dateKey, dutyArray);
          });
          
          // duties будет обновлён автоматически через основной useEffect
          return merged;
        });
      }
    };

    // Функция для удаления записи из кэша при DELETE событии
    const handleDelete = (deletedDuty: { id: number | string }) => {
      if (!isMounted) return;
      console.log("Handling DELETE event for duty ID:", deletedDuty.id);
      
      setAllDuties((prev) => {
        const updated = new Map(prev);
        let found = false;
        
        // Ищем и удаляем запись по ID во всех датах
        // Сравниваем ID как строки для надежности
        const deletedIdStr = String(deletedDuty.id);
        updated.forEach((dutyArray, dateKey) => {
          const filtered = dutyArray.filter((d) => String(d.id) !== deletedIdStr);
          if (filtered.length !== dutyArray.length) {
            found = true;
            if (filtered.length > 0) {
              updated.set(dateKey, filtered);
            } else {
              // Если для этой даты больше нет записей, удаляем дату из Map
              updated.delete(dateKey);
            }
          }
        });
        
        if (found) {
          console.log("Deleted duty from cache");
        }
        
        return updated;
      });
    };

    // Функция для создания и подписки на канал
    const subscribeToRealtime = () => {
      // Очищаем предыдущий канал, если он существует
      if (channel) {
        console.log("Removing previous channel before creating new one");
        supabase.removeChannel(channel);
      }
      
      // Создаем уникальное имя канала для избежания конфликтов
      const channelName = `dezurstva_changes_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      console.log("Creating new Realtime channel:", channelName);
      
      channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "dezurstva",
          },
          (payload) => {
            console.log("Realtime INSERT event received:", payload);
            lastRealtimeEventTime = Date.now();
            // Если был включен polling, отключаем его
            if (usePolling && pollingInterval) {
              clearInterval(pollingInterval);
              pollingInterval = null;
              usePolling = false;
              console.log("Realtime is working, stopped polling");
            }
            updateDuties();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "dezurstva",
          },
          (payload) => {
            console.log("Realtime UPDATE event received:", payload);
            lastRealtimeEventTime = Date.now();
            // Если был включен polling, отключаем его
            if (usePolling && pollingInterval) {
              clearInterval(pollingInterval);
              pollingInterval = null;
              usePolling = false;
              console.log("Realtime is working, stopped polling");
            }
            updateDuties();
          }
        )
        .on(
          "postgres_changes",
          {
            event: "DELETE",
            schema: "public",
            table: "dezurstva",
          },
          (payload) => {
            console.log("Realtime DELETE event received:", payload);
            lastRealtimeEventTime = Date.now();
            // Если был включен polling, отключаем его
            if (usePolling && pollingInterval) {
              clearInterval(pollingInterval);
              pollingInterval = null;
              usePolling = false;
              console.log("Realtime is working, stopped polling");
            }
            // Обрабатываем DELETE напрямую, удаляя запись из кэша
            if (payload.old && payload.old.id) {
              handleDelete(payload.old as { id: number | string });
            } else {
              // Если нет данных в payload.old, перезагружаем все данные
              console.log("No old data in DELETE payload, reloading all duties");
              updateDuties();
            }
          }
        )
        .subscribe((status) => {
          console.log("Realtime subscription status:", status);
          isSubscribed = status === "SUBSCRIBED";
          
          if (status === "SUBSCRIBED") {
            console.log("Successfully subscribed to dezurstva changes");
            usePolling = false; // Realtime работает, отключаем polling
            lastRealtimeEventTime = Date.now();
            // Очищаем таймаут переподключения при успешной подписке
            if (reconnectTimeout) {
              clearTimeout(reconnectTimeout);
              reconnectTimeout = null;
            }
            // Останавливаем polling, если он был запущен
            if (pollingInterval) {
              clearInterval(pollingInterval);
              pollingInterval = null;
              console.log("Stopped polling, Realtime is working");
            }
          } else if (status === "CHANNEL_ERROR") {
            console.warn("Realtime недоступен для dezurstva (возможно, заблокирован браузером). Используется polling fallback.");
            // Если Realtime не работает, включаем polling
            if (!usePolling) {
              usePolling = true;
              startPolling();
            }
            // Переподключаемся через 5 секунд при ошибке
            reconnectTimeout = setTimeout(() => {
              console.log("Retrying Realtime subscription...");
              subscribeToRealtime();
            }, 5000);
          } else if (status === "TIMED_OUT") {
            console.warn("Realtime subscription timed out");
            // Если Realtime не работает, включаем polling
            if (!usePolling) {
              console.log("Realtime timed out, switching to polling fallback");
              usePolling = true;
              startPolling();
            }
            reconnectTimeout = setTimeout(() => {
              console.log("Retrying Realtime subscription after timeout...");
              subscribeToRealtime();
            }, 5000);
          } else if (status === "CLOSED") {
            console.warn("Realtime subscription closed");
            // Если Realtime не работает, включаем polling
            if (!usePolling) {
              console.log("Realtime closed, switching to polling fallback");
              usePolling = true;
              startPolling();
            }
            reconnectTimeout = setTimeout(() => {
              console.log("Retrying Realtime subscription after close...");
              subscribeToRealtime();
            }, 5000);
          }
        });
    };

    // Функция для запуска polling fallback
    const startPolling = () => {
      if (pollingInterval) {
        return; // Polling уже запущен
      }
      console.log("Starting polling fallback (checking for changes every", POLLING_INTERVAL / 1000, "seconds)");
      pollingInterval = setInterval(() => {
        console.log("Polling: checking for changes...");
        // Используем fullReplace=true для полной замены данных в загруженном диапазоне
        // Это гарантирует, что удаленные записи будут удалены из кэша
        updateDuties(true);
      }, POLLING_INTERVAL);
    };

    // Периодическая проверка состояния подписки и переключение на polling при необходимости
    subscriptionCheckInterval = setInterval(() => {
      if (channel && !isSubscribed) {
        console.warn("Realtime subscription appears to be inactive, reconnecting...");
        subscribeToRealtime();
      }
      
      // Если Realtime подписан, но нет событий в течение REALTIME_TIMEOUT, переключаемся на polling
      if (isSubscribed && !usePolling && (Date.now() - lastRealtimeEventTime) > REALTIME_TIMEOUT) {
        console.warn("No Realtime events for", REALTIME_TIMEOUT / 1000, "seconds, switching to polling");
        usePolling = true;
        startPolling();
      }
    }, 10000); // Проверяем каждые 10 секунд

    // Начальная подписка
    subscribeToRealtime();

    // Отписываемся при размонтировании
    return () => {
      console.log("Unsubscribing from dezurstva changes");
      isMounted = false;
      
      // Очищаем таймауты
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (subscriptionCheckInterval) {
        clearInterval(subscriptionCheckInterval);
      }
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
      
      // Удаляем канал
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, []); // Подписка создаётся один раз при монтировании, не зависит от year/month

  // Загружаем цвета и веса типов дежурств
  useEffect(() => {
    const fetchDutyTypeData = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("typ_dezurstva")
        .select("tip_dezursva_or_otdyh, color, ves");

      if (!error && data) {
        const colorMap = new Map<string, string>();
        const weightMap = new Map<string, number>();
        
        data.forEach((item) => {
          if (item.tip_dezursva_or_otdyh) {
            if (item.color) {
              colorMap.set(item.tip_dezursva_or_otdyh, item.color);
            }
            // Используем ves или 999 как значение по умолчанию для сортировки
            const weight = item.ves !== null && item.ves !== undefined ? item.ves : 999;
            weightMap.set(item.tip_dezursva_or_otdyh, weight);
          }
        });
        
        setDutyTypeColors(colorMap);
        setDutyTypeWeights(weightMap);
      }
    };

    fetchDutyTypeData();
  }, []);

  // Загружаем список трейдеров для фильтра
  useEffect(() => {
    const fetchTraders = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("traders")
        .select("id, name_short")
        .eq("mozno_dezurit", true)
        .order("name_short", { ascending: true });

      if (!error && data) {
        setTraders(data);
        // По умолчанию выбираем всех трейдеров
        setSelectedTraders(new Set(data.map(t => t.name_short)));
      }
    };

    fetchTraders();
  }, []);


  const handleTraderToggle = (nameShort: string) => {
    setSelectedTraders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nameShort)) {
        newSet.delete(nameShort);
      } else {
        newSet.add(nameShort);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectedTraders.size === traders.length) {
      setSelectedTraders(new Set());
    } else {
      setSelectedTraders(new Set(traders.map(t => t.name_short)));
    }
  };

  const getDaysInMonth = () => {
    const firstDay = createMoscowDate(year, month + 1, 1);
    const lastDay = createMoscowDate(year, month + 2, 0); // последний день месяца
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = (firstDay.getDay() + 6) % 7; // Понедельник = 0

    const days: (Date | null)[] = [];

    // Пустые ячейки до первого дня месяца
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    // Дни месяца
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(createMoscowDate(year, month + 1, i));
    }

    return days;
  };

  const previousMonth = () => {
    // month в JS от 0 до 11, createMoscowDate ожидает от 1 до 12
    // Для предыдущего месяца: month (0-11) -> month + 1 (1-12), но нужно уменьшить на 1
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    setCurrentDate(createMoscowDate(prevYear, prevMonth + 1, 1));
  };

  const nextMonth = () => {
    // month в JS от 0 до 11, createMoscowDate ожидает от 1 до 12
    // Для следующего месяца: month (0-11) -> month + 2 (2-13, но 13 -> 1 следующего года)
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    setCurrentDate(createMoscowDate(nextYear, nextMonth + 1, 1));
  };

  const handleDayClick = (date: Date | null) => {
    if (!date) return;

    // Форматируем дату в московском времени, чтобы избежать сдвига на день
    const dateKey = formatDateMoscow(date);
    const dayDuties = duties.get(dateKey) || [];
    onDayClick(date, dayDuties);
  };

  const days = getDaysInMonth();
  // Получаем сегодняшнюю дату в московском времени
  const moscowToday = getMoscowDateComponents(new Date());
  const today = createMoscowDate(moscowToday.year, moscowToday.month, moscowToday.day);
  
  const isToday = (date: Date | null) => {
    if (!date) return false;
    const dateCopy = new Date(date);
    dateCopy.setHours(0, 0, 0, 0);
    return (
      dateCopy.getDate() === today.getDate() &&
      dateCopy.getMonth() === today.getMonth() &&
      dateCopy.getFullYear() === today.getFullYear()
    );
  };

  const isPastDate = (date: Date | null) => {
    if (!date) return false;
    const dateCopy = new Date(date);
    dateCopy.setHours(0, 0, 0, 0);
    return dateCopy < today;
  };

  // Получение классов размера ячейки на основе настройки cellSize
  const getCellSizeClasses = () => {
    switch (cellSize) {
      case 1: // Мини
        return {
          cell: "p-0.5 text-[8px] md:text-[9px]",
          date: "text-[8px] md:text-[9px] leading-none",
          duty: "text-[7px] md:text-[8px] px-0.5 leading-none",
          plus: "text-[7px]",
          gap: "gap-px md:gap-0.5",
          weekday: "text-[10px] py-0.5",
        };
      case 2: // Компакт
        return {
          cell: "p-0.5 text-[10px] md:text-xs",
          date: "text-[10px] md:text-xs leading-tight",
          duty: "text-[9px] md:text-[10px] px-0.5 leading-tight",
          plus: "text-[9px]",
          gap: "gap-0.5 md:gap-1",
          weekday: "text-xs py-1",
        };
      case 3: // Обычный
        return {
          cell: "p-1 text-xs md:text-sm",
          date: "text-xs md:text-sm leading-normal mb-0.5",
          duty: "text-[10px] md:text-xs px-1 py-0.5 leading-normal",
          plus: "text-[10px]",
          gap: "gap-1 md:gap-1.5",
          weekday: "text-sm py-1.5",
        };
      case 4: // Большой
        return {
          cell: "p-1.5 md:p-2 text-sm md:text-base",
          date: "text-sm md:text-base leading-normal mb-1",
          duty: "text-xs md:text-sm px-1.5 py-0.5 leading-normal",
          plus: "text-xs",
          gap: "gap-1.5 md:gap-2",
          weekday: "text-base py-2",
        };
      case 5: // Макс
        return {
          cell: "p-2 md:p-3 text-base md:text-lg",
          date: "text-base md:text-lg leading-normal mb-1",
          duty: "text-sm md:text-base px-2 py-1 leading-normal",
          plus: "text-sm",
          gap: "gap-2 md:gap-3",
          weekday: "text-lg py-2.5",
        };
      default:
        return {
          cell: "p-1 text-xs md:text-sm",
          date: "text-xs md:text-sm leading-normal mb-0.5",
          duty: "text-[10px] md:text-xs px-1 py-0.5 leading-normal",
          plus: "text-[10px]",
          gap: "gap-1 md:gap-1.5",
          weekday: "text-sm py-1.5",
        };
    }
  };
  
  const sizeClasses = getCellSizeClasses();
  
  // Получение стилей отступа ячейки
  const getPaddingStyle = () => {
    const paddingMap: Record<number, string> = {
      1: "0px",
      2: "2px",
      3: "4px",
      4: "6px",
      5: "8px",
    };
    return paddingMap[cellPadding] || "2px";
  };
  
  // Получение стилей скругления
  const getBorderRadiusStyle = () => {
    const radiusMap: Record<number, string> = {
      1: "0px",
      2: "4px",
      3: "6px",
      4: "8px",
      5: "12px",
    };
    return radiusMap[borderRadius] || "4px";
  };
  
  // Проверка, является ли день выходным (суббота или воскресенье)
  const isWeekend = (date: Date | null) => {
    if (!date) return false;
    const day = date.getDay();
    return day === 0 || day === 6; // 0 = воскресенье, 6 = суббота
  };
  
  // Получение номера недели в году
  const getWeekNumber = (date: Date): number => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  };
  
  // Количество колонок в сетке (7 дней + опционально 1 для номера недели)
  const gridCols = showWeekNumbers ? "grid-cols-8" : "grid-cols-7";

  return (
    <div 
      className="mx-auto p-4 origin-top"
      style={{ 
        width: `${calendarWidth}%`, 
        maxWidth: maxWidth > 0 ? `${maxWidth}px` : "100%",
        maxHeight: maxHeight > 0 ? `${maxHeight}px` : undefined,
        overflow: maxHeight > 0 ? "auto" : undefined,
        transform: currentScale < 100 ? `scale(${currentScale / 100})` : undefined,
        transformOrigin: 'top center',
      }}
    >
      <div className="bg-card border rounded-lg shadow-sm p-4 md:p-6">
        {/* Header с навигацией */}
        <div className="flex items-center justify-between mb-6">
          <Button
            variant="outline"
            size="icon"
            onClick={previousMonth}
            className="h-8 w-8"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-xl md:text-2xl font-semibold">
            {monthNames[month]} {year}
          </h2>
          <Button
            variant="outline"
            size="icon"
            onClick={nextMonth}
            className="h-8 w-8"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Дни недели */}
        <div className={cn("grid mb-1", gridCols, sizeClasses.gap)}>
          {showWeekNumbers && (
            <div className={cn("text-center font-medium text-muted-foreground/50", sizeClasses.weekday)}>
              №
            </div>
          )}
          {weekDays.map((day, idx) => (
            <div
              key={day}
              className={cn(
                "text-center font-medium text-muted-foreground", 
                sizeClasses.weekday,
                highlightWeekends && (idx === 5 || idx === 6) && "text-red-500/70"
              )}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Календарная сетка */}
        {!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? (
          <div className="text-center py-8 text-muted-foreground">
            Переменные окружения Supabase не настроены
          </div>
        ) : loading ? (
          <div className="text-center py-8 text-muted-foreground">
            Загрузка...
          </div>
        ) : (
          <div className={cn("grid", gridCols, sizeClasses.gap)}>
            {days.map((date, index) => {
              // Добавляем номер недели в начале каждой строки (если включено)
              const isStartOfWeek = index % 7 === 0;
              const weekNumberCell = showWeekNumbers && isStartOfWeek ? (
                <div 
                  key={`week-${index}`}
                  className={cn(
                    "flex items-center justify-center text-muted-foreground/50 aspect-square",
                    sizeClasses.weekday
                  )}
                >
                  {date ? getWeekNumber(date) : ""}
                </div>
              ) : null;
              
              if (!date) {
                return showWeekNumbers && isStartOfWeek ? (
                  <React.Fragment key={`empty-${index}`}>
                    {weekNumberCell}
                    <div className="aspect-square" />
                  </React.Fragment>
                ) : (
                  <div key={index} className="aspect-square" />
                );
              }

              // Форматируем дату в московском времени, чтобы избежать сдвига на день
              const dateKey = formatDateMoscow(date);
              const dayDutiesRaw = duties.get(dateKey) || [];
              
              // Сортируем дежурства по весу (ves) из таблицы typ_dezurstva
              const dayDuties = [...dayDutiesRaw].sort((a, b) => {
                const weightA = a.tip_dezursva_or_otdyh 
                  ? (dutyTypeWeights.get(a.tip_dezursva_or_otdyh) ?? 999)
                  : 999;
                const weightB = b.tip_dezursva_or_otdyh
                  ? (dutyTypeWeights.get(b.tip_dezursva_or_otdyh) ?? 999)
                  : 999;
                return weightA - weightB; // Сортировка по возрастанию (меньше значение - выше в списке)
              });
              
              // Проверяем, является ли день выходным
              const weekendClass = highlightWeekends && isWeekend(date) 
                ? "bg-red-50/50 dark:bg-red-900/10" 
                : "";
              
              const todayClass = isToday(date)
                ? "border-2 border-red-500 text-foreground font-semibold bg-[#FFFFFF] dark:bg-[#A1A1A1]"
                : isPastDate(date)
                ? "border border-black dark:border-black bg-muted/30 dark:bg-muted/70 opacity-30 hover:bg-muted/30 dark:hover:bg-muted/70"
                : cn("border border-black dark:border-black bg-muted/90 dark:bg-muted/90 hover:bg-muted/90 text-foreground", weekendClass);

              const cellContent = (
                <button
                  key={index}
                  onClick={() => {
                    const now = Date.now();
                    const isDoubleClick = 
                      lastClickTime?.date.getTime() === date.getTime() && 
                      now - lastClickTime.time < 300;

                    // Очищаем предыдущий таймер
                    if (clickTimeoutRef.current) {
                      clearTimeout(clickTimeoutRef.current);
                      clickTimeoutRef.current = null;
                    }

                    if (isDoubleClick && onDoubleClick) {
                      // Двойной клик - открываем карточку добавления дежурства
                      setLastClickTime(null);
                      onDoubleClick(date);
                    } else {
                      // Одинарный клик - открываем карточку просмотра
                      setLastClickTime({ date, time: now });
                      
                      clickTimeoutRef.current = setTimeout(() => {
                        handleDayClick(date);
                        clickTimeoutRef.current = null;
                      }, 300);
                    }
                  }}
                  className={cn(
                    "aspect-square text-left transition-colors",
                    "flex flex-col items-start justify-start",
                    sizeClasses.cell,
                    todayClass
                  )}
                  style={{
                    padding: getPaddingStyle(),
                    borderRadius: getBorderRadiusStyle(),
                  }}
                >
                  <span className={cn("font-medium", sizeClasses.date)}>{date.getDate()}</span>
                  <div className="flex flex-col w-full overflow-hidden">
                    {dayDuties.slice(0, visibleRows).map((duty, idx) => {
                      // Получаем цвет для утвержденных дежурств
                      const dutyColor = duty.utverzdeno === true && duty.tip_dezursva_or_otdyh
                        ? dutyTypeColors.get(duty.tip_dezursva_or_otdyh)
                        : null;

                      return (
                        <div
                          key={idx}
                          className={cn(
                            "truncate rounded border border-black/50 dark:border-black/50",
                            sizeClasses.duty,
                            isToday(date)
                              ? dutyColor
                                ? ""
                                : "bg-primary-foreground/20"
                              : dutyColor
                                ? ""
                                : "bg-background/50"
                          )}
                          style={
                            dutyColor
                              ? {
                                  backgroundColor: dutyColor,
                                  color: getContrastColor(dutyColor),
                                }
                              : undefined
                          }
                          title={duty.traders}
                        >
                          {duty.traders}
                        </div>
                      );
                    })}
                    {/* Красный знак "+" если есть скрытые записи */}
                    {dayDuties.length > visibleRows && (
                      <div 
                        className={cn("text-red-500 font-bold text-right leading-none", sizeClasses.plus)}
                        title={`Ещё ${dayDuties.length - visibleRows} записей`}
                      >
                        +
                      </div>
                    )}
                  </div>
                </button>
              );

              // Возвращаем номер недели и ячейку дня
              return showWeekNumbers && isStartOfWeek ? (
                <React.Fragment key={`row-${index}`}>
                  {weekNumberCell}
                  {cellContent}
                </React.Fragment>
              ) : cellContent;
            })}
          </div>
        )}

        {/* Фильтры */}
        <div className="mt-6 pt-4 border-t">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            {/* Фильтр по трейдерам - слева */}
            {traders.length > 0 && (
              <div className="space-y-3 flex-1">
                <Label className="text-sm font-semibold">Фильтр по трейдерам:</Label>
                <div className="flex flex-wrap gap-3">
                  {traders.map((trader) => (
                    <div
                      key={trader.id}
                      className="flex items-center space-x-2"
                    >
                      <Checkbox
                        id={`trader-${trader.id}`}
                        checked={selectedTraders.has(trader.name_short)}
                        onCheckedChange={() => handleTraderToggle(trader.name_short)}
                      />
                      <Label
                        htmlFor={`trader-${trader.id}`}
                        className="text-sm font-medium leading-none cursor-pointer"
                      >
                        {trader.name_short || "Без имени"}
                      </Label>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAll}
                  className="h-7 text-xs"
                >
                  {selectedTraders.size === traders.length ? "Снять все" : "Выбрать все"}
                </Button>
              </div>
            )}

            {/* Фильтр по статусу утверждения - справа */}
            <div className="space-y-2 flex-shrink-0">
              <Label className="text-sm font-semibold">Фильтр по статусу утверждения:</Label>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="filter-all"
                    checked={showApproved === null}
                    onCheckedChange={(checked) => {
                      if (checked) setShowApproved(null);
                    }}
                  />
                  <Label
                    htmlFor="filter-all"
                    className="text-sm font-medium leading-none cursor-pointer"
                  >
                    Все
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="filter-approved"
                    checked={showApproved === true}
                    onCheckedChange={(checked) => {
                      if (checked) setShowApproved(true);
                      else setShowApproved(null);
                    }}
                  />
                  <Label
                    htmlFor="filter-approved"
                    className="text-sm font-medium leading-none cursor-pointer"
                  >
                    Утверждено
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="filter-not-approved"
                    checked={showApproved === false}
                    onCheckedChange={(checked) => {
                      if (checked) setShowApproved(false);
                      else setShowApproved(null);
                    }}
                  />
                  <Label
                    htmlFor="filter-not-approved"
                    className="text-sm font-medium leading-none cursor-pointer"
                  >
                    Не утверждено
                  </Label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

