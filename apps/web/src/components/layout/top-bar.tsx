import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, FolderKanban, ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store/app';
import { getApiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

interface EmpresaItem {
  id: string;
  nombre: string;
  rnc: string;
}

interface ProyectoItem {
  id: string;
  nombre: string;
  codigo: string;
  estado: string;
}

function useEmpresas() {
  return useQuery({
    queryKey: ['empresas'],
    queryFn: async () => {
      const api = getApiClient();
      // El endpoint de empresas se habilita en Sesión 3 (catálogos/administración).
      // Por ahora devuelve vacío silenciosamente si no existe.
      const { data } = await api.GET('/api/v1/catalogos/empresas' as never).catch(() => ({ data: [] }));
      return (data as EmpresaItem[]) ?? [];
    },
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}

function useProyectos(empresaId: string | undefined) {
  return useQuery({
    queryKey: ['proyectos', empresaId],
    queryFn: async () => {
      const api = getApiClient();
      const { data, error } = await api.GET('/api/v1/proyectos' as never);
      if (error) throw new Error('Error cargando proyectos');
      return (data as ProyectoItem[]) ?? [];
    },
    enabled: !!empresaId,
    staleTime: 1000 * 60,
  });
}

export function TopBar() {
  const { empresaActiva, proyectoActivo, setEmpresaActiva, setProyectoActivo } = useAppStore();
  const { data: empresas = [] } = useEmpresas();
  const { data: proyectos = [] } = useProyectos(empresaActiva?.id);

  // Auto-seleccionar primera empresa si solo hay una
  useEffect(() => {
    if (!empresaActiva && empresas.length === 1 && empresas[0]) {
      setEmpresaActiva(empresas[0]);
    }
  }, [empresas, empresaActiva, setEmpresaActiva]);

  return (
    <header className="h-14 border-b border-gray-200 bg-white flex items-center px-6 gap-4 shrink-0">
      {/* Selector empresa */}
      <div className="flex items-center gap-2">
        <Building2 size={15} className="text-gray-400 shrink-0" />
        <select
          value={empresaActiva?.id ?? ''}
          onChange={(e) => {
            const emp = empresas.find((x) => x.id === e.target.value);
            setEmpresaActiva(emp ?? null);
          }}
          className={cn(
            'text-sm border-0 bg-transparent pr-6 focus:outline-none focus:ring-0 cursor-pointer',
            !empresaActiva && 'text-gray-400',
          )}
        >
          <option value="" disabled>Empresa…</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nombre}</option>
          ))}
        </select>
        <ChevronDown size={13} className="text-gray-400 -ml-4 pointer-events-none" />
      </div>

      <span className="text-gray-200">|</span>

      {/* Selector proyecto */}
      <div className="flex items-center gap-2">
        <FolderKanban size={15} className="text-gray-400 shrink-0" />
        <select
          value={proyectoActivo?.id ?? ''}
          onChange={(e) => {
            const proj = proyectos.find((x) => x.id === e.target.value);
            setProyectoActivo(proj ?? null);
          }}
          disabled={!empresaActiva}
          className={cn(
            'text-sm border-0 bg-transparent pr-6 focus:outline-none focus:ring-0',
            !proyectoActivo ? 'text-gray-400' : 'text-gray-900',
            !empresaActiva && 'cursor-not-allowed opacity-50',
            empresaActiva && 'cursor-pointer',
          )}
        >
          <option value="">Todos los proyectos</option>
          {proyectos.map((p) => (
            <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>
          ))}
        </select>
        <ChevronDown size={13} className="text-gray-400 -ml-4 pointer-events-none" />
      </div>

      <div className="ml-auto" />
    </header>
  );
}
