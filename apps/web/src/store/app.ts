import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Empresa {
  id: string;
  nombre: string;
  rnc: string;
}

interface Proyecto {
  id: string;
  nombre: string;
  codigo: string;
}

interface AppStore {
  empresaActiva: Empresa | null;
  proyectoActivo: Proyecto | null;
  setEmpresaActiva: (empresa: Empresa | null) => void;
  setProyectoActivo: (proyecto: Proyecto | null) => void;
  reset: () => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      empresaActiva: null,
      proyectoActivo: null,
      setEmpresaActiva: (empresa) => set({ empresaActiva: empresa, proyectoActivo: null }),
      setProyectoActivo: (proyecto) => set({ proyectoActivo: proyecto }),
      reset: () => set({ empresaActiva: null, proyectoActivo: null }),
    }),
    {
      name: 'tributia-app-store',
      partialize: (state) => ({
        empresaActiva: state.empresaActiva,
        proyectoActivo: state.proyectoActivo,
      }),
    },
  ),
);
