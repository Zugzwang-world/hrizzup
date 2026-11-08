/**
 * Manifold's `common/src/new-contract.ts`, trimmed to opening the two kinds of market its
 * tests open here: yes/no (BINARY) and multiple choice (MULTIPLE_CHOICE). Manifold's file
 * also opens polls, bounties, numbers and dates, which pull in users, notifications and
 * Manifold's database types; those parts are left out. Each part kept is Manifold's code,
 * except `getNewContract`, which returns only the fields of our slim market type
 * (`contract.ts`), and new answer ids, which come from `crypto.randomUUID()` instead of
 * Manifold's `util/random.ts`. Used by Manifold's tests (`conservation-grid.test.ts`).
 */
import { sum } from 'lodash-es';
import type { Answer } from './answer.ts';
import {
  cpmmMulti2BalancedPools,
  cpmmMulti2SumToOneCreationPools,
  getCpmmLiquidity,
  getCpmmProbability,
  getInitialAnswerPools,
  getMultiCpmmLiquidity,
} from './calculate-cpmm.ts';
import type {
  add_answers_mode,
  Binary,
  Contract,
  CPMM,
  CPMMMulti,
  Visibility,
} from './contract.ts';
import { MAX_CPMM_PROB, MIN_CPMM_PROB } from './contract.ts';
import { removeUndefinedProps } from './util/object.ts';

// Manifold's setting (in its contract.ts): new multiple choice markets open as cpmm-multi-2.
const CPMM_MULTI_2_CREATION_ENABLED = true;

export function getNewContract(props: {
  id: string;
  closeTime?: number;
  visibility: Visibility;
  creator: { id: string };
  outcomeType: 'BINARY' | 'MULTIPLE_CHOICE';
  initialProb: number;
  ante: number;

  // Multi-choice
  answers: string[];
  addAnswersMode?: add_answers_mode | undefined;
  shouldAnswersSumToOne?: boolean | undefined;
  answerShortTexts?: string[];
  answerImageUrls?: string[];
  // Starting probability of each answer, as a percent. Defaults to an even split.
  answerProbs?: number[];
  // Colour of each answer. Defaults to the versus pair for a two-answer
  // versus market, otherwise the chart palette.
  answerColors?: string[];
  // Whether a multiple choice market opens as cpmm-multi-2. Defaults to
  // CPMM_MULTI_2_CREATION_ENABLED; tests set it to cover both mechanisms.
  cpmmMulti2Enabled?: boolean;
}) {
  const {
    id,
    creator,
    outcomeType,
    initialProb,
    ante,
    closeTime,
    visibility,
    answers,
    addAnswersMode,
    shouldAnswersSumToOne,
    answerShortTexts,
    answerImageUrls,
    answerProbs,
    answerColors,
    cpmmMulti2Enabled = CPMM_MULTI_2_CREATION_ENABLED,
  } = props;

  const propsByOutcomeType = {
    BINARY: () => getBinaryCpmmProps(initialProb, ante),
    MULTIPLE_CHOICE: () =>
      getMultipleChoiceProps(
        id,
        creator.id,
        answers,
        addAnswersMode ?? 'DISABLED',
        shouldAnswersSumToOne ?? true,
        ante,
        answerShortTexts,
        answerImageUrls,
        answerProbs,
        answerColors,
        cpmmMulti2Enabled,
      ),
  }[outcomeType]();

  const contract: Contract = removeUndefinedProps({
    id,
    ...propsByOutcomeType,
    visibility,
    isResolved: false,
    closeTime,

    collectedFees: {
      creatorFee: 0,
      liquidityFee: 0,
      platformFee: 0,
    },
  });

  return contract as Contract;
}

const getBinaryCpmmProps = (initialProb: number, ante: number) => {
  const pool = { YES: ante, NO: ante };
  const p = initialProb / 100;

  const system: CPMM & Binary = {
    mechanism: 'cpmm-1',
    outcomeType: 'BINARY',
    totalLiquidity: ante,
    subsidyPool: 0,
    initialProbability: p,
    p,
    pool: pool,
    prob: p,
    probChanges: { day: 0, week: 0, month: 0 },
  };

  return system;
};

export const VERSUS_COLORS = ['#4e46dc', '#e9a23b'];

// Bounds on a manually set starting probability, in percent. These match the
// range bets are allowed to move an answer within, so a creator can't open a
// market outside of where traders could ever put it.
export const MIN_ANSWER_PROB = MIN_CPMM_PROB * 100;
export const MAX_ANSWER_PROB = MAX_CPMM_PROB * 100;

// Whether a new multiple choice market opens as cpmm-multi-2. A cpmm-multi-1
// pool has p fixed at 0.5, so it can only hold an answer away from an even
// split by throwing away shares, whether the ante bought them or liquidity
// added later did; giving each answer its own p loses none. Without starting
// probabilities the pools are cpmm-multi-1's even split, every p at 0.5.
export const opensAsCpmmMulti2 = (props: { cpmmMulti2Enabled?: boolean }) =>
  props.cpmmMulti2Enabled ?? CPMM_MULTI_2_CREATION_ENABLED;

// Turns starting percentages into the fractions the answer pools are built
// from, appending 'Other's share when the market has one. Assumes they already
// passed getAnswerProbsError.
const getInitialProbs = (
  answerProbs: number[],
  shouldAnswersSumToOne: boolean,
  hasOtherAnswer: boolean,
) => {
  if (!shouldAnswersSumToOne) return answerProbs.map((prob) => prob / 100);

  const probs = hasOtherAnswer ? [...answerProbs, 100 - sum(answerProbs)] : answerProbs;
  // Scale out any rounding slop so the answers sum to exactly one.
  const total = sum(probs);
  return probs.map((prob) => prob / total);
};

const getMultipleChoiceProps = (
  contractId: string,
  userId: string,
  answers: string[],
  addAnswersMode: add_answers_mode,
  shouldAnswersSumToOne: boolean,
  ante: number,
  shortTexts?: string[],
  imageUrls?: string[],
  answerProbs?: number[],
  answerColors?: string[],
  cpmmMulti2Enabled?: boolean,
) => {
  const isBinaryMulti =
    addAnswersMode === 'DISABLED' && answers.length === 2 && shouldAnswersSumToOne;

  const isV2 = opensAsCpmmMulti2({ cpmmMulti2Enabled });

  const hasOther = shouldAnswersSumToOne && addAnswersMode !== 'DISABLED';
  const answersWithOther = answers.concat(hasOther ? ['Other'] : []);
  const answerObjects = createAnswers(
    contractId,
    userId,
    addAnswersMode,
    shouldAnswersSumToOne,
    ante,
    answersWithOther,
    removeUndefinedProps({
      colors: answerColors ?? (isBinaryMulti ? VERSUS_COLORS : undefined),
      shortTexts,
      imageUrls,
      probs: answerProbs
        ? getInitialProbs(answerProbs, shouldAnswersSumToOne, hasOther)
        : undefined,
      cpmmMulti2: isV2,
    }),
  );
  const system: CPMMMulti = removeUndefinedProps({
    mechanism: isV2 ? 'cpmm-multi-2' : 'cpmm-multi-1',
    outcomeType: 'MULTIPLE_CHOICE',
    addAnswersMode: addAnswersMode ?? 'DISABLED',
    shouldAnswersSumToOne: shouldAnswersSumToOne ?? true,
    answers: answerObjects,
    totalLiquidity: ante,
    subsidyPool: 0,
    // Answer probs move with every bet, so keep a record of where the creator
    // opened them for the chart's starting point.
    initialProbabilities: answerProbs
      ? Object.fromEntries(answerObjects.map((a) => [a.id, a.prob]))
      : undefined,
  });

  return system;
};

// The √variance creation rule for cpmm-multi-2 sum-to-one markets. Given the
// normalized target probs q_i (Σ = 1) and the ante, allocate pool depth
// W_i = (1−p_i)Y_i + p_iN_i ∝ √(q_i(1−q_i)) — the variance-weighted depth that
// maximizes effective liquidity under the no-house-risk basket budget (closed
// form; derivation + benchmarks in tasks/cpmm_multi_2, GP13–GP15). Properties:
// reduces to v1's pools exactly at uniform, to a balanced pool at n=2; funds
// exactly (every winning scenario pays the ante) and reads back prob_i = q_i.
function createAnswers(
  contractId: string,
  userId: string,
  addAnswersMode: add_answers_mode,
  shouldAnswersSumToOne: boolean,
  ante: number,
  answers: string[],
  options: {
    colors?: string[];
    shortTexts?: string[];
    imageUrls?: string[];
    midpoints?: number[];
    // Starting probability of each answer, as a fraction. Defaults to an even split.
    probs?: number[];
    // Open the answers at `probs` with cpmm-multi-2 pools.
    cpmmMulti2?: boolean;
  } = {},
) {
  const { colors, shortTexts, imageUrls, midpoints, probs, cpmmMulti2 } = options;
  const ids = answers.map(() => crypto.randomUUID());
  const now = Date.now();

  // Mechanism-independent Answer fields; each branch below supplies only the
  // pool shape (poolYes/poolNo/p/prob/totalLiquidity) and isOther.
  const baseAnswer = (i: number, text: string) => ({
    id: ids[i],
    index: i,
    contractId,
    userId,
    text,
    createdTime: now,
    color: colors?.[i],
    shortText: shortTexts?.[i],
    imageUrl: imageUrls?.[i],
    subsidyPool: 0,
    probChanges: { day: 0, week: 0, month: 0 },
    midpoint: midpoints?.[i],
    volume: 0,
  });

  // cpmm-multi-2: per-answer initial probs, dialed to target via each answer's
  // own `p`. Two regimes (see tasks/cpmm_multi_2/creation-liquidity-findings.md,
  // GP13–GP15):
  //
  // Sum-to-one ("Multiple Choice"): exactly one answer resolves YES, so the raw
  // percentages are normalized to Σ q_i = 1. Pools use the √variance creation
  // rule — depth W_i = (1−p_i)Y_i + p_iN_i ∝ √(q_i(1−q_i)) — which maximizes
  // effective liquidity under the no-house-risk basket budget (every winning
  // scenario pays exactly the ante). It reduces to v1's pools exactly at uniform
  // and to a balanced pool at n=2; for n≥3 skew it is asymmetric with p_i≠q_i.
  //
  // Independent ("Set"): each answer is its own CPMM with no Σ=1 constraint and
  // its own max-loss budget max(Y,N); at fixed risk the liquidity optimum is the
  // balanced pool Y_i=N_i with p_i=q_i — exactly the binary-CPMM construction.
  //
  // `probs` arrive already normalized to Σ = 1 for sum-to-one answers and as
  // absolute probabilities for independent ones (getInitialProbs). Where the
  // √variance closed form doesn't exist (GP19a) or would starve the long shots,
  // sum-to-one answers get the same shape solved exactly instead, just as
  // lossless (cpmmMulti2SumToOneCreationPools), so no starting odds are refused.
  if (cpmmMulti2 && probs) {
    const pools = shouldAnswersSumToOne
      ? cpmmMulti2SumToOneCreationPools(probs, ante)
      : cpmmMulti2BalancedPools(probs, ante);
    return answers.map((text, i) => {
      const { poolYes, poolNo, p, prob } = pools[i];
      const answer: Answer = removeUndefinedProps({
        ...baseAnswer(i, text),
        poolYes,
        poolNo,
        p,
        prob,
        // True general-p CPMM liquidity invariant k = Y^p · N^(1-p). getMultiCpmmLiquidity is the
        // p=0.5 special case √(Y·N), which understates depth on the √variance asymmetric v2 pools
        // (Y_i≠N_i, p_i≠0.5). Balanced Set pools (Y=N) give the same value either way.
        totalLiquidity: getCpmmLiquidity({ YES: poolYes, NO: poolNo }, p),
        isOther: shouldAnswersSumToOne && addAnswersMode !== 'DISABLED' && i === answers.length - 1,
      });
      return answer;
    });
  }

  // Custom starting probabilities on cpmm-multi-1: spread the ante around them
  // instead, throwing away whatever shares p = 0.5 can't hold at those odds.
  const customPools = probs ? getInitialAnswerPools(probs, ante, shouldAnswersSumToOne) : undefined;

  let prob = 0.5;
  let poolYes = ante / answers.length;
  let poolNo = ante / answers.length;

  if (shouldAnswersSumToOne && answers.length > 1) {
    const n = answers.length;
    prob = 1 / n;
    // Maximize use of ante given constraint that one answer resolves YES and
    // the rest resolve NO.
    // Means that:
    //   ante = poolYes + (n - 1) * poolNo
    // because this pays out ante mana to winners in this case.
    // Also, cpmm identity for probability:
    //   1 / n = poolNo / (poolYes + poolNo)
    poolNo = ante / (2 * n - 2);
    poolYes = ante / 2;

    // Naive solution that doesn't maximize liquidity:
    // poolYes = ante * prob
    // poolNo = ante * (prob ** 2 / (1 - prob))
  }

  // cpmm-multi-2: Other alone, in a market opened with no listed answers, is
  // sure to win until an answer is added, so it opens at the top of the band on
  // the same pool rather than at cpmm-multi-1's 50%. Nothing can be bet until a
  // second answer exists (place-bet), and the first one added opens at 50%
  // beside a new Other at 50% (newAnswerOpeningProb of the whole market).
  let p = 0.5;
  if (cpmmMulti2 && shouldAnswersSumToOne && answers.length === 1) {
    p = MAX_CPMM_PROB;
    prob = getCpmmProbability({ YES: poolYes, NO: poolNo }, p);
  }

  return answers.map((text, i) => {
    const { YES: answerPoolYes, NO: answerPoolNo } = customPools?.[i] ?? {
      YES: poolYes,
      NO: poolNo,
    };
    const answer: Answer = removeUndefinedProps({
      ...baseAnswer(i, text),
      poolYes: answerPoolYes,
      poolNo: answerPoolNo,
      p, // 0.5, as on cpmm-multi-1, except a cpmm-multi-2 Other alone (above)
      prob: probs?.[i] ?? prob,
      totalLiquidity: getMultiCpmmLiquidity({
        YES: answerPoolYes,
        NO: answerPoolNo,
      }),
      isOther: shouldAnswersSumToOne && addAnswersMode !== 'DISABLED' && i === answers.length - 1,
    });
    return answer;
  });
}
