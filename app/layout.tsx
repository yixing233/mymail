import type { Metadata } from "next";
import { ToastProvider } from "@/components/toast";
import { ContextMenuProvider } from "@/components/context-menu";
import { NotificationWatcher } from "@/components/notification-watcher";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyMail",
  description: "Personal unified inbox for 163, QQ, Outlook, and Gmail.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ToastProvider>
          <ContextMenuProvider>
            <NotificationWatcher />
            {children}
          </ContextMenuProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
