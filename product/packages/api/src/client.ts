import routes from './contract.routes.json';
import type { Contract } from './contract.ts';

/**
 * What a client of the API needs at run time: the contract's addresses and errors, without its
 * validators (routes.ts). The app imports this entry and never contract.ts, so its code stays
 * small; its types still come from the full contract.
 */
export const clientContract = routes as unknown as Contract;

export type { AuthSettings, EmailCodeSent } from './auth.ts';
export type { Api, Contract, Health, Me, Meta } from './contract.ts';
