import { useState } from 'react';

const API_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3000';

async function downloadPdf(path: string, filename: string): Promise<void> {
  const token = localStorage.getItem('tributia_access_token');
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Error ${res.status} al generar el PDF`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function useDescargarOrdenCompraPdf() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const descargar = async (id: string) => {
    setIsPending(true);
    setError(null);
    try {
      await downloadPdf(`/api/v1/documentos/orden-compra/${id}/pdf`, `OC-${id}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsPending(false);
    }
  };

  return { descargar, isPending, error };
}

export function useDescargarCubicacionPdf() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const descargar = async (id: string) => {
    setIsPending(true);
    setError(null);
    try {
      await downloadPdf(`/api/v1/documentos/cubicacion/${id}/pdf`, `Cubicacion-${id}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsPending(false);
    }
  };

  return { descargar, isPending, error };
}

export function useDescargarFacturaClientePdf() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const descargar = async (id: string) => {
    setIsPending(true);
    setError(null);
    try {
      await downloadPdf(`/api/v1/documentos/factura-cliente/${id}/pdf`, `Factura-${id}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsPending(false);
    }
  };

  return { descargar, isPending, error };
}
