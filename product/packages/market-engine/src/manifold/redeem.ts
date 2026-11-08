import { type Bet, getNewBetId } from './bet.ts';
import type { Contract } from './contract.ts';
import type { ContractMetric } from './contract-metric.ts';
import { noFees } from './fees.ts';
import { removeUndefinedProps } from './util/object.ts';

export const getBinaryRedeemableAmountFromContractMetric = (
  contractMetric: Omit<ContractMetric, 'id'>,
) => {
  const yesShares = contractMetric.totalShares['YES'] ?? 0;
  const noShares = contractMetric.totalShares['NO'] ?? 0;
  const shares = Math.max(Math.min(yesShares, noShares), 0);

  // Hrizzup has no loans, so redeeming repays none: the whole amount is paid out.
  const loanPayment = 0;
  const netAmount = shares - loanPayment;
  return { shares, loanPayment, netAmount };
};

export const getRedemptionBets = (
  contract: Contract,
  shares: number,
  prob: number,
  answerId: string | undefined,
  userId: string,
  now: number, // The time of the redemption, in milliseconds since 1970
) => {
  const createdTime = now;
  const yesBet: Bet = removeUndefinedProps({
    id: getNewBetId(),
    userId,
    contractId: contract.id,
    amount: prob * -shares,
    shares: -shares,
    loanAmount: 0, // Hrizzup has no loans
    outcome: 'YES',
    probBefore: prob,
    probAfter: prob,
    createdTime,
    fees: noFees,
    isRedemption: true,
    visibility: contract.visibility,
    answerId,
  });
  const noBet: Bet = removeUndefinedProps({
    id: getNewBetId(),
    userId,
    contractId: contract.id,
    amount: (1 - prob) * -shares,
    shares: -shares,
    loanAmount: 0, // Hrizzup has no loans
    outcome: 'NO',
    probBefore: prob,
    probAfter: prob,
    createdTime,
    fees: noFees,
    isRedemption: true,
    visibility: contract.visibility,
    answerId,
  });
  return [yesBet, noBet];
};
