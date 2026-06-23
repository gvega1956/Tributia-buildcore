import { type ReactNode } from 'react';
import { Loader2, AlertCircle, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
    </div>
  );
}

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-16', className)}>
      <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
    </div>
  );
}

export function SkeletonGrid({ cols = 3, rows = 6 }: { cols?: number; rows?: number }) {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-${cols} gap-4`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-44 rounded-xl bg-slate-200/70 animate-pulse" />
      ))}
    </div>
  );
}

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = 'Ocurrió un error inesperado.', onRetry }: ErrorStateProps) {
  return (
    <div className="rounded-xl bg-rose-50 border border-rose-200 px-5 py-4 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-rose-500 mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="text-sm text-rose-700 font-medium">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 text-xs text-rose-600 underline hover:text-rose-800 font-semibold"
          >
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title = 'Sin resultados', description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center text-slate-400">
      <div className="mb-4 opacity-25">{icon ?? <Inbox size={48} />}</div>
      <p className="text-base font-semibold text-slate-500">{title}</p>
      {description && <p className="text-sm mt-1 max-w-xs text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
