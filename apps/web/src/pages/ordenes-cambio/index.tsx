import { useState } from 'react';
import { ListaOrdenesCambio } from './lista';
import { DetalleOrdenCambio } from './detalle';
import type { OrdenCambio } from '@/hooks/use-ordenes-cambio';

export function OrdenesCambioModule() {
  const [selected, setSelected] = useState<OrdenCambio | null>(null);

  if (selected) {
    return <DetalleOrdenCambio oc={selected} onBack={() => setSelected(null)} />;
  }

  return <ListaOrdenesCambio onSelect={setSelected} />;
}
