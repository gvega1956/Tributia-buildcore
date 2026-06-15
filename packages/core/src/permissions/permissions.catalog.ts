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

  // EDT / Partidas
  EDT_READ: 'edt:read',
  EDT_WRITE: 'edt:write',

  // APU (Análisis de Precio Unitario)
  APU_READ: 'apu:read',
  APU_WRITE: 'apu:write',

  // Presupuesto
  PRESUPUESTO_READ: 'presupuesto:read',
  PRESUPUESTO_WRITE: 'presupuesto:write',
  PRESUPUESTO_APPROVE: 'presupuesto:approve',

  // Compras
  REQUISICION_CREATE: 'requisicion:create',
  OC_READ: 'oc:read',
  OC_WRITE: 'oc:write',
  OC_APPROVE: 'oc:approve',
  RECEPCION_READ: 'recepcion:read',
  RECEPCION_WRITE: 'recepcion:write',
  FACTURA_PROV_READ: 'factura_prov:read',
  FACTURA_PROV_WRITE: 'factura_prov:write',
  CXP_READ: 'cxp:read',
  ANTICIPO_WRITE: 'anticipo:write',
  SCORING_READ: 'scoring:read',

  // Inventario
  INVENTARIO_READ: 'inventario:read',
  INVENTARIO_WRITE: 'inventario:write',
  AJUSTE_INVENTARIO: 'inventario:ajuste',

  // Obra
  PARTE_DIARIO_WRITE: 'parte_diario:write',
  AVANCE_WRITE: 'avance:write',
  RFI_WRITE: 'rfi:write',

  // Órdenes de Cambio (Change Orders §9)
  ORDEN_CAMBIO_READ: 'orden_cambio:read',
  ORDEN_CAMBIO_WRITE: 'orden_cambio:write',
  ORDEN_CAMBIO_APPROVE: 'orden_cambio:approve',

  // Contabilidad
  ASIENTO_READ: 'asiento:read',
  ASIENTO_MANUAL: 'asiento:manual',
  CIERRE_CONTABLE: 'cierre:contable',

  // Nómina
  NOMINA_READ: 'nomina:read',
  NOMINA_WRITE: 'nomina:write',
  NOMINA_APPROVE: 'nomina:approve',

  // Flujos de aprobación
  FLUJO_LEER: 'flujo:leer',
  FLUJO_APROBAR: 'flujo:aprobar',
  FLUJO_ADMIN: 'flujo:admin',

  // Documental
  DOCUMENTO_READ: 'documento:read',
  DOCUMENTO_WRITE: 'documento:write',

  // Notificaciones
  NOTIFICACION_READ: 'notificacion:read',

  // Catálogos maestros
  TERCERO_READ: 'tercero:read',
  TERCERO_WRITE: 'tercero:write',
  UNIDAD_MEDIDA_READ: 'unidad_medida:read',
  UNIDAD_MEDIDA_WRITE: 'unidad_medida:write',
  INSUMO_READ: 'insumo:read',
  INSUMO_WRITE: 'insumo:write',
  EQUIPO_CATALOGO_READ: 'equipo_catalogo:read',
  EQUIPO_CATALOGO_WRITE: 'equipo_catalogo:write',
  CATALOGO_DGII_READ: 'catalogo_dgii:read',

  // Sincronización offline (P7)
  SYNC_WRITE: 'sync:write',

  // Reportes / BI
  REPORTE_FINANCIERO: 'reporte:financiero',
  REPORTE_EJECUTIVO: 'reporte:ejecutivo',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
