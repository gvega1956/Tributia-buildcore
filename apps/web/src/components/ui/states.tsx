import { type ReactNode } from 'react';
import { Loader2, AlertCircle, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Pantalla completa de carga — se usa en ProtectedRoute mientras se restaura la sesión */
export function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Loader2 className="w-8 h-8 animate-spin text-brand-500" />
    </div>
  );
}

/** Spinner inline para áreas de contenido */
export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-16', className)}>
      <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
    </div>
  );
}

/** Esqueletos de carga para grillas */
export function SkeletonGrid({ cols = 3, rows = 6 }: { cols?: number; rows?: number }) {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-${cols} gap-4`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-44 rounded-xl bg-gray-100 animate-pulse" />
      ))}
    </div>
  );
}

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

/** Estado de error con mensaje y botón opcional de reintentar */
export function ErrorState({ message = 'Ocurrió un error inesperado.', onRetry }: ErrorStateProps) {
  return (
    <div className="rounded-lg bg-red-50 border border-red-200 px-5 py-4 flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="text-sm text-red-700">{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 text-xs text-red-600 underline hover:text-red-800"
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

/** Estado vacío estándar */
export function EmptyState({
  title = 'Sin resultados',
  description,
  icon,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center text-gray-400">
      <div className="mb-4 opacity-30">{icon ?? <Inbox size={48} />}</div>
      <p className="text-lg font-medium text-gray-500">{title}</p>
      {description && <p className="text-sm mt-1 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
