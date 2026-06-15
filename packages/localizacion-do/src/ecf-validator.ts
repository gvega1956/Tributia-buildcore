/**
 * EcfValidator — validador de NCF/e-CF recibidos de proveedores.
 *
 * SCOPE Capa 1: solo validación estructural de comprobantes RECIBIDOS.
 * La emisión de e-CF propios (integración con middleware DGII) es Capa 2.
 *
 * Reglas aplicadas:
 *   1. Formato NCF: B[01-16][8 dígitos] (11 chars) o E[31-46][8 dígitos] (11 chars)
 *   2. Tipo de comprobante: debe estar en el catálogo cerrado TIPOS_NCF
 *   3. RNC/Cédula proveedor: 9 dígitos (RNC) o 11 dígitos (Cédula)
 *   4. Vigencia: si se provee fecha de emisión, no puede ser mayor a 60 meses atrás
 */
import { TIPOS_NCF, type TipoNcf, type EcfValidationInput, type EcfValidationResult } from './localizacion-do.types.js';

/** Regex para NCF tradicional: B + 2 dígitos tipo + 8 dígitos secuencia */
const REGEX_NCF_TRADICIONAL = /^B(\d{2})(\d{8})$/;

/** Regex para e-CF: E + 2 dígitos tipo + 8 dígitos secuencia */
const REGEX_ECF = /^E(\d{2})(\d{8})$/;

/** Regex para RNC (9 dígitos) */
const REGEX_RNC = /^\d{9}$/;

/** Meses máximos de antigüedad permitidos para un NCF (5 años = 60 meses) */
const MAX_ANTIGUEDAD_MESES = 60;

/**
 * Extrae y valida el tipo de NCF a partir del prefijo.
 * Retorna el tipo si es válido, null si no existe en el catálogo.
 */
function detectarTipo(ncf: string): TipoNcf | null {
  const matchTrad = REGEX_NCF_TRADICIONAL.exec(ncf);
  if (matchTrad) {
    const tipo = `B${matchTrad[1]}` as TipoNcf;
    return tipo in TIPOS_NCF ? tipo : null;
  }

  const matchEcf = REGEX_ECF.exec(ncf);
  if (matchEcf) {
    const tipo = `E${matchEcf[1]}` as TipoNcf;
    return tipo in TIPOS_NCF ? tipo : null;
  }

  return null;
}

/**
 * Valida que el RNC o Cédula tenga el formato correcto.
 * RNC: 9 dígitos (sin guiones)
 * Cédula: 11 dígitos (con o sin guiones en formato 000-0000000-0)
 */
function validarRncOCedula(valor: string): boolean {
  const limpio = valor.replace(/-/g, '');
  return REGEX_RNC.test(limpio) || limpio.length === 11;
}

/**
 * Valida que el RNC comience con un dígito válido para personas jurídicas
 * registradas en República Dominicana (1, 4, 5).
 * Los RNC que empiezan con 1 corresponden a personas naturales/físicas.
 * Los que empiezan con 4/5 son personas jurídicas.
 * Cédulas de 11 dígitos son de personas físicas.
 */
function validarDigitoInicialRnc(rnc: string): boolean {
  const limpio = rnc.replace(/-/g, '');
  if (limpio.length === 9) {
    return ['1', '4', '5', '1', '3'].includes(limpio[0]!);
  }
  // Cédula de 11 dígitos: siempre válida en formato
  return limpio.length === 11;
}

/**
 * Valida si el comprobante está vigente según su fecha de emisión.
 * Un comprobante no puede tener más de MAX_ANTIGUEDAD_MESES meses de antigüedad.
 */
function validarVigencia(fechaEmision: Date, ahora: Date = new Date()): boolean {
  const msEnMes = 30 * 24 * 60 * 60 * 1000;
  const mesesTranscurridos = (ahora.getTime() - fechaEmision.getTime()) / msEnMes;
  return mesesTranscurridos <= MAX_ANTIGUEDAD_MESES;
}

/**
 * Valida un NCF/e-CF recibido de un proveedor.
 *
 * @param input - Datos del comprobante a validar
 * @returns Resultado con flag `valido`, lista de errores y tipo detectado
 */
export function validarEcf(input: EcfValidationInput): EcfValidationResult {
  const errores: string[] = [];
  const advertencias: string[] = [];
  let tipoDetectado: TipoNcf | undefined;

  const ncf = input.ncf.trim().toUpperCase();

  // ── 1. Formato del NCF ───────────────────────────────────────────────────────
  if (!REGEX_NCF_TRADICIONAL.test(ncf) && !REGEX_ECF.test(ncf)) {
    errores.push(
      `Formato de NCF inválido: "${ncf}". Debe ser B[01-16][8 dígitos] o E[31-46][8 dígitos].`,
    );
  } else {
    // ── 2. Tipo de comprobante en catálogo ────────────────────────────────────
    const tipo = detectarTipo(ncf);
    if (!tipo) {
      errores.push(
        `Tipo de comprobante desconocido en NCF "${ncf}". No está en el catálogo DGII.`,
      );
    } else {
      tipoDetectado = tipo;

      // ── 3. Validación opcional de tipo esperado ───────────────────────────
      if (input.tipoEsperado && input.tipoEsperado !== tipo) {
        advertencias.push(
          `Tipo detectado "${tipo}" difiere del esperado "${input.tipoEsperado}".`,
        );
      }
    }
  }

  // ── 4. Validación de RNC/Cédula del proveedor ───────────────────────────────
  const rncLimpio = input.rncProveedor.replace(/-/g, '').trim();

  if (!validarRncOCedula(input.rncProveedor)) {
    errores.push(
      `RNC/Cédula del proveedor inválido: "${input.rncProveedor}". Debe tener 9 dígitos (RNC) o 11 dígitos (Cédula).`,
    );
  } else if (rncLimpio.length === 9 && !validarDigitoInicialRnc(rncLimpio)) {
    advertencias.push(
      `RNC "${rncLimpio}" tiene un dígito inicial inusual. Verifique que sea un RNC válido ante la DGII.`,
    );
  }

  // ── 5. Vigencia del comprobante ──────────────────────────────────────────────
  if (input.fechaEmision) {
    if (input.fechaEmision > new Date()) {
      errores.push(
        `Fecha de emisión del comprobante es futura: ${input.fechaEmision.toISOString().slice(0, 10)}.`,
      );
    } else if (!validarVigencia(input.fechaEmision)) {
      errores.push(
        `Comprobante vencido: fue emitido el ${input.fechaEmision.toISOString().slice(0, 10)}, ` +
          `hace más de ${MAX_ANTIGUEDAD_MESES} meses.`,
      );
    }
  }

  return {
    valido: errores.length === 0,
    errores,
    advertencias,
    tipoDetectado,
    descripcionTipo: tipoDetectado ? TIPOS_NCF[tipoDetectado] : undefined,
  };
}
