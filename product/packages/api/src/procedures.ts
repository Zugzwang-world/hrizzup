import { type ContractProcedure, isContractProcedure } from '@orpc/contract';
import type { Meta } from './contract.ts';

type AnyProcedure = ContractProcedure<never, never, never, Meta>;

/**
 * Every call in a contract, the nested ones too (the market console's are under `admin.markets`),
 * by its dotted name, such as `admin.markets.create`. For the tests that hold every call to the
 * contract's rules.
 */
export function procedures(router: object, prefix = ''): [string, AnyProcedure][] {
  return Object.entries(router).flatMap(([name, value]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    if (isContractProcedure(value)) return [[path, value as unknown as AnyProcedure]];
    if (typeof value === 'object' && value !== null) return procedures(value, path);
    return [];
  });
}
