"use client";

import { useEffect, useRef, useState } from "react";

// Input de dinero estilo POS: el usuario solo escribe digitos (sin punto) y
// el valor se acomoda solo de centavos hacia la izquierda (1 -> 0.01, 12 ->
// 0.12, 123 -> 1.23, ...). Backspace corre en reversa. value/onChange son
// siempre dolares (number), el manejo de centavos es interno.
interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> {
  value: number;
  onChange: (value: number) => void;
}

const centsToDisplay = (cents: number) => {
  const whole = Math.floor(cents / 100);
  const dec = String(cents % 100).padStart(2, "0");
  return `${whole.toLocaleString("en-US")}.${dec}`;
};

export function MoneyInput({ value, onChange, placeholder = "0.00", onFocus, onBlur, ...rest }: MoneyInputProps) {
  const [cents, setCents] = useState(() => Math.max(0, Math.round((value || 0) * 100)));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setCents(Math.max(0, Math.round((value || 0) * 100)));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      {...rest}
      value={centsToDisplay(cents)}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        onBlur?.(e);
      }}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "");
        const next = digits ? Number(digits) : 0;
        setCents(next);
        onChange(next / 100);
      }}
    />
  );
}
