"use client";
import { useId } from "react";
import type { AgeDeclaration } from "@/lib/age-declaration";

export function AgeDeclarationFields({ value, onChange, disabled = false }: {
  value: AgeDeclaration;
  onChange: (value: AgeDeclaration) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return <fieldset className="age-fieldset" disabled={disabled}>
    <legend className="age-legend">Age confirmation · 18+</legend>
    <p id={`${id}-help`} className="age-help">This is your own declaration, not identity or document verification. Your date of birth is checked once and is not saved; we retain only the confirmation time and policy version.</p>
    <label className="age-field-label" htmlFor={`${id}-birth`}>Date of birth</label>
    <input id={`${id}-birth`} name="birthDate" type="date" autoComplete="off" required
      aria-describedby={`${id}-help`} value={value.birthDate}
      onChange={(event) => onChange({ ...value, birthDate: event.target.value })} />
    <label className="age-checkbox">
      <input type="checkbox" required checked={value.confirmed}
        onChange={(event) => onChange({ ...value, confirmed: event.target.checked })} />
      <span>I confirm that this is my date of birth and I am at least 18 years old.</span>
    </label>
  </fieldset>;
}
