import { forwardRef, useEffect, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { cn } from '@/lib/utils';

type Currency = 'DOP' | 'USD';

interface MoneyInputProps {
  value?: string;          // valor canónico como string Decimal (ej: "12500.50")
  onChange?: (value: string) => void;
  currency?: Currency;
  onCurrencyChange?: (currency: Currency) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
}

const currencySymbol: Record<Currency, string> = {
  DOP: 'RD$',
  USD: 'US$',
};

/** Formatea un Decimal para mostrar en el input */
function formatDisplay(dec: Decimal): string {
  return dec.toDecimalPlaces(2).toFixed(2);
}

/**
 * Input de dinero que usa decimal.js internamente.
 * Recibe y emite el valor como string ("12500.50") para mantener precisión exacta.
 * Muestra el símbolo de moneda y permite cambiarla.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(
  (
    {
      value = '0.00',
      onChange,
      currency = 'DOP',
      onCurrencyChange,
      placeholder = '0.00',
      disabled = false,
      className,
      id,
      name,
    },
    ref,
  ) => {
    const [display, setDisplay] = useState(() => {
      try { return formatDisplay(new Decimal(value)); }
      catch { return '0.00'; }
    });
    const isFocused = useRef(false);

    useEffect(() => {
      if (isFocused.current) return;
      try { setDisplay(formatDisplay(new Decimal(value))); }
      catch { /* valor inválido, no actualizar */ }
    }, [value]);

    function handleFocus() {
      isFocused.current = true;
      // Al enfocar, mostrar sin ceros trailing para facilitar edición
      try {
        const dec = new Decimal(value);
        setDisplay(dec.isZero() ? '' : dec.toDecimalPlaces(2).toString());
      } catch { setDisplay(''); }
    }

    function handleBlur() {
      isFocused.current = false;
      try {
        const dec = new Decimal(display === '' ? '0' : display);
        const formatted = formatDisplay(dec);
        setDisplay(formatted);
        onChange?.(dec.toFixed(4)); // emite con 4 decimales (NUMERIC(18,4))
      } catch {
        setDisplay('0.00');
        onChange?.('0.0000');
      }
    }

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.');
      setDisplay(raw);
    }

    return (
      <div className={cn('flex h-10 rounded-lg border border-gray-300 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-transparent', disabled && 'opacity-50 cursor-not-allowed', className)}>
        {/* Símbolo de moneda */}
        {onCurrencyChange ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onCurrencyChange(currency === 'DOP' ? 'USD' : 'DOP')}
            className="px-3 text-xs font-semibold text-gray-500 bg-gray-50 border-r border-gray-200 hover:bg-gray-100 transition-colors shrink-0"
            title="Cambiar moneda"
          >
            {currencySymbol[currency]}
          </button>
        ) : (
          <span className="px-3 flex items-center text-xs font-semibold text-gray-500 bg-gray-50 border-r border-gray-200 shrink-0">
            {currencySymbol[currency]}
          </span>
        )}

        {/* Input numérico */}
        <input
          ref={ref}
          id={id}
          name={name}
          type="text"
          inputMode="decimal"
          value={display}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={handleChange}
          className="flex-1 px-3 py-2 text-sm text-right tabular-nums bg-transparent focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
    );
  },
);
MoneyInput.displayName = 'MoneyInput';
