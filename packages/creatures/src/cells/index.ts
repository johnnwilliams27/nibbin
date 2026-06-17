/**
 * Barrel for the high-fidelity "ported cell" species. Each species lives in its
 * own file (`<species>.ts`) so the per-species ports can be authored
 * independently; this module re-exports their `<species>Full` builders for the
 * engine to wire onto `SpeciesDef.full`.
 */
export { caplingFull } from './capling';
