import { forwardRef, type InputHTMLAttributes } from "react";

type InputProps = InputHTMLAttributes<HTMLInputElement>;

/** Themed text input primitive built on the shared `.input-field` style. */
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = "", ...rest },
  ref,
) {
  return <input ref={ref} className={`input-field ${className}`} {...rest} />;
});

export default Input;
