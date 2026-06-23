import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type CardVariant = 'default' | 'elevated' | 'dark';
type CardAccent  = 'brand' | 'amber' | 'sky' | 'emerald' | 'rose' | 'slate';

const ACCENT_BORDER: Record<CardAccent, string> = {
  brand:   'border-l-brand-500',
  amber:   'border-l-amber-500',
  sky:     'border-l-sky-500',
  emerald: 'border-l-emerald-500',
  rose:    'border-l-rose-500',
  slate:   'border-l-slate-300',
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  accent?: CardAccent;
}

export function Card({ className, variant = 'default', accent, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border',
        variant === 'default'  && 'bg-white border-slate-200 shadow-card',
        variant === 'elevated' && 'bg-white border-slate-200 shadow-card-md',
        variant === 'dark'     && 'bg-slate-950 border-slate-800 shadow-card-lg text-white',
        accent && 'border-l-4',
        accent && ACCENT_BORDER[accent],
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pb-2', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-[10px] font-bold text-slate-400 uppercase tracking-[0.12em]', className)}
      {...props}
    />
  );
}

export function CardValue({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-5 pb-2 text-3xl font-extrabold text-slate-900 num', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}
