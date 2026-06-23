import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Building2 } from 'lucide-react';
import { zCrearCuentaBancaria, type CrearCuentaBancariaInput } from '@tributia/tesoreria';
import {
  useCuentasBancarias,
  useCrearCuentaBancaria,
  useMovimientosBancarios,
  type CuentaBancaria,
  type MovimientoBancario,
} from '@/hooks/use-tesoreria';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadingSpinner, ErrorState, EmptyState } from '@/components/ui/states';
import { toast } from '@/components/ui/toast';
import Decimal from 'decimal.js';

function FormField({ label, error, required, children }: {
  label: string; error?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const cuentaColumns: ColumnDef<CuentaBancaria>[] = [
  {
    accessorKey: 'bancoNombre',
    header: 'Banco',
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-gray-900">{row.original.bancoNombre}</p>
        <p className="text-xs font-mono text-gray-500">{row.original.numeroCuenta}</p>
      </div>
    ),
  },
  { accessorKey: 'tipoCuenta', header: 'Tipo', cell: ({ row }) => row.original.tipoCuenta ?? '—' },
  {
    accessorKey: 'saldo',
    header: 'Saldo',
    cell: ({ row }) => (
      <span className="tabular-nums font-semibold">{new Decimal(row.original.saldo).toFixed(2)} {row.original.moneda}</span>
    ),
  },
  { accessorKey: 'cuentaContableCodigo', header: 'Cuenta contable', cell: ({ row }) => <span className="font-mono text-xs">{row.original.cuentaContableCodigo}</span> },
];

function MovimientosPanel({ cuenta, onClose }: { cuenta: CuentaBancaria; onClose: () => void }) {
  const { data: movs = [], isLoading } = useMovimientosBancarios(cuenta.id);

  return (
    <Modal open onClose={onClose} title={`${cuenta.bancoNombre} — ${cuenta.numeroCuenta}`} size="xl">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Saldo actual:</span>
          <span className="text-lg font-bold tabular-nums">{new Decimal(cuenta.saldo).toFixed(2)} {cuenta.moneda}</span>
        </div>
        {isLoading && <LoadingSpinner />}
        {!isLoading && movs.length === 0 && <EmptyState title="Sin movimientos" description="No hay movimientos en esta cuenta." />}
        {movs.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-2">Fecha</th>
                <th className="text-left px-4 py-2">Descripción</th>
                <th className="text-right px-4 py-2">Monto</th>
                <th className="text-center px-4 py-2">Conciliado</th>
              </tr>
            </thead>
            <tbody>
              {movs.map((m) => (
                <tr key={m.id} className="border-t border-gray-50">
                  <td className="px-4 py-2">{m.fecha}</td>
                  <td className="px-4 py-2 text-gray-700">{m.descripcion}</td>
                  <td className={`px-4 py-2 text-right tabular-nums font-medium ${m.tipo === 'CREDITO' ? 'text-green-700' : 'text-red-700'}`}>
                    {m.tipo === 'CREDITO' ? '+' : '-'}{new Decimal(m.monto).toFixed(2)} {m.moneda}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <Badge variant={m.conciliado ? 'success' : 'default'}>{m.conciliado ? '✓' : '—'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}

export function BancosPage() {
  const [showForm, setShowForm] = useState(false);
  const [selectedCuenta, setSelectedCuenta] = useState<CuentaBancaria | null>(null);

  const { data: cuentas = [], isLoading, error, refetch } = useCuentasBancarias();
  const crearMut = useCrearCuentaBancaria();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CrearCuentaBancariaInput>({
    resolver: zodResolver(zCrearCuentaBancaria),
    defaultValues: { empresaId: '', bancoNombre: '', numeroCuenta: '', tipoCuenta: 'CORRIENTE', moneda: 'DOP', cuentaContableCodigo: '' },
  });

  async function onSubmit(values: CrearCuentaBancariaInput) {
    try {
      await crearMut.mutateAsync(values);
      toast.success('Cuenta bancaria registrada');
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error registrando cuenta');
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 size={18} className="text-brand-500" />
          <h1 className="text-xl font-bold text-gray-900">Bancos y movimientos</h1>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus size={14} className="mr-1.5" />
          Nueva cuenta
        </Button>
      </div>

      {isLoading && <LoadingSpinner />}
      {error && <ErrorState message="Error cargando cuentas bancarias" onRetry={() => refetch()} />}
      {!isLoading && !error && (
        cuentas.length === 0
          ? <EmptyState title="Sin cuentas bancarias" description="Registra la primera cuenta bancaria de la empresa." action={<Button size="sm" onClick={() => setShowForm(true)}>Nueva cuenta</Button>} />
          : <DataTable columns={cuentaColumns} data={cuentas} searchColumn="bancoNombre" searchPlaceholder="Buscar banco…" onRowClick={setSelectedCuenta} />
      )}

      {selectedCuenta && <MovimientosPanel cuenta={selectedCuenta} onClose={() => setSelectedCuenta(null)} />}

      <Modal open={showForm} onClose={() => setShowForm(false)} title="Nueva Cuenta Bancaria" size="md">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <FormField label="Empresa" required error={errors.empresaId?.message}>
            <Input {...register('empresaId')} placeholder="UUID de la empresa" />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Nombre del banco" required error={errors.bancoNombre?.message}>
              <Input {...register('bancoNombre')} placeholder="BanReservas" />
            </FormField>
            <FormField label="Número de cuenta" required error={errors.numeroCuenta?.message}>
              <Input {...register('numeroCuenta')} placeholder="01-000-000000-0" />
            </FormField>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <FormField label="Tipo">
              <select {...register('tipoCuenta')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="CORRIENTE">Corriente</option>
                <option value="AHORROS">Ahorros</option>
              </select>
            </FormField>
            <FormField label="Moneda">
              <select {...register('moneda')} className="w-full h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500">
                <option value="DOP">DOP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </FormField>
            <FormField label="Cuenta contable" required error={errors.cuentaContableCodigo?.message}>
              <Input {...register('cuentaContableCodigo')} placeholder="1101" />
            </FormField>
          </div>
        </form>
        <ModalFooter>
          <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button onClick={handleSubmit(onSubmit)} disabled={crearMut.isPending}>
            {crearMut.isPending ? 'Registrando…' : 'Registrar cuenta'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
