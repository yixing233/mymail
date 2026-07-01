"use client";

import { useEffect, useRef } from "react";

interface NotificationMessage {
  id: string;
  providerId: string;
  providerLabel: string;
  account: string;
  from: string;
  subject: string;
  preview: string;
  receivedAt: string;
}

interface NotificationResponse {
  enabled: boolean;
  messages: NotificationMessage[];
}

function buildNotificationBody(message: NotificationMessage) {
  const preview = message.preview.trim();
  return [
    `${message.providerLabel} · ${message.account}`,
    message.from,
    preview,
  ].filter(Boolean).join("\n");
}

function buildNotificationTitle(message: NotificationMessage) {
  return message.subject.trim() || "新邮件";
}

export function NotificationWatcher() {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const notificationStartedAtRef = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    async function poll() {
      try {
        const response = await fetch("/api/notifications", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as NotificationResponse;

        if (!alive) return;
        if (!payload.enabled || !("Notification" in window) || Notification.permission !== "granted") {
          initializedRef.current = false;
          seenIdsRef.current = new Set(payload.messages.map((message) => message.id));
          notificationStartedAtRef.current = Date.now();
          return;
        }

        const currentIds = new Set(payload.messages.map((message) => message.id));
        if (!initializedRef.current) {
          seenIdsRef.current = currentIds;
          initializedRef.current = true;
          notificationStartedAtRef.current = Date.now();
          return;
        }

        const newMessages = payload.messages
          .filter((message) => {
            if (seenIdsRef.current.has(message.id)) return false;
            const receivedAt = new Date(message.receivedAt).getTime();
            return Number.isFinite(receivedAt) && receivedAt > notificationStartedAtRef.current;
          })
          .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

        for (const message of newMessages) {
          const notification = new Notification(buildNotificationTitle(message), {
            body: buildNotificationBody(message),
            tag: message.id,
            icon: `/api/notification-icon/${encodeURIComponent(message.providerId)}`,
            badge: `/api/notification-icon/${encodeURIComponent(message.providerId)}`,
          });
          notification.onclick = () => {
            window.focus();
            notification.close();
          };
        }

        seenIdsRef.current = currentIds;
      } finally {
        if (alive) {
          timer = window.setTimeout(poll, 15000);
        }
      }
    }

    void poll();

    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
