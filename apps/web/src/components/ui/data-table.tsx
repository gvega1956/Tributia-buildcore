import { useState, type ReactNode } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type RowSelectionState,
} from '@tanstack/react-table';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from './input';
import { Button } from './button';

export type { ColumnDef };

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
  /** Placeholder del campo de búsqueda global */
  searchPlaceholder?: string;
  /** Columna por la que filtrar globalmente. Si no se pasa, no hay buscador. */
  searchColumn?: string;
  /** Nodo extra junto al buscador (ej: botón "Nuevo") */
  toolbar?: ReactNode;
  /** Filas por página por defecto */
  pageSize?: number;
}

export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder = 'Buscar…',
  searchColumn,
  toolbar,
  pageSize = 20,
}: DataTableProps<TData>) {
  const [sorting, setSorting]               = useState<SortingState>([]);
  const [columnFilters, setColumnFilters]   = useState<ColumnFiltersState>([]);
  const [columnVisibility, setVisibility]   = useState<VisibilityState>({});
  const [rowSelection, setRowSelection]     = useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter]     = useState('');

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, rowSelection, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const filterValue = searchColumn
    ? (table.getColumn(searchColumn)?.getFilterValue() as string) ?? ''
    : globalFilter;

  const setFilterValue = (val: string) => {
    if (searchColumn) {
      table.getColumn(searchColumn)?.setFilterValue(val);
    } else {
      setGlobalFilter(val);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      {(searchColumn !== undefined || toolbar) && (
        <div className="flex items-center gap-3">
          {searchColumn !== undefined && (
            <Input
              className="max-w-xs"
              placeholder={searchPlaceholder}
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
            />
          )}
          <div className="ml-auto">{toolbar}</div>
        </div>
      )}

      {/* Tabla */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-gray-100 bg-gray-50">
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    const canSort = header.column.getCanSort();
                    return (
                      <th
                        key={header.id}
                        className={cn(
                          'px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide select-none',
                          canSort && 'cursor-pointer hover:text-gray-900',
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span className="inline-flex items-center gap-1">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            sorted === 'asc'  ? <ChevronUp size={12} className="text-brand-500" /> :
                            sorted === 'desc' ? <ChevronDown size={12} className="text-brand-500" /> :
                                                <ChevronsUpDown size={12} className="text-gray-300" />
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="text-center py-16 text-gray-400 text-sm">
                    Sin resultados
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3 text-gray-700">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Paginación */}
      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            {table.getFilteredRowModel().rows.length} resultado
            {table.getFilteredRowModel().rows.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft size={14} />
            </Button>
            <span className="px-2">
              {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
