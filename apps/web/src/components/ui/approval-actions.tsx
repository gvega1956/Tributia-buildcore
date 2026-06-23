import { CheckCircle, XCircle, Send, AlertTriangle } from 'lucide-react';
import { Button } from './button';
import { Badge } from './badge';

type ApprovalVariant = 'success' | 'danger' | 'warning' | 'info' | 'default';

interface ApprovalState {
  label: string;
  badge: ApprovalVariant;
}

interface ApprovalActionsProps {
  /** Estado actual del registro */
  estadoLabel: string;
  estadoBadge: ApprovalVariant;
  /** Acción disponible según el estado */
  canEnviar?: boolean;
  canAprobar?: boolean;
  canRechazar?: boolean;
  canAnular?: boolean;
  isPending?: boolean;
  onEnviar?: () => void;
  onAprobar?: () => void;
  onRechazar?: () => void;
  onAnular?: () => void;
  /** Mensaje de la Regla de Oro (si aplica) */
  alertaReglaOro?: string;
}

/**
 * Bandeja de aprobación genérica reutilizable.
 * Muestra el estado actual y los botones de acción disponibles según el flujo.
 * Usada en Compras (OC) y Órdenes de Cambio.
 */
export function ApprovalActions({
  estadoLabel,
  estadoBadge,
  canEnviar,
  canAprobar,
  canRechazar,
  canAnular,
  isPending,
  onEnviar,
  onAprobar,
  onRechazar,
  onAnular,
  alertaReglaOro,
}: ApprovalActionsProps) {
  const hasActions = canEnviar || canAprobar || canRechazar || canAnular;

  return (
    <div className="space-y-3">
      {/* Alerta Regla de Oro */}
      {alertaReglaOro && (
        <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={16} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 font-medium">{alertaReglaOro}</p>
        </div>
      )}

      {/* Panel de estado y acciones */}
      <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-xl">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Estado:</span>
          <Badge variant={estadoBadge}>{estadoLabel}</Badge>
        </div>

        {hasActions && (
          <div className="flex gap-2">
            {canEnviar && (
              <Button
                size="sm"
                variant="outline"
                onClick={onEnviar}
                disabled={isPending}
              >
                <Send size={13} className="mr-1.5" />
                Enviar al cliente
              </Button>
            )}
            {canAprobar && (
              <Button
                size="sm"
                onClick={onAprobar}
                disabled={isPending}
              >
                <CheckCircle size={13} className="mr-1.5" />
                {isPending ? 'Procesando…' : 'Aprobar'}
              </Button>
            )}
            {canRechazar && (
              <Button
                size="sm"
                variant="destructive"
                onClick={onRechazar}
                disabled={isPending}
              >
                <XCircle size={13} className="mr-1.5" />
                Rechazar
              </Button>
            )}
            {canAnular && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onAnular}
                disabled={isPending}
                className="text-gray-500 hover:text-red-600"
              >
                Anular
              </Button>
            )}
          </div>
        )}

        {!hasActions && (
          <span className="text-xs text-gray-400">Sin acciones disponibles</span>
        )}
      </div>
    </div>
  );
}
