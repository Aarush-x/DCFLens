import type { InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string };

export function Input({ className = "", id, label, ...props }: InputProps) {
  if (!id) {
    throw new Error("Input requires an id so its visible label can be associated.");
  }

  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={id}>{label}</label>
      <input className="field__control financial-value" id={id} {...props} />
    </div>
  );
}
