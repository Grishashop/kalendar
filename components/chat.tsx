"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { X, Send, Reply, Copy, Check, Search, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: number;
  author_id: number;
  message: string;
  reply_to_id?: number;
  mentioned_trader_id?: number;
  created_at: string;
  updated_at?: string;
  author?: {
    name_short?: string;
    mail?: string;
    photo?: string;
  };
  reply_to?: {
    message: string;
    author?: {
      name_short?: string;
    };
  };
  mentioned_trader?: {
    name_short?: string;
  };
}

interface Trader {
  id: number;
  name_short?: string;
  mail?: string;
}

interface ChatProps {
  userEmail: string | null;
  currentTraderId?: number;
}

export function Chat({ userEmail, currentTraderId }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [traders, setTraders] = useState<Trader[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [mentionedTraderId, setMentionedTraderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [lastMessageId, setLastMessageId] = useState<number | null>(null);
  const notificationPermissionRef = useRef<NotificationPermission | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isScrolledToBottom, setIsScrolledToBottom] = useState(true);

  useEffect(() => {
    console.log("Chat component mounted/updated:", { userEmail, currentTraderId });
    if (!currentTraderId) {
      console.warn("currentTraderId is not set! Delete functionality may not work.");
    }
  }, [userEmail, currentTraderId]);

  useEffect(() => {
    // Запрашиваем разрешение на уведомления
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission().then((permission) => {
          notificationPermissionRef.current = permission;
        });
      } else {
        notificationPermissionRef.current = Notification.permission;
      }
    }

    fetchTraders();
    fetchMessages();

    // Подписываемся на новые сообщения через Supabase Realtime
    const supabase = createClient();
    const channel = supabase
      .channel("chat_messages_changes")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
        },
        async (payload) => {
          const newId = payload.new.id;
          const newAuthorId = payload.new.author_id;
          
          // Пропускаем сообщения, которые мы только что отправили (проверяем по author_id)
          if (currentTraderId && newAuthorId === currentTraderId) {
            console.log("Skipping own message from Realtime:", newId);
            return;
          }
          
          // Пропускаем старые сообщения
          if (lastMessageId !== null && newId <= lastMessageId) {
            console.log("Skipping old message from Realtime:", newId);
            return;
          }

          // Проверяем, нет ли уже такого сообщения в списке
          setMessages((prev) => {
            if (prev.some((msg) => msg.id === newId)) {
              console.log("Message already exists, skipping:", newId);
              return prev;
            }
            return prev;
          });

          // Загружаем полные данные нового сообщения
          const { data: newMessageData, error } = await supabase
            .from("chat_messages")
            .select(`
              *,
              author:traders!chat_messages_author_id_fkey(id, name_short, mail, photo),
              mentioned_trader:traders!chat_messages_mentioned_trader_id_fkey(name_short)
            `)
            .eq("id", newId)
            .single();

          console.log("New message from Realtime:", { newMessageData, error });

          if (!error && newMessageData) {
            // Загружаем reply_to отдельно, если есть
            let messageWithReply = newMessageData;
            if (newMessageData.reply_to_id) {
              const { data: replyData } = await supabase
                .from("chat_messages")
                .select(`
                  id,
                  message,
                  author_id,
                  author:traders!chat_messages_author_id_fkey(name_short, photo)
                `)
                .eq("id", newMessageData.reply_to_id)
                .single();
              
              messageWithReply = {
                ...newMessageData,
                reply_to: replyData || null,
              };
            }
            
            const formattedMessage = formatMessage(messageWithReply);
            
            // Дополнительная проверка перед добавлением
            setMessages((prev) => {
              // Проверяем, нет ли уже такого сообщения по ID
              if (prev.some((msg) => msg.id === formattedMessage.id)) {
                console.log("Message already in list, skipping:", formattedMessage.id);
                return prev;
              }
              console.log("Adding new message from Realtime:", formattedMessage.id);
              return [...prev, formattedMessage];
            });
            
            // Показываем уведомление, если сообщение не от текущего пользователя
            if (formattedMessage.author?.mail !== userEmail) {
              showNotification(formattedMessage);
            }
            
            // Обновляем lastMessageId только если это действительно новое сообщение
            setLastMessageId((prevId) => {
              if (prevId === null || newId > prevId) {
                return newId;
              }
              return prevId;
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "chat_messages",
        },
        (payload) => {
          // Удаляем сообщение из списка
          setMessages((prev) => prev.filter((msg) => msg.id !== payload.old.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  useEffect(() => {
    if (isScrolledToBottom) {
      scrollToBottom();
    }
  }, [messages, isScrolledToBottom]);

  // Отслеживание прокрутки для показа кнопки "Вниз"
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
      setIsScrolledToBottom(isAtBottom);
      setShowScrollButton(!isAtBottom && messages.length > 0);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [messages.length]);

  const fetchTraders = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("traders")
      .select("id, name_short, mail")
      .order("name_short", { ascending: true });
    
    if (data) {
      setTraders(data);
    }
  };

  const fetchMessages = async () => {
    setLoading(true);
    const supabase = createClient();
    
    console.log("Fetching messages...");
    
    // Сначала загружаем основные сообщения с авторами и упомянутыми трейдерами
    const { data, error } = await supabase
      .from("chat_messages")
      .select(`
        *,
        author:traders!chat_messages_author_id_fkey(id, name_short, mail, photo),
        mentioned_trader:traders!chat_messages_mentioned_trader_id_fkey(name_short)
      `)
      .order("created_at", { ascending: true });

    console.log("Messages fetch result:", { data, error });

    if (error) {
      console.error("Error fetching messages:", error);
      alert(`Ошибка при загрузке сообщений: ${error.message}`);
      setLoading(false);
      return;
    }

    if (data) {
      console.log("Raw messages data:", data);
      
      // Загружаем данные reply_to отдельно для сообщений, у которых есть reply_to_id
      const messagesWithReplies = await Promise.all(
        data.map(async (msg) => {
          if (msg.reply_to_id) {
            const { data: replyData } = await supabase
              .from("chat_messages")
              .select(`
                id,
                message,
                author_id,
                author:traders!chat_messages_author_id_fkey(name_short)
              `)
              .eq("id", msg.reply_to_id)
              .single();
            
            return {
              ...msg,
              reply_to: replyData || null,
            };
          }
          return msg;
        })
      );
      
      const formattedMessages = messagesWithReplies.map(formatMessage);
      console.log("Formatted messages:", formattedMessages);
      setMessages(formattedMessages);
      if (formattedMessages.length > 0) {
        setLastMessageId(formattedMessages[formattedMessages.length - 1].id);
      }
    } else {
      console.log("No messages data returned");
      setMessages([]);
    }
    
    setLoading(false);
  };

  const formatMessage = (msg: Record<string, unknown>): ChatMessage => {
    // Обрабатываем случай, когда author может быть массивом или объектом
    let author = null;
    if (msg.author) {
      if (Array.isArray(msg.author)) {
        author = msg.author[0];
      } else {
        author = msg.author;
      }
    }

    // Обрабатываем reply_to
    let reply_to = null;
    if (msg.reply_to) {
      if (Array.isArray(msg.reply_to)) {
        reply_to = msg.reply_to[0];
      } else {
        reply_to = msg.reply_to;
      }
    }

    // Обрабатываем mentioned_trader
    let mentioned_trader = null;
    if (msg.mentioned_trader) {
      if (Array.isArray(msg.mentioned_trader)) {
        mentioned_trader = msg.mentioned_trader[0];
      } else {
        mentioned_trader = msg.mentioned_trader;
      }
    }

    return {
      id: Number(msg.id) || 0,
      author_id: Number(msg.author_id) || 0,
      message: String(msg.message || ""),
      reply_to_id: msg.reply_to_id ? Number(msg.reply_to_id) : undefined,
      mentioned_trader_id: msg.mentioned_trader_id ? Number(msg.mentioned_trader_id) : undefined,
      created_at: String(msg.created_at || ""),
      updated_at: msg.updated_at ? String(msg.updated_at) : undefined,
      author: author ? {
        name_short: author.name_short,
        mail: author.mail,
        photo: author.photo,
      } : undefined,
      reply_to: reply_to ? {
        message: reply_to.message,
        author: reply_to.author ? {
          name_short: Array.isArray(reply_to.author) 
            ? reply_to.author[0]?.name_short 
            : reply_to.author.name_short,
        } : undefined,
      } : undefined,
      mentioned_trader: mentioned_trader ? {
        name_short: mentioned_trader.name_short,
      } : undefined,
    };
  };

  const showNotification = (message: ChatMessage) => {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      notificationPermissionRef.current === "granted"
    ) {
      const authorName = message.author?.name_short || "Неизвестный";
      const notification = new Notification(`Новое сообщение от ${authorName}`, {
        body: message.message.length > 100 
          ? message.message.substring(0, 100) + "..." 
          : message.message,
        icon: "/favicon.ico",
        tag: `chat-${message.id}`,
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };
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
            const start = textarea.selectionStart || 0;
            const end = textarea.selectionEnd || 0;
            const newValue = 
              newMessage.substring(0, start) + 
              markdownTable + 
              newMessage.substring(end);
            setNewMessage(newValue);
            
            // Устанавливаем курсор после вставленного текста
            setTimeout(() => {
              textarea.selectionStart = textarea.selectionEnd = start + markdownTable.length;
            }, 0);
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
          const start = textarea.selectionStart || 0;
          const end = textarea.selectionEnd || 0;
          const newValue = 
            newMessage.substring(0, start) + 
            markdownTable + 
            newMessage.substring(end);
          setNewMessage(newValue);
          
          // Устанавливаем курсор после вставленного текста
          setTimeout(() => {
            textarea.selectionStart = textarea.selectionEnd = start + markdownTable.length;
          }, 0);
          return;
        }
      }
    }
    
    // Если это не таблица, вставляем как обычный текст
    const textarea = e.currentTarget;
    const start = textarea.selectionStart || 0;
    const end = textarea.selectionEnd || 0;
    const newValue = 
      newMessage.substring(0, start) + 
      pastedText + 
      newMessage.substring(end);
    setNewMessage(newValue);
    
    // Устанавливаем курсор после вставленного текста
    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = start + pastedText.length;
    }, 0);
  };

  const handleSend = async () => {
    if (!newMessage.trim()) {
      alert("Сообщение не может быть пустым");
      return;
    }

    if (!currentTraderId) {
      alert("Ошибка: не удалось определить ID трейдера");
      console.error("currentTraderId is missing:", currentTraderId);
      return;
    }

    const supabase = createClient();
    
    const messageData: {
      author_id: number;
      message: string;
      reply_to_id?: number;
      mentioned_trader_id?: number;
    } = {
      author_id: currentTraderId,
      message: newMessage.trim(),
    };

    if (replyingTo?.id) {
      messageData.reply_to_id = replyingTo.id;
    }

    if (mentionedTraderId) {
      messageData.mentioned_trader_id = mentionedTraderId;
    }

    console.log("Sending message:", messageData);

    const { data, error } = await supabase
      .from("chat_messages")
      .insert(messageData)
      .select();

    if (error) {
      console.error("Error sending message:", error);
      console.error("Error details:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      alert(`Ошибка при отправке: ${error.message}\n\nПодробности: ${error.details || error.hint || "Нет дополнительной информации"}`);
    } else {
      console.log("Message sent successfully:", data);
      
      // После успешной отправки сразу добавляем сообщение в список
      // чтобы оно отобразилось немедленно, не дожидаясь Realtime
      if (data && data[0]) {
        // Загружаем данные автора и упомянутого трейдера (без reply_to, чтобы избежать self-join)
        const { data: fullMessage, error: fetchError } = await supabase
          .from("chat_messages")
          .select(`
            *,
            author:traders!chat_messages_author_id_fkey(id, name_short, mail, photo),
            mentioned_trader:traders!chat_messages_mentioned_trader_id_fkey(name_short)
          `)
          .eq("id", data[0].id)
          .single();

        if (!fetchError && fullMessage) {
          // Если есть reply_to_id, загружаем данные reply_to отдельно
          let replyToData = null;
          if (fullMessage.reply_to_id) {
            const { data: replyData } = await supabase
              .from("chat_messages")
              .select(`
                id,
                message,
                author_id,
                author:traders!chat_messages_author_id_fkey(name_short)
              `)
              .eq("id", fullMessage.reply_to_id)
              .single();
            
            replyToData = replyData;
          }

          const messageWithReply = {
            ...fullMessage,
            reply_to: replyToData,
          };

          const formattedMessage = formatMessage(messageWithReply);
          console.log("Formatted message after send:", formattedMessage);
          
          // Обновляем lastMessageId ПЕРЕД добавлением сообщения, чтобы Realtime подписка его пропустила
          setLastMessageId(formattedMessage.id);
          
          setMessages((prev) => {
            // Проверяем, нет ли уже такого сообщения
            if (prev.some((msg) => msg.id === formattedMessage.id)) {
              console.log("Message already in list after send, skipping:", formattedMessage.id);
              return prev;
            }
            console.log("Adding message after send:", formattedMessage.id);
            return [...prev, formattedMessage];
          });
        } else {
          console.error("Error fetching full message:", fetchError);
          // Если не удалось загрузить полные данные, используем базовые данные
          // Но попробуем загрузить хотя бы автора из traders
          const { data: authorData } = await supabase
            .from("traders")
            .select("id, name_short, mail, photo")
            .eq("id", data[0].author_id)
            .single();

          const basicMessage: ChatMessage = {
            id: data[0].id,
            author_id: data[0].author_id,
            message: data[0].message,
            reply_to_id: data[0].reply_to_id || null,
            mentioned_trader_id: data[0].mentioned_trader_id || null,
            created_at: data[0].created_at,
            updated_at: data[0].updated_at,
            author: authorData ? {
              name_short: authorData.name_short,
              mail: authorData.mail,
              photo: authorData.photo,
            } : undefined,
          };
          // Обновляем lastMessageId ПЕРЕД добавлением сообщения
          setLastMessageId(basicMessage.id);
          
          setMessages((prev) => {
            if (prev.some((msg) => msg.id === basicMessage.id)) {
              console.log("Basic message already in list, skipping:", basicMessage.id);
              return prev;
            }
            console.log("Adding basic message after send:", basicMessage.id);
            return [...prev, basicMessage];
          });
        }
      }
      
      setNewMessage("");
      setReplyingTo(null);
      setMentionedTraderId(null);
    }
  };

  const handleDelete = async (messageId: number) => {
    if (!confirm("Вы уверены, что хотите удалить это сообщение?")) return;

    // Находим сообщение для проверки
    const messageToDelete = messages.find((msg) => msg.id === messageId);
    if (!messageToDelete) {
      alert("Сообщение не найдено");
      return;
    }

    // Проверяем, что пользователь удаляет только свое сообщение
    if (messageToDelete.author_id !== currentTraderId) {
      alert("Вы можете удалить только свои сообщения");
      console.error("Delete attempt failed:", {
        messageAuthorId: messageToDelete.author_id,
        currentTraderId: currentTraderId,
      });
      return;
    }

    console.log("Deleting message:", {
      messageId,
      authorId: messageToDelete.author_id,
      currentTraderId,
    });

    const supabase = createClient();
    
    // Сначала проверяем, можем ли мы прочитать это сообщение (для отладки)
    const { data: checkData, error: checkError } = await supabase
      .from("chat_messages")
      .select("id, author_id")
      .eq("id", messageId)
      .single();
    
    console.log("Message check before delete:", { checkData, checkError });

    // Пытаемся удалить
    const { data, error } = await supabase
      .from("chat_messages")
      .delete()
      .eq("id", messageId)
      .select();

    console.log("Delete result:", { 
      data, 
      error,
      errorString: error ? JSON.stringify(error, null, 2) : null,
      errorKeys: error ? Object.keys(error) : null,
    });

    if (error) {
      const errorMessage = error.message || "Неизвестная ошибка";
      const errorDetails = error.details || error.hint || error.code || "Нет дополнительной информации";
      console.error("Delete error full object:", error);
      console.error("Delete error details:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        fullError: JSON.stringify(error, null, 2),
      });
      alert(`Ошибка при удалении: ${errorMessage}\n\nПодробности: ${errorDetails}`);
    } else {
      console.log("Message deleted successfully");
      setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
    }
  };

  // Функция для рендеринга Markdown в сообщениях (особенно таблиц)
  let renderKey = 0;
  
  const renderInlineElements = (text: string) => {
    const parts: (string | React.ReactElement)[] = [];
    let lastIndex = 0;

    // Обработка инлайн кода `code`
    const codeRegex = /`([^`]+)`/g;
    let match;

    while ((match = codeRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      parts.push(
        <code key={`code-${renderKey++}`} className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
          {match[1]}
        </code>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : [text];
  };

  const renderMarkdownMessage = (content: string) => {
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
          <div key={`table-${renderKey++}`} className="overflow-x-auto my-2">
            <table className="w-full border border-border text-sm">
              <thead>
                <tr className="bg-muted/60">
                  {headerCells.map((cell, idx) => (
                    <th key={`header-${idx}`} className="border border-border px-3 py-2 text-left font-semibold text-foreground">
                      {renderInlineElements(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, rowIdx) => (
                  <tr key={`row-${rowIdx}`} className={rowIdx % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                    {row.map((cell, cellIdx) => (
                      <td key={`cell-${rowIdx}-${cellIdx}`} className="border border-border px-3 py-2 align-top text-foreground">
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

      // Обычный текст
      if (line.trim() === "") {
        elements.push(<br key={`br-${renderKey++}`} />);
        i++;
        continue;
      }

      elements.push(
        <span key={`text-${renderKey++}`}>
          {renderInlineElements(line)}
        </span>
      );
      
      // Добавляем перенос строки после каждой строки, кроме последней
      if (i < lines.length - 1) {
        elements.push(<br key={`br-after-${renderKey++}`} />);
      }
      
      i++;
    }

    return elements.length > 0 ? elements : [content];
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

  const handleCopy = async (message: ChatMessage) => {
    let textToCopy = message.message;
    
    // Пробуем преобразовать Markdown таблицу в TSV
    const tsvTable = convertMarkdownTableToTSV(message.message);
    if (tsvTable) {
      textToCopy = tsvTable;
    }
    
    try {
      // Проверяем доступность Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        // Fallback для старых браузеров или небезопасных контекстов
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
        textArea.style.position = "fixed";
        textArea.style.left = "-999999px";
        textArea.style.top = "-999999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        textArea.remove();
      }
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
      // Показываем сообщение пользователю, если копирование не удалось
      alert("Не удалось скопировать сообщение в буфер обмена");
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "только что";
    if (diffMins < 60) return `${diffMins} мин назад`;
    if (diffHours < 24) return `${diffHours} ч назад`;
    if (diffDays === 1) return "вчера";
    if (diffDays < 7) return `${diffDays} дн назад`;

    return date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Сегодня";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Вчера";
    } else {
      return date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    }
  };

  const isMyMessage = (message: ChatMessage) => {
    // Проверяем и по email, и по author_id для надежности
    return (
      message.author?.mail === userEmail ||
      (currentTraderId !== undefined && message.author_id === currentTraderId)
    );
  };

  // Фильтрация сообщений по поисковому запросу
  const filteredMessages = searchQuery.trim()
    ? messages.filter((msg) =>
        msg.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
        msg.author?.name_short?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages;

  // Группировка сообщений от одного автора
  const shouldGroupMessage = (message: ChatMessage, index: number) => {
    if (index === 0) return false;
    const prevMessage = filteredMessages[index - 1];
    const timeDiff = new Date(message.created_at).getTime() - new Date(prevMessage.created_at).getTime();
    return (
      prevMessage.author_id === message.author_id &&
      timeDiff < 300000 && // 5 минут
      !message.reply_to
    );
  };

  // Подсветка текста в поиске
  const highlightText = (text: string, query: string) => {
    if (!query.trim()) return text;
    const parts = text.split(new RegExp(`(${query})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase() ? (
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-200px)]">
      {/* Панель поиска */}
      <div className="mb-3 relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Поиск по сообщениям..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 pr-9 h-9 text-sm"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
            onClick={() => setSearchQuery("")}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
        {searchQuery && (
          <div className="absolute top-full left-0 right-0 mt-1 text-xs text-muted-foreground px-2">
            Найдено: {filteredMessages.length} из {messages.length}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto mb-3 space-y-1" ref={messagesContainerRef}>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-muted-foreground">Загрузка сообщений...</p>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-muted-foreground">
              {searchQuery ? "Сообщения не найдены" : "Нет сообщений. Начните общение!"}
            </p>
          </div>
        ) : (
          <>
            {filteredMessages.map((message, index) => {
              const showDate = index === 0 || 
                new Date(message.created_at).toDateString() !== 
                new Date(filteredMessages[index - 1].created_at).toDateString();
              const grouped = shouldGroupMessage(message, index);
              const myMessage = isMyMessage(message);
              
              return (
                <div key={message.id}>
                  {showDate && (
                    <div className="text-center text-xs text-muted-foreground my-3 px-2">
                      <span className="bg-background px-2 py-0.5 rounded-full">
                        {formatDate(message.created_at)}
                      </span>
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex gap-2 group transition-all",
                      myMessage ? "justify-end" : "justify-start",
                      grouped && "mt-0.5"
                    )}
                    onDoubleClick={() => handleCopy(message)}
                  >
                    {/* Аватар для чужих сообщений */}
                    {!myMessage && (
                      <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden border border-border/50">
                        {message.author?.photo ? (
                          <img
                            src={message.author.photo}
                            alt={message.author?.name_short || "Трейдер"}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              // Если фото не загрузилось, показываем инициалы
                              const target = e.target as HTMLImageElement;
                              target.style.display = "none";
                              const parent = target.parentElement;
                              if (parent) {
                                parent.className = "w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-medium border border-border/50";
                                parent.textContent = message.author?.name_short?.[0]?.toUpperCase() || "?";
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                            {message.author?.name_short?.[0]?.toUpperCase() || "?"}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Аватар для своих сообщений */}
                    {myMessage && (
                      <div className="w-8 h-8 rounded-full flex-shrink-0 overflow-hidden border border-border/50">
                        {message.author?.photo ? (
                          <img
                            src={message.author.photo}
                            alt={message.author?.name_short || "Трейдер"}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = "none";
                              const parent = target.parentElement;
                              if (parent) {
                                parent.className = "w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-xs font-medium border border-primary/30";
                                parent.textContent = message.author?.name_short?.[0]?.toUpperCase() || "?";
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary-foreground">
                            {message.author?.name_short?.[0]?.toUpperCase() || "?"}
                          </div>
                        )}
                      </div>
                    )}
                    <div
                      className={cn(
                        "max-w-[75%] rounded-2xl px-3 py-1.5 relative transition-all",
                        "shadow-sm hover:shadow-md",
                        myMessage
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-muted rounded-bl-sm",
                        grouped && "mt-0"
                      )}
                    >
                      {/* Автор и время (только если не сгруппировано) */}
                      {!grouped && (
                        <div className={cn(
                          "flex items-center gap-2 mb-0.5",
                          myMessage ? "justify-end" : "justify-start"
                        )}>
                          <span className={cn(
                            "text-xs font-medium",
                            myMessage ? "text-primary-foreground/90" : "text-foreground/70"
                          )}>
                            {message.author?.name_short || "Неизвестный"}
                          </span>
                          <span className={cn(
                            "text-[10px]",
                            myMessage ? "text-primary-foreground/60" : "text-muted-foreground"
                          )}>
                            {formatTime(message.created_at)}
                          </span>
                        </div>
                      )}

                      {/* Ответ на сообщение */}
                      {message.reply_to && (
                        <div
                          className={cn(
                            "mb-1.5 pb-1.5 border-l-2 pl-2 text-xs",
                            myMessage 
                              ? "border-primary-foreground/30 text-primary-foreground/80" 
                              : "border-border text-muted-foreground"
                          )}
                        >
                          <div className="font-medium mb-0.5">
                            {message.reply_to.author?.name_short || "Неизвестный"}
                          </div>
                          <div className="truncate">
                            {message.reply_to.message.length > 40
                              ? message.reply_to.message.substring(0, 40) + "..."
                              : message.reply_to.message}
                          </div>
                        </div>
                      )}

                      {/* Упоминание трейдера */}
                      {message.mentioned_trader && (
                        <div className="mb-1">
                          <span className={cn(
                            "text-xs font-medium px-1.5 py-0.5 rounded",
                            myMessage
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : "bg-primary/10 text-primary"
                          )}>
                            @{message.mentioned_trader.name_short}
                          </span>
                        </div>
                      )}

                      {/* Текст сообщения */}
                      <div className={cn(
                        "text-sm whitespace-pre-wrap break-words leading-relaxed",
                        myMessage ? "text-primary-foreground" : "text-foreground"
                      )}>
                        {searchQuery ? (
                          highlightText(message.message, searchQuery)
                        ) : (
                          <div className="space-y-1">
                            {renderMarkdownMessage(message.message)}
                          </div>
                        )}
                      </div>

                      {/* Кнопки действий */}
                      <div className={cn(
                        "flex gap-1 mt-1.5 transition-opacity",
                        myMessage ? "justify-end" : "justify-start",
                        "opacity-0 group-hover:opacity-100"
                      )}>
                        {!myMessage && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => setReplyingTo(message)}
                          >
                            <Reply className="h-3 w-3" />
                          </Button>
                        )}
                        {myMessage && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs hover:bg-destructive/20 hover:text-destructive"
                            onClick={() => handleDelete(message.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                        {copiedId === message.id ? (
                          <span className={cn(
                            "text-[10px] flex items-center gap-1 px-2",
                            myMessage ? "text-primary-foreground/70" : "text-muted-foreground"
                          )}>
                            <Check className="h-3 w-3" />
                            Скопировано
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => handleCopy(message)}
                            title="Двойной клик для копирования"
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Кнопка прокрутки вниз */}
      {showScrollButton && (
        <Button
          variant="default"
          size="icon"
          className="fixed bottom-24 right-6 rounded-full shadow-lg h-10 w-10 z-10"
          onClick={() => {
            setIsScrolledToBottom(true);
            scrollToBottom();
          }}
        >
          <ArrowDown className="h-4 w-4" />
        </Button>
      )}

      {/* Форма отправки сообщения */}
      <Card className="p-3 border-t">
        {/* Индикатор ответа */}
        {replyingTo && (
          <div className="mb-2 p-2 bg-muted rounded-lg flex items-center justify-between border border-border">
            <div className="text-xs flex-1 min-w-0">
              <span className="font-medium text-foreground">Ответ на:</span>{" "}
              <span className="text-primary">{replyingTo.author?.name_short || "Неизвестный"}</span>
              <div className="text-muted-foreground truncate mt-0.5">
                {replyingTo.message.length > 40
                  ? replyingTo.message.substring(0, 40) + "..."
                  : replyingTo.message}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 ml-2 flex-shrink-0"
              onClick={() => setReplyingTo(null)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        {/* Выбор адресата для упоминания */}
        {traders.length > 0 && (
          <div className="mb-2 flex justify-end">
            <select
              value={mentionedTraderId || ""}
              onChange={(e) =>
                setMentionedTraderId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-auto min-w-[200px] max-w-[300px] px-3 py-1.5 border rounded-lg text-xs bg-background h-8"
            >
              <option value="">Упомянуть трейдера (необязательно)</option>
              {traders.map((trader) => (
                <option key={trader.id} value={trader.id}>
                  @{trader.name_short || trader.mail}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Поле ввода и кнопка отправки */}
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <Textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Введите сообщение... (Enter для отправки, Shift+Enter для новой строки). Можно вставлять таблицы из Excel!"
              className="pr-12 min-h-[40px] resize-none"
              rows={1}
            />
            {newMessage.length > 0 && (
              <div className="absolute right-2 bottom-1.5 text-[10px] text-muted-foreground">
                {newMessage.length}
              </div>
            )}
          </div>
          <Button 
            onClick={handleSend} 
            disabled={!newMessage.trim() || !currentTraderId}
            title={!currentTraderId ? "ID трейдера не найден" : "Отправить сообщение"}
            className="h-10 w-10 p-0 rounded-lg"
            size="icon"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {!currentTraderId && (
          <p className="text-xs text-destructive mt-2">
            Ошибка: ID трейдера не найден. Проверьте, что вы зарегистрированы в таблице traders.
          </p>
        )}
      </Card>
    </div>
  );
}

