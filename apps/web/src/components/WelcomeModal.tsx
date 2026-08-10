"use client";

import { useState, useEffect, useCallback } from "react";
import Button from "@/components/ui/Button";
import { useSession, signOut } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";

export default function WelcomeModal() {
  const { data: session, status } = useSession();
  const [show, setShow] = useState(false);
  const [text, setText] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);

  const checkTos = useCallback(async () => {
    if (status !== "authenticated" || !session?.user) return;
    try {
      const res = await fetch("/api/profile/me");
      if (!res.ok) return;
      const data = await res.json();
      if (data.tosAccepted) return;

      const wRes = await fetch("/api/welcome");
      if (!wRes.ok) return;
      const wData = await wRes.json();
      setText(wData.text);
      setShow(true);
    } catch {
      // silent
    }
  }, [status, session]);

  useEffect(() => {
    checkTos();
  }, [checkTos]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await fetch("/api/welcome/accept", { method: "POST" });
      setShow(false);
    } catch {
      // retry
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    if (!confirmDecline) {
      setConfirmDecline(true);
      return;
    }
    setDeclining(true);
    try {
      // Delete account so no personal data is stored
      await fetch("/api/welcome/decline", { method: "POST" });
      // Sign out — account no longer exists
      await signOut({ callbackUrl: "/" });
    } catch {
      setDeclining(false);
      setConfirmDecline(false);
    }
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-neutral-200 dark:border-white/10"
          >
            <div className="p-6 border-b border-neutral-100 dark:border-white/5">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-black text-sm">TZ</div>
                <h2 className="text-lg font-bold text-neutral-900 dark:text-white">Добро пожаловать в TrioZ!</h2>
              </div>
            </div>

            <div className="p-6 max-h-[50vh] overflow-y-auto">
              <div className="text-sm text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap leading-relaxed">
                {text}
              </div>
            </div>

            <div className="p-6 border-t border-neutral-100 dark:border-white/5 space-y-3">
              <Button onClick={handleAccept} disabled={accepting || declining} size="lg" fullWidth>
                {accepting ? "Подтверждение..." : "Принять и продолжить"}
              </Button>

              {/* Decline */}
              {!confirmDecline ? (
                <button
                  onClick={handleDecline}
                  disabled={accepting || declining}
                  className="w-full py-2.5 rounded-xl text-sm text-neutral-500 dark:text-neutral-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/5 transition-colors disabled:opacity-50"
                >
                  Не соглашаюсь
                </button>
              ) : (
                <div className="rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/5 p-4 space-y-3">
                  <p className="text-sm text-red-600 dark:text-red-400 font-medium text-center">
                    Ваш аккаунт будет удалён без возможности восстановления
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDecline(false)}
                      className="flex-1 py-2 rounded-lg text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-white bg-neutral-100 dark:bg-white/5 hover:bg-neutral-200 dark:hover:bg-white/10 transition-colors"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={handleDecline}
                      disabled={declining}
                      className="flex-1 py-2 rounded-lg text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
                    >
                      {declining ? "Удаление..." : "Подтвердить отказ"}
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-neutral-400 dark:text-neutral-500 text-center">
                При отказе от соглашения регистрация будет отменена, данные удалены
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}