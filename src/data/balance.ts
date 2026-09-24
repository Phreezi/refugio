import balanceJson from './balance.json';

/**
 * Valores de balanceamento (CLAUDE.md §12). Qualquer ajuste de dificuldade faz-se no JSON;
 * o `npm run validate-data` verifica que são todos números positivos.
 */
export type Balance = typeof balanceJson;

export const BALANCE: Readonly<Balance> = balanceJson;
