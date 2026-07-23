"use client";

/**
 * Плавное раскрытие/сворачивание без замера высоты в JS — трюк на grid-template-rows
 * (0fr -> 1fr), поддерживается везде, где работает CSS Grid. Контент остаётся в DOM
 * даже свёрнутым (не unmount) — переключение не теряет внутренний стейт вложенных
 * компонентов между показами.
 */
export function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
