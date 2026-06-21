import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, ChevronRight, Calendar, Building2 } from 'lucide-react';
import { getApiClient } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';

interface Proyecto {
  id: string;
  nombre: string;
  codigo: string;
  estado: string;
  tipoObra: string;
  fechaInicioPlanificada: string | null;
  fechaFinPlanificada: string | null;
  descripcion: string | null;
}

const estadoBadge: Record<string, 'default' | 'info' | 'success' | 'warning' | 'danger'> = {
  PROSPECTO:    'default',
  LICITACION:   'info',
  ADJUDICADO:   'info',
  EN_EJECUCION: 'success',
  CIERRE:       'warning',
  GARANTIA:     'warning',
  CERRADO:      'default',
};

const estadoLabel: Record<string, string> = {
  PROSPECTO:    'Prospecto',
  LICITACION:   'Licitación',
  ADJUDICADO:   'Adjudicado',
  EN_EJECUCION: 'En ejecución',
  CIERRE:       'Cierre',
  GARANTIA:     'Garantía',
  CERRADO:      'Cerrado',
};

function useProyectosList() {
  return useQuery({
    queryKey: ['proyectos-list'],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/proyectos');
      if (error) throw new Error('Error cargando proyectos');
      return (data as Proyecto[]) ?? [];
    },
  });
}

export function ProyectosPage() {
  const { data: proyectos = [], isLoading, error, refetch } = useProyectosList();

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proyectos</h1>
          <p className="text-gray-500 text-sm mt-1">
            {isLoading ? '…' : `${proyectos.length} proyecto${proyectos.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Button size="md">
          <Plus size={16} className="mr-2" />
          Nuevo proyecto
        </Button>
      </div>

      {error && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Error cargando proyectos'}
          onRetry={() => refetch()}
        />
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : proyectos.length === 0 ? (
        <EmptyState
          icon={<Building2 size={48} />}
          title="Sin proyectos aún"
          description="Crea el primer proyecto para comenzar."
          action={
            <Button size="sm">
              <Plus size={14} className="mr-1.5" /> Nuevo proyecto
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {proyectos.map((p) => (
            <Link key={p.id} to={`/proyectos/${p.id}/tablero`}>
              <Card className="h-full hover:shadow-md hover:border-brand-300 transition-all cursor-pointer group">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between mb-3">
                    <Badge variant={estadoBadge[p.estado] ?? 'default'}>
                      {estadoLabel[p.estado] ?? p.estado}
                    </Badge>
                    <ChevronRight
                      size={16}
                      className="text-gray-300 group-hover:text-brand-500 transition-colors"
                    />
                  </div>
                  <p className="text-xs font-mono text-gray-400 mb-1">{p.codigo}</p>
                  <h3 className="font-semibold text-gray-900 text-base leading-snug mb-3">
                    {p.nombre}
                  </h3>
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <span className="inline-block bg-gray-100 rounded px-2 py-0.5">{p.tipoObra}</span>
                    {p.fechaFinPlanificada && (
                      <>
                        <Calendar size={12} />
                        <span>
                          Fin{' '}
                          {new Date(p.fechaFinPlanificada).toLocaleDateString('es-DO', {
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
