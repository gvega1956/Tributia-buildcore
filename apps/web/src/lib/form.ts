// Re-exporta las utilidades de formulario que se usan en todo el proyecto.
// Integra react-hook-form con Zod via @hookform/resolvers.
export { useForm, useFieldArray, useWatch, Controller, type SubmitHandler, type FieldErrors } from 'react-hook-form';
export { zodResolver } from '@hookform/resolvers/zod';
