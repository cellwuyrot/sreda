"use client";

import { signIn } from "next-auth/react";
import { alertDialog } from "@/components/ui/ConfirmDialog";
import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAndroidShell, resolveAuthRedirect } from "@/lib/shell";
import { isDesktop } from "@/lib/desktop";
import { motion } from "framer-motion";
import Link from "next/link";

type Step = "form" | "verify" | "reset-password";
type AuthType = "login" | "register";

function CodeInput({
  length,
  value,
  onChange,
}: {
  length: number;
  value: string;
  onChange: (val: string) => void;
}) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  const handleChange = (idx: number, char: string) => {
    if (!/^\d?$/.test(char)) return;
    const arr = value.split("");
    arr[idx] = char;
    const next = arr.join("").slice(0, length);
    onChange(next);
    if (char && idx < length - 1) {
      inputsRef.current[idx + 1]?.focus();
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !value[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    onChange(pasted);
    const focusIdx = Math.min(pasted.length, length - 1);
    inputsRef.current[focusIdx]?.focus();
  };

  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { inputsRef.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className="w-12 h-14 text-center text-2xl font-bold rounded-xl border-2 
            border-neutral-200 dark:border-white/10 bg-neutral-50 dark:bg-neutral-800
            text-neutral-900 dark:text-white
            focus:border-violet-500 dark:focus:border-cyan-400 focus:outline-none
            transition-colors"
        />
      ))}
    </div>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  /* Куда идти после входа. Внутри оболочек (Android, десктоп) это всегда
     `/connect`: лендинга там нет, и человек, только что зарегистрировавшийся,
     попадал на главный экран сайта и искал вход в мессенджер сам. Заодно здесь
     отсекается чужой адрес из `?callbackUrl` — см. lib/shell. */
  const callbackUrl = resolveAuthRedirect(
    searchParams.get("callbackUrl"),
    isAndroidShell() || isDesktop(),
  );
  const [authType, setAuthType] = useState<AuthType>("login");
  const [step, setStep] = useState<Step>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [newPassword, setNewPassword] = useState("");
  const [resetStep, setResetStep] = useState<"email" | "code" | "newpass">("email");
  /* FIX-RESET: маскированная почта из ответа сервера — код всегда уходит на
     привязанную к аккаунту почту, даже если пользователь ввёл логин. */
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleLogin = async () => {
    setError("");
    if (!email || !password) {
      setError("Введите email/username и пароль");
      return;
    }
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError("Неверный логин или пароль");
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setError("Произошла ошибка");
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    setError("");
    if (!email) {
      setError("Введите email или логин");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type: "reset" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка отправки кода");
        setLoading(false);
        return;
      }
      setResetTarget(typeof data.target === "string" ? data.target : null);
      setResetStep("code");
      setCode("");
      setCountdown(60);
    } catch {
      setError("Произошла ошибка");
    }
    setLoading(false);
  };

  const handleResetPassword = async () => {
    setError("");
    if (!newPassword || newPassword.length < 8) {
      setError("Пароль должен содержать минимум 8 символов");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка сброса пароля");
        setLoading(false);
        return;
      }
      setStep("form");
      setResetStep("email");
      setPassword("");
      setCode("");
      setNewPassword("");
      setError("");
      await alertDialog({ title: "Готово", message: "Пароль успешно изменён! Войдите с новым паролем." });
    } catch {
      setError("Произошла ошибка");
    }
    setLoading(false);
  };

  const sendCode = async () => {
    setError("");
    setLoading(true);

    try {
      if (!email || !name || !username || !password) {
        setError("Заполните все поля");
        setLoading(false);
        return;
      }
      if (!/^[a-zA-Z0-9_]{6,20}$/.test(username)) {
        setError("Логин: 6-20 символов, только латиница, цифры и _");
        setLoading(false);
        return;
      }
      if (!/\d/.test(username)) {
        setError("Логин должен содержать хотя бы одну цифру");
        setLoading(false);
        return;
      }
      if (password.length < 8) {
        setError("Пароль должен быть не короче 8 символов");
        setLoading(false);
        return;
      }

      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, type: "register" }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Ошибка отправки кода");
        setLoading(false);
        return;
      }

      setStep("verify");
      setCode("");
      setCountdown(60);
    } catch {
      setError("Произошла ошибка");
    }
    setLoading(false);
  };

  const verifyAndAuth = async () => {
    setError("");
    setLoading(true);

    try {
      const verifyRes = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, type: "register" }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        setError(verifyData.error || "Неверный код");
        setLoading(false);
        return;
      }

      const regRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name, username, verificationCode: code }),
      });

      const regData = await regRes.json();
      if (!regRes.ok) {
        setError(regData.error || "Ошибка регистрации");
        setLoading(false);
        return;
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Ошибка входа");
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setError("Произошла ошибка");
    }
    setLoading(false);
  };

  const resendCode = async () => {
    if (countdown > 0) return;
    await sendCode();
  };

  useEffect(() => {
    if (code.length === 6 && step === "verify") {
      verifyAndAuth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div className="min-h-screen max-md:min-h-[100dvh] flex items-center justify-center px-4 max-md:py-[max(1rem,env(safe-area-inset-top))] max-md:pb-[max(1rem,env(safe-area-inset-bottom))] bg-neutral-50 dark:bg-neutral-950">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-violet-400/5 dark:bg-cyan-400/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/3 right-1/3 w-96 h-96 bg-indigo-400/5 dark:bg-fantasy-purple/5 rounded-full blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6 }}
        className="bg-white dark:bg-neutral-900/80 backdrop-blur-xl border border-neutral-200 dark:border-white/10 rounded-2xl p-8 max-md:p-6 w-full max-w-md relative shadow-xl"
      >
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-indigo-600 dark:from-cyan-400 dark:to-fantasy-purple rounded-xl flex items-center justify-center">
              <span className="text-white font-bold">TZ</span>
            </div>
          </Link>

          {step === "form" ? (
            <>
              <h1 className="text-2xl font-display font-bold text-neutral-900 dark:text-white">
                {authType === "register" ? "Регистрация" : "Вход в TrioZ"}
              </h1>
              <p className="text-neutral-500 dark:text-gray-400 text-sm mt-1">
                {authType === "register"
                  ? "Создайте аккаунт — код подтверждения придёт на email"
                  : "Введите email/username и пароль"}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-display font-bold text-neutral-900 dark:text-white">
                Введите код
              </h1>
              <p className="text-neutral-500 dark:text-gray-400 text-sm mt-1">
                Отправлен на <span className="text-accent">{email}</span>
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {step === "form" ? (
          <>
            <div className="space-y-4">
              {authType === "register" && (
                <>
                  <div>
                    <label className="block text-sm text-neutral-600 dark:text-gray-400 mb-1">Имя</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="input-field"
                      placeholder="Ваше имя"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-neutral-600 dark:text-gray-400 mb-1">Юзернейм</label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="input-field"
                      placeholder="my_username"
                      pattern="[a-zA-Z0-9_]{6,20}"
                      title="6-20 символов: латиница, цифры и _, минимум одна цифра"
                      required
                    />
                  </div>
                </>
              )}
              <div>
                <label className="block text-sm text-neutral-600 dark:text-gray-400 mb-1">
                  {authType === "register" ? "Email" : "Email или Username"}
                </label>
                <input
                  type={authType === "register" ? "email" : "text"}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  placeholder={authType === "register" ? "email@example.com" : "email или username"}
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-600 dark:text-gray-400 mb-1">Пароль</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { if (authType === "login") { handleLogin(); } else { sendCode(); } } }}
                    className="input-field w-full pr-10"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-gray-300 transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.879L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              {authType === "login" && (
                <div className="text-right -mt-2">
                  <button
                    type="button"
                    onClick={() => { setStep("reset-password"); setResetStep("email"); setError(""); setCode(""); setNewPassword(""); }}
                    className="text-xs text-accent hover:text-violet-500 dark:hover:text-cyan-300 transition-colors"
                  >
                    Забыли пароль?
                  </button>
                </div>
              )}

              <button
                onClick={authType === "login" ? handleLogin : sendCode}
                disabled={loading}
                className="btn-primary w-full min-h-[46px] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading
                  ? (authType === "login" ? "Вход..." : "Отправка...")
                  : (authType === "login" ? "Войти" : "Получить код на email")}
              </button>
            </div>

            <div className="mt-6 text-center">
              <button
                onClick={() => {
                  setAuthType(authType === "login" ? "register" : "login");
                  setError("");
                  setStep("form");
                }}
                className="text-sm text-accent hover:text-violet-500 dark:hover:text-cyan-300 transition-colors"
              >
                {authType === "register" ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-6">
              <CodeInput length={6} value={code} onChange={setCode} />

              {loading && (
                <p className="text-center text-sm text-neutral-500 dark:text-gray-400">
                  Проверка кода...
                </p>
              )}

              <div className="text-center">
                <button
                  onClick={resendCode}
                  disabled={countdown > 0}
                  className="text-sm text-accent hover:text-violet-500 dark:hover:text-cyan-300 transition-colors disabled:text-neutral-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed"
                >
                  {countdown > 0
                    ? `Отправить повторно (${countdown}с)`
                    : "Отправить код повторно"}
                </button>
              </div>

              <button
                onClick={() => {
                  setStep("form");
                  setCode("");
                  setError("");
                }}
                className="w-full text-sm text-neutral-500 dark:text-gray-400 hover:text-neutral-700 dark:hover:text-gray-200 transition-colors text-center py-2"
              >
                ← Назад
              </button>
            </div>
          </>
        )}
        {step === "reset-password" && (
          <>
            <div className="text-center mb-6">
              <h1 className="text-2xl font-display font-bold text-neutral-900 dark:text-white">
                Сброс пароля
              </h1>
              <p className="text-neutral-500 dark:text-gray-400 text-sm mt-1">
                {resetStep === "email" && "Введите email или логин — код придёт на привязанную почту"}
                {resetStep === "code" && <>Код отправлен на <span className="text-accent">{resetTarget ?? email}</span></>}
                {resetStep === "newpass" && "Введите новый пароль"}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-xl text-red-600 dark:text-red-400 text-sm text-center">
                {error}
              </div>
            )}

            <div className="space-y-4">
              {resetStep === "email" && (
                <>
                  <div>
                    <label className="block text-sm text-neutral-600 dark:text-gray-400 mb-1">Email или логин</label>
                    <input
                      type="text"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleForgotPassword(); }}
                      className="input-field"
                      placeholder="email@example.com или username"
                      required
                    />
                  </div>
                  <button
                    onClick={handleForgotPassword}
                    disabled={loading}
                    className="btn-primary w-full min-h-[46px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "Отправка..." : "Отправить код"}
                  </button>
                </>
              )}

              {resetStep === "code" && (
                <>
                  <CodeInput length={6} value={code} onChange={(val) => {
                    setCode(val);
                    if (val.length === 6) {
                      setResetStep("newpass");
                    }
                  }} />
                  <div className="text-center">
                    <button
                      onClick={handleForgotPassword}
                      disabled={countdown > 0}
                      className="text-sm text-accent hover:text-violet-500 dark:hover:text-cyan-300 transition-colors disabled:text-neutral-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed"
                    >
                      {countdown > 0 ? `Отправить повторно (${countdown}с)` : "Отправить код повторно"}
                    </button>
                  </div>
                </>
              )}

              {resetStep === "newpass" && (
                <>
                  <div>
                    <label className="block text-sm text-neutral-600 dark:text-gray-400 mb-1">Новый пароль</label>
                    <div className="relative">
                      <input
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleResetPassword(); }}
                        className="input-field w-full pr-10"
                        placeholder="Минимум 8 символов"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-gray-300 transition-colors"
                        tabIndex={-1}
                      >
                        {showNewPassword ? (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.879L21 21" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={handleResetPassword}
                    disabled={loading}
                    className="btn-primary w-full min-h-[46px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "Сохранение..." : "Сохранить новый пароль"}
                  </button>
                </>
              )}

              <button
                onClick={() => { setStep("form"); setError(""); setResetStep("email"); }}
                className="w-full text-sm text-neutral-500 dark:text-gray-400 hover:text-neutral-700 dark:hover:text-gray-200 transition-colors text-center py-2"
              >
                ← Назад к входу
              </button>
            </div>
          </>
        )}
          </motion.div>

    </div>
  );
}