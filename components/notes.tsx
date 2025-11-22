"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { 
  Plus, 
  Search, 
  Folder, 
  FolderPlus, 
  Pin, 
  Tag, 
  Trash2, 
  Edit, 
  X, 
  Save,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NoteFolder {
  id: number;
  trader_id: number;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface Note {
  id: number;
  trader_id: number;
  folder_id: number | null;
  title: string;
  content: string;
  is_pinned: boolean;
  tags: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  folder_name?: string;
  folder_color?: string;
}

interface NotesProps {
  currentTraderId?: number;
  userEmail: string | null;
}

export function Notes({ currentTraderId }: NotesProps) {
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [editingFolder, setEditingFolder] = useState<NoteFolder | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState("#3B82F6");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteTags, setNoteTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const autoTitleRef = useRef<string | null>(null);
  let renderKey = 0;

  const colors = [
    "#3B82F6", // синий
    "#10B981", // зеленый
    "#F59E0B", // оранжевый
    "#EF4444", // красный
    "#8B5CF6", // фиолетовый
    "#EC4899", // розовый
    "#06B6D4", // голубой
    "#84CC16", // лайм
  ];

  useEffect(() => {
    if (currentTraderId) {
      fetchFolders();
      fetchNotes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTraderId]);

  useEffect(() => {
    if (currentTraderId) {
      fetchNotes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFolderId, currentTraderId]);

  const fetchFolders = async () => {
    if (!currentTraderId) return;
    
    const supabase = createClient();
    const { data, error } = await supabase
      .from("note_folders")
      .select("*")
      .eq("trader_id", currentTraderId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching folders:", error);
    } else {
      setFolders(data || []);
    }
  };

  const fetchNotes = async () => {
    if (!currentTraderId) return;
    
    setLoading(true);
    const supabase = createClient();
    
    let query = supabase
      .from("notes")
      .select(`
        *,
        folder:note_folders(name, color)
      `)
      .eq("trader_id", currentTraderId)
      .is("deleted_at", null)
      .order("is_pinned", { ascending: false })
      .order("updated_at", { ascending: false });

    // Если выбрана конкретная папка, фильтруем по ней
    // Если selectedFolderId === null, показываем все заметки (без фильтра)
    if (selectedFolderId !== null) {
      query = query.eq("folder_id", selectedFolderId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching notes:", error);
    } else {
      const formattedNotes = (data || []).map((note: Note & { folder?: { name?: string; color?: string } }) => ({
        ...note,
        folder_name: note.folder?.name,
        folder_color: note.folder?.color,
      }));
      setNotes(formattedNotes);
    }
    setLoading(false);
  };

  const handleCreateFolder = async () => {
    if (!currentTraderId || !newFolderName.trim()) return;

    const supabase = createClient();
    const { data, error } = await supabase
      .from("note_folders")
      .insert({
        trader_id: currentTraderId,
        name: newFolderName.trim(),
        color: newFolderColor,
        sort_order: folders.length,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating folder:", error);
      alert(`Ошибка при создании папки: ${error.message}`);
    } else {
      setFolders([...folders, data]);
      setNewFolderName("");
      setShowFolderForm(false);
    }
  };

  const handleUpdateFolder = async () => {
    if (!editingFolder || !newFolderName.trim()) return;

    const supabase = createClient();
    const { data, error } = await supabase
      .from("note_folders")
      .update({
        name: newFolderName.trim(),
        color: newFolderColor,
      })
      .eq("id", editingFolder.id)
      .select()
      .single();

    if (error) {
      console.error("Error updating folder:", error);
      alert(`Ошибка при обновлении папки: ${error.message}`);
    } else {
      setFolders(folders.map(f => f.id === data.id ? data : f));
      setEditingFolder(null);
      setNewFolderName("");
      setShowFolderForm(false);
    }
  };

  const handleDeleteFolder = async (folderId: number) => {
    if (!confirm("Удалить папку? Все заметки из этой папки будут перемещены в корень.")) return;

    const supabase = createClient();
    
    // Сначала перемещаем заметки в корень
    await supabase
      .from("notes")
      .update({ folder_id: null })
      .eq("folder_id", folderId);

    // Затем удаляем папку
    const { error } = await supabase
      .from("note_folders")
      .delete()
      .eq("id", folderId);

    if (error) {
      console.error("Error deleting folder:", error);
      alert(`Ошибка при удалении папки: ${error.message}`);
    } else {
      setFolders(folders.filter(f => f.id !== folderId));
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
      fetchNotes();
    }
  };

  const handleCreateNote = async () => {
    if (!currentTraderId) return;

    // Извлекаем title из content, если title пустой
    const finalTitle = noteTitle.trim() || extractTitleFromContent(noteContent);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("notes")
      .insert({
        trader_id: currentTraderId,
        folder_id: selectedFolderId,
        title: finalTitle,
        content: noteContent,
        is_pinned: isPinned,
        tags: noteTags,
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating note:", error);
      alert(`Ошибка при создании заметки: ${error.message}`);
    } else {
      fetchNotes();
      setSelectedNote(data);
      setIsEditing(false);
      resetNoteForm();
    }
  };

  const handleUpdateNote = async () => {
    if (!selectedNote) return;

    // Извлекаем title из content, если title пустой
    const finalTitle = noteTitle.trim() || extractTitleFromContent(noteContent);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("notes")
      .update({
        title: finalTitle,
        content: noteContent,
        is_pinned: isPinned,
        tags: noteTags,
        folder_id: selectedFolderId,
      })
      .eq("id", selectedNote.id)
      .select()
      .single();

    if (error) {
      console.error("Error updating note:", error);
      alert(`Ошибка при обновлении заметки: ${error.message}`);
    } else {
      fetchNotes();
      setSelectedNote({ ...data, folder_name: selectedNote.folder_name, folder_color: selectedNote.folder_color });
      setIsEditing(false);
    }
  };

  const handleDeleteNote = async (noteId: number) => {
    if (!confirm("Удалить заметку?")) return;

    const supabase = createClient();
    
    // Используем функцию для мягкого удаления (обходит RLS проблемы)
    const { error: rpcError } = await supabase
      .rpc('soft_delete_note', { note_id: noteId });

    if (rpcError) {
      console.error("RPC error:", rpcError);
      console.error("Error details:", JSON.stringify(rpcError, null, 2));
      
      // Если функция не существует, пробуем прямой UPDATE
      if (rpcError.code === '42883') {
        const { error } = await supabase
          .from("notes")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", noteId)
          .select();

        if (error) {
          console.error("Error deleting note:", error);
          alert(`Ошибка при удалении заметки: ${error.message || error.details || JSON.stringify(error)}`);
        } else {
          fetchNotes();
          if (selectedNote?.id === noteId) {
            setSelectedNote(null);
            setIsEditing(false);
          }
        }
      } else {
        alert(`Ошибка при удалении заметки: ${rpcError.message || rpcError.details || JSON.stringify(rpcError)}`);
      }
    } else {
      // Функция сработала успешно
      fetchNotes();
      if (selectedNote?.id === noteId) {
        setSelectedNote(null);
        setIsEditing(false);
      }
    }
  };

  const handleTogglePin = async (note: Note) => {
    if (!currentTraderId) return;

    const supabase = createClient();
    const { data, error } = await supabase
      .from("notes")
      .update({ is_pinned: !note.is_pinned })
      .eq("id", note.id)
      .select()
      .single();

    if (error) {
      console.error("Error toggling pin:", error);
    } else {
      fetchNotes();
      if (selectedNote?.id === note.id) {
        setSelectedNote({ ...data, folder_name: note.folder_name, folder_color: note.folder_color });
      }
    }
  };

  const handleSelectNote = (note: Note) => {
    setSelectedNote(note);
    setIsEditing(false);
    setNoteTitle(note.title);
    autoTitleRef.current = null;
    setNoteContent(note.content);
    setNoteTags(note.tags || []);
    setIsPinned(note.is_pinned);
  };

  const handleNewNote = () => {
    setSelectedNote(null);
    setIsEditing(true);
    resetNoteForm();
    autoTitleRef.current = "";
  };

  const resetNoteForm = () => {
    setNoteTitle("");
    autoTitleRef.current = null;
    setNoteContent("");
    setNoteTags([]);
    setIsPinned(false);
  };

  const handleAddTag = () => {
    if (newTag.trim() && !noteTags.includes(newTag.trim())) {
      setNoteTags([...noteTags, newTag.trim()]);
      setNewTag("");
    }
  };

  const handleRemoveTag = (tag: string) => {
    setNoteTags(noteTags.filter(t => t !== tag));
  };

  // Функция для преобразования Markdown таблицы в TSV формат
  const convertMarkdownTableToTSV = (markdownText: string): string | null => {
    const lines = markdownText.split('\n');
    const parseTableRow = (row: string) =>
      row
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map(cell => cell.trim());

    const isTableSeparator = (line: string) =>
      /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*(?:\s*:?-{3,}:?\s*)?\|?\s*$/.test(line.trim());

    // Ищем начало таблицы
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      
      // Проверяем, является ли это началом таблицы
      if (
        line.includes("|") &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1])
      ) {
        const headerCells = parseTableRow(line);
        let j = i + 2;
        const bodyRows: string[][] = [];
        
        // Собираем все строки таблицы
        while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
          bodyRows.push(parseTableRow(lines[j]));
          j++;
        }

        if (bodyRows.length > 0) {
          // Преобразуем в TSV формат
          const tsvRows: string[] = [];
          
          // Заголовок (без разделителя)
          tsvRows.push(headerCells.join('\t'));
          
          // Данные
          bodyRows.forEach(row => {
            tsvRows.push(row.join('\t'));
          });
          
          return tsvRows.join('\n');
        }
      }
      i++;
    }
    
    return null;
  };

  // Функция для копирования содержимого заметки в буфер обмена
  const handleCopyNoteContent = async () => {
    if (!selectedNote?.content) return;

    let textToCopy = selectedNote.content;
    
    // Удаляем первую строку (заголовок) из содержимого
    const lines = textToCopy.split('\n');
    if (lines.length > 1) {
      // Пропускаем первую строку и объединяем остальные
      textToCopy = lines.slice(1).join('\n');
    } else {
      // Если только одна строка, копируем пустую строку
      textToCopy = '';
    }
    
    // Пробуем преобразовать Markdown таблицу в TSV
    const tsvTable = convertMarkdownTableToTSV(textToCopy);
    if (tsvTable) {
      textToCopy = tsvTable;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        // Fallback для старых браузеров
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      
      // Показываем уведомление
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2000);
    } catch (error) {
      console.error("Ошибка при копировании:", error);
      alert("Не удалось скопировать содержимое заметки");
    }
  };

  // Функция для преобразования таблицы в Markdown формат
  const convertTableToMarkdown = (data: string[][]): string => {
    if (data.length === 0) return "";
    
    const rows: string[] = [];
    
    // Заголовок таблицы
    rows.push("| " + data[0].join(" | ") + " |");
    
    // Разделитель
    rows.push("| " + data[0].map(() => "---").join(" | ") + " |");
    
    // Остальные строки
    for (let i = 1; i < data.length; i++) {
      rows.push("| " + data[i].join(" | ") + " |");
    }
    
    return rows.join("\n");
  };

  // Обработчик вставки из буфера обмена
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    
    const clipboardData = e.clipboardData;
    const pastedText = clipboardData.getData('text/plain');
    const pastedHtml = clipboardData.getData('text/html');
    
    // Пробуем обработать HTML таблицу (из Excel/Google Sheets)
    if (pastedHtml && pastedHtml.includes('<table')) {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(pastedHtml, 'text/html');
        const table = doc.querySelector('table');
        
        if (table) {
          const rows: string[][] = [];
          const tableRows = table.querySelectorAll('tr');
          
          tableRows.forEach((tr) => {
            const cells: string[] = [];
            const tableCells = tr.querySelectorAll('td, th');
            tableCells.forEach((cell) => {
              cells.push(cell.textContent?.trim() || '');
            });
            if (cells.length > 0) {
              rows.push(cells);
            }
          });
          
          if (rows.length > 0) {
            const markdownTable = convertTableToMarkdown(rows);
            const textarea = e.currentTarget;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const newContent = 
              noteContent.substring(0, start) + 
              markdownTable + 
              noteContent.substring(end);
            setNoteContent(newContent);
            return;
          }
        }
      } catch (error) {
        console.error("Error parsing HTML table:", error);
      }
    }
    
    // Пробуем обработать TSV (tab-separated values) - формат из Excel
    if (pastedText.includes('\t')) {
      const lines = pastedText.split('\n').filter(line => line.trim());
      if (lines.length > 0) {
        const rows: string[][] = [];
        let maxCols = 0;
        
        lines.forEach((line) => {
          const cells = line.split('\t').map(cell => cell.trim());
          if (cells.length > 0) {
            rows.push(cells);
            maxCols = Math.max(maxCols, cells.length);
          }
        });
        
        // Нормализуем количество колонок (добавляем пустые ячейки если нужно)
        rows.forEach(row => {
          while (row.length < maxCols) {
            row.push('');
          }
        });
        
        if (rows.length > 0 && maxCols > 1) {
          const markdownTable = convertTableToMarkdown(rows);
          const textarea = e.currentTarget;
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const newContent = 
            noteContent.substring(0, start) + 
            markdownTable + 
            noteContent.substring(end);
          setNoteContent(newContent);
          return;
        }
      }
    }
    
    // Если это не таблица, вставляем как обычный текст
    const textarea = e.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newContent = 
      noteContent.substring(0, start) + 
      pastedText + 
      noteContent.substring(end);
    setNoteContent(newContent);
    
    // Устанавливаем курсор после вставленного текста
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + pastedText.length;
    }, 0);
  };

  const filteredNotes = searchQuery.trim()
    ? notes.filter(note =>
        note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : notes;

  // Функция для обработки инлайн элементов (код, жирный, курсив)
  const renderInlineElements = (text: string) => {
    const parts: (string | React.ReactElement)[] = [];

    // Обработка инлайн кода `code`
    const codeRegex = /`([^`]+)`/g;
    let match;
    let lastIndex = 0;

    while ((match = codeRegex.exec(text)) !== null) {
      // Добавляем текст до кода
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      // Добавляем код
      parts.push(
        <code key={`code-${renderKey++}`} className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
          {match[1]}
        </code>
      );
      lastIndex = match.index + match[0].length;
    }

    // Добавляем оставшийся текст
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : [text];
  };

  const renderMarkdownContent = (content: string) => {
    if (!content) return null;

    const lines = content.split('\n');
    const elements: React.ReactElement[] = [];
    let i = 0;

    const parseTableRow = (row: string) =>
      row
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map(cell => cell.trim());

    const isTableSeparator = (line: string) =>
      /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*(?:\s*:?-{3,}:?\s*)?\|?\s*$/.test(line.trim());

    while (i < lines.length) {
      const line = lines[i];

      // Обработка код-блоков (тройные обратные кавычки)
      if (line.trim().startsWith("```")) {
        const language = line.trim().substring(3).trim() || "";
        let j = i + 1;
        const codeLines: string[] = [];
        
        while (j < lines.length && !lines[j].trim().startsWith("```")) {
          codeLines.push(lines[j]);
          j++;
        }

        elements.push(
          <div key={`codeblock-${renderKey++}`} className="mb-4">
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto">
              <code className="text-sm font-mono block whitespace-pre">
                {codeLines.join('\n')}
              </code>
            </pre>
            {language && (
              <div className="text-xs text-muted-foreground mt-1 px-1">{language}</div>
            )}
          </div>
        );
        i = j + 1;
        continue;
      }

      // Обработка таблиц
      if (
        line.includes("|") &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1])
      ) {
        const headerCells = parseTableRow(line);
        let j = i + 2;
        const bodyRows: string[][] = [];
        while (j < lines.length && lines[j].includes("|") && lines[j].trim() !== "") {
          bodyRows.push(parseTableRow(lines[j]));
          j++;
        }

        elements.push(
          <div key={`table-${renderKey++}`} className="overflow-x-auto mb-4">
            <table className="w-full border border-border text-sm">
              <thead>
                <tr className="bg-muted">
                  {headerCells.map((cell, idx) => (
                    <th key={`header-${idx}`} className="border border-border px-3 py-2 text-left font-semibold">
                      {renderInlineElements(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, rowIdx) => (
                  <tr key={`row-${rowIdx}`} className="odd:bg-background even:bg-muted/40">
                    {row.map((cell, cellIdx) => (
                      <td key={`cell-${rowIdx}-${cellIdx}`} className="border border-border px-3 py-2 align-top">
                        {renderInlineElements(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        i = j;
        continue;
      }

      // Обработка заголовков
      if (line.startsWith("# ")) {
        elements.push(
          <h1 key={`h1-${renderKey++}`} className="text-2xl font-bold mb-2">
            {renderInlineElements(line.substring(2))}
          </h1>
        );
        i++;
        continue;
      }
      if (line.startsWith("## ")) {
        elements.push(
          <h2 key={`h2-${renderKey++}`} className="text-xl font-bold mb-2">
            {renderInlineElements(line.substring(3))}
          </h2>
        );
        i++;
        continue;
      }
      if (line.startsWith("### ")) {
        elements.push(
          <h3 key={`h3-${renderKey++}`} className="text-lg font-bold mb-2">
            {renderInlineElements(line.substring(4))}
          </h3>
        );
        i++;
        continue;
      }

      // Обработка чекбоксов (- [ ] и - [x])
      const checkboxMatch = line.match(/^(\s*)([-*])\s+\[([ xX])\]\s+(.+)$/);
      if (checkboxMatch) {
        const indent = checkboxMatch[1];
        const isChecked = checkboxMatch[3].toLowerCase() === 'x';
        const text = checkboxMatch[4];
        
        elements.push(
          <div key={`checkbox-${renderKey++}`} className="mb-1 flex items-start gap-2" style={{ marginLeft: indent.length * 0.5 + 'rem' }}>
            <input
              type="checkbox"
              checked={isChecked}
              readOnly
              className="mt-1 h-4 w-4 cursor-default"
            />
            <span className={isChecked ? "line-through text-muted-foreground" : ""}>
              {renderInlineElements(text)}
            </span>
          </div>
        );
        i++;
        continue;
      }

      // Обработка обычных списков
      if (line.match(/^(\s*)([-*])\s+(.+)$/)) {
        const match = line.match(/^(\s*)([-*])\s+(.+)$/);
        if (match) {
          const indent = match[1];
          const text = match[3];
          elements.push(
            <li key={`li-${renderKey++}`} className="ml-4 list-disc" style={{ marginLeft: indent.length * 0.5 + 1 + 'rem' }}>
              {renderInlineElements(text)}
            </li>
          );
        }
        i++;
        continue;
      }

      // Пустая строка
      if (line.trim() === "") {
        elements.push(<br key={`br-${renderKey++}`} />);
        i++;
        continue;
      }

      // Обычный текст
      elements.push(
        <p key={`p-${renderKey++}`} className="mb-2">
          {renderInlineElements(line)}
        </p>
      );
      i++;
    }

    return elements;
  };

  // Функция для извлечения title из первой строки content
  const extractTitleFromContent = (content: string): string => {
    if (!content || !content.trim()) return "Без названия";
    const firstLine = content.split('\n')[0].replace(/^#+\s*/, '').trim();
    return firstLine || "Без названия";
  };

  // Автоматически извлекаем title из первой строки content при редактировании
  useEffect(() => {
    if (!isEditing) return;

    const extractedTitle = extractTitleFromContent(noteContent);
    const shouldUpdateTitle =
      !noteTitle ||
      noteTitle === "Без названия" ||
      noteTitle.trim() === "" ||
      noteTitle === autoTitleRef.current;

    if (shouldUpdateTitle) {
      setNoteTitle(extractedTitle);
      autoTitleRef.current = extractedTitle;
    }
  }, [noteContent, noteTitle, isEditing]);

  if (!currentTraderId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">ID трейдера не найден</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-300px)] gap-4">
      {/* Боковая панель с папками */}
      <div className="w-52 flex-shrink-0 border-r border-border overflow-y-auto">
        <div className="p-4 space-y-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Папки</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingFolder(null);
                setNewFolderName("");
                setNewFolderColor("#3B82F6");
                setShowFolderForm(!showFolderForm);
              }}
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          </div>

          {showFolderForm && (
            <Card className="p-3 mb-2">
              <Input
                placeholder="Название папки"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="mb-2"
              />
              <div className="flex gap-1 mb-2">
                {colors.map((color) => (
                  <button
                    key={color}
                    className={cn(
                      "w-6 h-6 rounded-full border-2",
                      newFolderColor === color ? "border-foreground" : "border-transparent"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewFolderColor(color)}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={editingFolder ? handleUpdateFolder : handleCreateFolder}
                  className="flex-1"
                >
                  {editingFolder ? "Сохранить" : "Создать"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowFolderForm(false);
                    setEditingFolder(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          )}

          <Button
            variant={selectedFolderId === null ? "default" : "ghost"}
            className="w-full justify-start"
            onClick={() => setSelectedFolderId(null)}
          >
            <FileText className="h-4 w-4 mr-2" />
            Все заметки
          </Button>

          {folders.map((folder) => (
            <div key={folder.id} className="flex items-center group">
              <Button
                variant={selectedFolderId === folder.id ? "default" : "ghost"}
                className="flex-1 justify-start"
                onClick={() => setSelectedFolderId(folder.id)}
              >
                <Folder
                  className="h-4 w-4 mr-2"
                  style={{ color: folder.color }}
                  fill={selectedFolderId === folder.id ? folder.color : "none"}
                />
                {folder.name}
              </Button>
              <div className="opacity-0 group-hover:opacity-100 flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingFolder(folder);
                    setNewFolderName(folder.name);
                    setNewFolderColor(folder.color);
                    setShowFolderForm(true);
                  }}
                >
                  <Edit className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteFolder(folder.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Список заметок */}
      <div className="w-64 flex-shrink-0 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <div className="relative mb-4">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск заметок..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button onClick={handleNewNote} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Новая заметка
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-muted-foreground">Загрузка...</div>
          ) : filteredNotes.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              {searchQuery ? "Заметки не найдены" : "Нет заметок"}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {filteredNotes.map((note) => (
                <Card
                  key={note.id}
                  className={cn(
                    "p-3 cursor-pointer transition-colors",
                    selectedNote?.id === note.id ? "bg-primary/10 border-primary" : "hover:bg-muted"
                  )}
                  onClick={() => handleSelectNote(note)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {note.is_pinned && (
                          <Pin className="h-3 w-3 text-primary flex-shrink-0" fill="currentColor" />
                        )}
                        <h4 className="font-medium truncate">{note.title}</h4>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {note.content.split('\n')[0].replace(/^#+\s*/, '')}
                      </p>
                      {note.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {note.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                          {note.tags.length > 3 && (
                            <Badge variant="secondary" className="text-xs">
                              +{note.tags.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Редактор заметки */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedNote || isEditing ? (
          <div className="flex flex-col h-full">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {isEditing ? (
                  <div className="flex flex-col gap-2 flex-1">
                    <Label htmlFor="note-title">Название заметки:</Label>
                    <Input
                      id="note-title"
                      placeholder="Название заметки"
                      value={noteTitle}
                      onChange={(e) => {
                        setNoteTitle(e.target.value);
                        autoTitleRef.current = null;
                      }}
                      className="flex-1"
                    />
                  </div>
                ) : (
                  <h2 className="font-semibold truncate">{selectedNote?.title}</h2>
                )}
                {selectedNote && !isEditing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTogglePin(selectedNote)}
                  >
                    <Pin
                      className={cn(
                        "h-4 w-4",
                        selectedNote.is_pinned && "text-primary fill-current"
                      )}
                    />
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {isEditing ? (
                  <>
                    <Button size="sm" onClick={selectedNote ? handleUpdateNote : handleCreateNote}>
                      <Save className="h-4 w-4 mr-2" />
                      Сохранить
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setIsEditing(false);
                        if (selectedNote) {
                          handleSelectNote(selectedNote);
                        } else {
                          setSelectedNote(null);
                          resetNoteForm();
                        }
                      }}
                    >
                      Отмена
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)}>
                      <Edit className="h-4 w-4 mr-2" />
                      Редактировать
                    </Button>
                    {selectedNote && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteNote(selectedNote.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {isEditing ? (
                <div className="space-y-4 h-full flex flex-col">
                  <div className="flex-1">
                    <textarea
                      ref={contentTextareaRef}
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      onPaste={handlePaste}
                      placeholder="Начните писать заметку... (поддерживается Markdown). Можно вставлять таблицы из Excel!"
                      className="w-full h-full min-h-[400px] p-4 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Добавить тег"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddTag();
                          }
                        }}
                        className="flex-1"
                      />
                      <Button size="sm" onClick={handleAddTag}>
                        <Tag className="h-4 w-4" />
                      </Button>
                    </div>
                    {noteTags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {noteTags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                            {tag}
                            <button
                              onClick={() => handleRemoveTag(tag)}
                              className="ml-1 hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div 
                  className="prose prose-sm dark:prose-invert max-w-none relative cursor-pointer group"
                  onDoubleClick={handleCopyNoteContent}
                  title="Двойной клик, чтобы скопировать содержимое заметки"
                >
                  <div className="whitespace-pre-wrap break-words">
                    {selectedNote?.content && renderMarkdownContent(selectedNote.content)}
                  </div>
                  {copiedNotification && (
                    <div className="fixed top-4 right-4 bg-primary text-primary-foreground px-4 py-2 rounded-lg shadow-lg z-50 animate-in fade-in slide-in-from-top-2">
                      Содержимое скопировано в буфер обмена!
                    </div>
                  )}
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 backdrop-blur-sm px-2 py-1 rounded text-xs text-muted-foreground">
                    Двойной клик, чтобы скопировать
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Выберите заметку или создайте новую
          </div>
        )}
      </div>
    </div>
  );
}

