import type { SolverName } from '~~/types/simulation'

export const SOLVER_OPTIONS: Array<{ label: string; value: SolverName }> = [
  { label: 'HiGHS', value: 'HiGHS' },
  { label: 'COPT', value: 'COPT' }
]

export function isSolverName(value: unknown): value is SolverName {
  return value === 'HiGHS' || value === 'COPT'
}
