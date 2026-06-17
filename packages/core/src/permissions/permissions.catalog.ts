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

  // CxC: Cubicaciones y Factura al Cliente (§16)
  CUBICACION_READ: 'cubicacion:read',
  CUBICACION_WRITE: 'cubicacion:write',
  FACTURA_CLI_READ: 'factura_cli:read',
  FACTURA_CLI_WRITE: 'factura_cli:write',
  CXC_READ: 'cxc:read',
  CXC_WRITE: 'cxc:write',

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

  // e-CF emisión (§17)
  ECF_EMISION_READ: 'ecf_emision:read',
  ECF_EMISION_WRITE: 'ecf_emision:write',

  // Sincronización offline (P7)
  SYNC_WRITE: 'sync:write',

  // Tesorería (§16)
  BANCO_READ: 'banco:read',
  BANCO_WRITE: 'banco:write',
  CONCILIACION_READ: 'conciliacion:read',
  CONCILIACION_WRITE: 'conciliacion:write',
  COBRO_WRITE: 'cobro:write',
  CAJA_CHICA_READ: 'caja_chica:read',
  CAJA_CHICA_WRITE: 'caja_chica:write',
  REPOSICION_READ: 'reposicion:read',
  REPOSICION_WRITE: 'reposicion:write',
  PAGO_PROGRAMADO_READ: 'pago_programado:read',
  PAGO_PROGRAMADO_WRITE: 'pago_programado:write',

  // Flujo de caja proyectado (§16)
  FLUJO_CAJA_READ: 'flujo_caja:read',
  FLUJO_CAJA_WRITE: 'flujo_caja:write',

  // Reportes DGII (§17)
  REPORTE_DGII_READ: 'reporte_dgii:read',

  // Reportes / BI
  REPORTE_FINANCIERO: 'reporte:financiero',
  REPORTE_EJECUTIVO: 'reporte:ejecutivo',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
