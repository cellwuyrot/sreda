"use client";

/**
 * FIX-DM-COPY: граница ошибок для ленты сообщений.
 *
 * Одно исключение при отрисовке одного сообщения сносило всю переписку: React
 * без границы ошибок размонтирует всё дерево целиком — человек видит пустой
 * экран и теряет контекст разговора. Причина конкретного вылета устранена
 * отдельно (нет больше обращения к `content` без проверки на null), но цена
 * любой будущей ошибки в одной строке не должна быть такой высокой.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Смена этого значения (например, беседы) сбрасывает состояние ошибки. */
  resetKey?: string | null;
  label?: string;
}

interface State {
  error: Error | null;
}

export default class ChatErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // В консоль — чтобы причина не терялась вместе с упавшим деревом.
    console.error("[chat] ошибка отрисовки ленты", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="m-4 rounded-xl border border-amber-300/60 dark:border-amber-400/20 bg-amber-50 dark:bg-amber-400/10 p-4 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-medium">{this.props.label || "Не удалось показать сообщения"}</p>
          <p className="mt-1 text-xs opacity-80">
            Сама переписка цела — обновите страницу или откройте беседу заново.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-2 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium hover:bg-amber-500/30"
          >
            Показать снова
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
