"use client";

import { useEffect, useRef, useState } from "react";

// Input de cantidad. El anterior hacia `parseInt(e.target.value) || 1` en cada
// teclazo, asi que el campo nunca lograba quedar vacio: al borrar el 1 volvia a
// aparecer solo y el cursor quedaba detras de el, obligando a mover el cursor a
// la derecha para poder escribir. Aqui el texto visible es estado propio, se
// deja vaciar mientras se escribe, y el minimo se aplica recien al salir del
// campo. Va con type="text" + inputMode numerico: el type="number" nativo
// tambien acepta "e", "+" y "-", y salta el cursor al reescribirle el valor.
interface QtyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode" | "min"> {
  value: number;
  onChange: (value: number) => void;
  min?: number;
}

export function QtyInput({ value, onChange, min = 1, onFocus, onBlur, ...rest }: QtyInputProps) {
  const [text, setText] = useState(() => String(value ?? min));
  const focused = useRef(false);

  // Mientras el campo tiene el foco manda lo que el usuario escribio; fuera de
  // foco se re-sincroniza con el valor del padre.
  useEffect(() => {
    if (!focused.current) setText(String(value ?? min));
  }, [value, min]);

  return (
    <input
      type="text"
      inputMode="numeric"
      {...rest}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        const n = parseInt(text, 10);
        const next = Number.isFinite(n) && n >= min ? n : min;
        setText(String(next));
        if (next !== value) onChange(next);
        onBlur?.(e);
      }}
      onChange={(e) => {
        // Solo digitos: sin signos ni notacion cientifica.
        const digits = e.target.value.replace(/\D/g, "");
        setText(digits);
        const n = parseInt(digits, 10);
        onChange(Number.isFinite(n) ? n : 0);
      }}
    />
  );
}
