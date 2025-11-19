export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Layout теперь пустой, так как шапка находится в page.tsx
  return <>{children}</>;
}
