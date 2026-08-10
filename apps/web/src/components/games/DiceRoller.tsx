"use client";

import { useState, useCallback, useRef, useEffect } from "react";

const DOT_MAP: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

function Die({ value, spinning }: { value: number; spinning: boolean }) {
  const activeDots = DOT_MAP[value] || [];
  return (
    <div
      className={`w-[76px] h-[76px] rounded-[13px] bg-[#272727] border border-[#444] grid grid-cols-3 grid-rows-3 p-[9px] gap-[3px] ${
        spinning ? "animate-dice-shake" : ""
      }`}
    >
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
        <div
          key={i}
          className={`w-full h-full rounded-full transition-opacity duration-100 ${
            activeDots.includes(i) ? "bg-[#e8e8e8] opacity-100" : "bg-[#e8e8e8] opacity-0"
          }`}
        />
      ))}
    </div>
  );
}

interface DiceRollerProps {
  onResult: (die1: number, die2: number, sum: number) => void;
  autoRoll?: boolean;
  disabled?: boolean;
}

export default function DiceRoller({ onResult, autoRoll = false, disabled = false }: DiceRollerProps) {
  const [die1, setDie1] = useState(0);
  const [die2, setDie2] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const resultCalled = useRef(false);

  const roll = useCallback(() => {
    if (spinning || disabled) return;
    setSpinning(true);
    setShowValues(false);
    resultCalled.current = false;

    // Random face animation
    const interval = setInterval(() => {
      setDie1(Math.floor(Math.random() * 6) + 1);
      setDie2(Math.floor(Math.random() * 6) + 1);
    }, 75);

    setTimeout(() => {
      clearInterval(interval);
      const v1 = Math.floor(Math.random() * 6) + 1;
      const v2 = Math.floor(Math.random() * 6) + 1;
      setDie1(v1);
      setDie2(v2);
      setSpinning(false);
      setShowValues(true);
      if (!resultCalled.current) {
        resultCalled.current = true;
        onResult(v1, v2, v1 + v2);
      }
    }, 660);
  }, [spinning, disabled, onResult]);

  useEffect(() => {
    if (autoRoll && !spinning && !showValues) {
      const timer = setTimeout(roll, 500);
      return () => clearTimeout(timer);
    }
  }, [autoRoll, spinning, showValues, roll]);

  const sum = die1 + die2;

  return (
    <div className="inline-flex flex-col items-center gap-4 p-5 bg-[#1e1e1e] border border-[#333] rounded-2xl">
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-1.5">
          <Die value={die1 || 1} spinning={spinning} />
          <span className={`text-2xl font-semibold text-[#e8e8e8] min-w-[1.4ch] text-center transition-opacity ${showValues ? "" : "opacity-0"}`}>
            {die1 || "—"}
          </span>
        </div>
        <span className="text-xl text-[#bbb] pb-8">+</span>
        <div className="flex flex-col items-center gap-1.5">
          <Die value={die2 || 1} spinning={spinning} />
          <span className={`text-2xl font-semibold text-[#e8e8e8] min-w-[1.4ch] text-center transition-opacity ${showValues ? "" : "opacity-0"}`}>
            {die2 || "—"}
          </span>
        </div>
      </div>
      <div className="bg-[#272727] rounded-[10px] px-7 py-2 flex flex-col items-center gap-px">
        <span className="text-[10px] text-[#666] uppercase tracking-wider">Сумма</span>
        <span className={`text-4xl font-bold text-[#e8e8e8] transition-opacity ${showValues ? "" : "opacity-0"}`}>
          {showValues ? sum : "—"}
        </span>
      </div>
      {!autoRoll && (
        <button
          onClick={roll}
          disabled={spinning || disabled}
          className="text-sm px-7 py-2 rounded-lg border border-[#444] bg-transparent text-[#e8e8e8] hover:bg-[#2e2e2e] active:scale-[.97] transition-all disabled:opacity-35 disabled:cursor-not-allowed"
        >
          Бросить
        </button>
      )}
    </div>
  );
}
