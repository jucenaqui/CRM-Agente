import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldWrapProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  id: string;
  children: ReactNode;
}

function FieldWrap({ label, error, hint, required, id, children }: FieldWrapProps) {
  return (
    <div className={`field${error ? ' field-invalid' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <span className="field-error" id={`${id}-err`}>
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

type Base = { label: string; error?: string; hint?: string };

export function TextField({ label, error, hint, id, required, ...rest }: Base & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap label={label} error={error} hint={hint} required={required} id={fid}>
      <input
        id={fid}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fid}-err` : undefined}
        aria-required={required || undefined}
        {...rest}
      />
    </FieldWrap>
  );
}

export function SelectField({
  label,
  error,
  hint,
  id,
  required,
  children,
  ...rest
}: Base & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap label={label} error={error} hint={hint} required={required} id={fid}>
      <select id={fid} aria-invalid={error ? true : undefined} aria-describedby={error ? `${fid}-err` : undefined} {...rest}>
        {children}
      </select>
    </FieldWrap>
  );
}

export function TextAreaField({ label, error, hint, id, required, ...rest }: Base & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap label={label} error={error} hint={hint} required={required} id={fid}>
      <textarea id={fid} aria-invalid={error ? true : undefined} aria-describedby={error ? `${fid}-err` : undefined} rows={3} {...rest} />
    </FieldWrap>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Buscar…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} maxLength={100} />
    </div>
  );
}
