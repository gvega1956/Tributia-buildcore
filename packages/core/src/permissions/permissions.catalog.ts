export const PERMISSIONS = {
  // Tenancy & Admin
  TENANT_MANAGE: 'tenant:manage',
  EMPRESA_MANAGE: 'empresa:manage',

  // Usuarios
  USUARIO_READ: 'usuario:read',
  USUARIO_WRITE: 'usuario:write',
  USUARIO_DELETE: 'usuario:delete',

  // Proyectos
  PROYECTO_READ: 'proyecto:read',
  PROYECTO_WRITE: 'proyecto:write',
  PROYECTO_DELETE: 'proyecto:delete',

  // EDT / Presupuesto
  EDT_READ: 'edt:read',
  EDT_WRITE: 'edt:write',
  PRESUPUESTO_APPROVE: 'presupuesto:approve',

  // Compras
  REQUISICION_CREATE: 'requisicion:create',
  OC_READ: 'oc:read',
  OC_WRITE: 'oc:write',
  OC_APPROVE: 'oc:approve',
  RECEPCION_WRITE: 'recepcion:write',

  // Inventario
  INVENTARIO_READ: 'inventario:read',
  INVENTARIO_WRITE: 'inventario:write',
  AJUSTE_INVENTARIO: 'inventario:ajuste',

  // Obra
  PARTE_DIARIO_WRITE: 'parte_diario:write',
  AVANCE_WRITE: 'avance:write',
  RFI_WRITE: 'rfi:write',

  // Contabilidad
  ASIENTO_READ: 'asiento:read',
  ASIENTO_MANUAL: 'asiento:manual',
  CIERRE_CONTABLE: 'cierre:contable',

  // Nómina
  NOMINA_READ: 'nomina:read',
  NOMINA_WRITE: 'nomina:write',
  NOMINA_APPROVE: 'nomina:approve',

  // Reportes / BI
  REPORTE_FINANCIERO: 'reporte:financiero',
  REPORTE_EJECUTIVO: 'reporte:ejecutivo',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
