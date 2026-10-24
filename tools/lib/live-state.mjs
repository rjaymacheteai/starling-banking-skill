import { CliError } from '../../scripts/lib/errors.mjs';
import { bankApproval } from '../../scripts/lib/bank-approval.mjs';

// The CLI's plan status is authoritative. The helper may have crashed or saved
// "prepared" just before the bank rejected a request and the CLI marked it failed.
export async function recoverLiveState(state, inputHash, { loadPlan, cancel, now = Date.now() }) {
  if (!state) return null;
  let plan;
  try { plan = loadPlan(state.confirmCode); } catch (e) {
    if (e.code === 'PLAN_NOT_FOUND' && state.error?.code === 'PLAN_EXPIRED') return null;
    throw e;
  }
  if (plan.status === 'failed') return null; // Keep the failed plan for audit; prepare a new approval.
  if (['executing', 'unknown'].includes(plan.status)) {
    throw new CliError('PLAN_UNCERTAIN', 'The previous bank write may have been received. Check its result before starting another attempt.');
  }
  if (plan.status === 'done') {
    if (state.inputHash !== inputHash) throw new Error('A different test action has already completed. Review it before starting another.');
    const outcome = { ...plan.outcome, ...bankApproval(plan.outcome?.result) };
    const recovered = { ...state, status: outcome.actionState ?? 'submitted', outcome };
    delete recovered.error;
    return recovered;
  }
  if (plan.status !== 'prepared') throw new Error(`Unrecognised plan status: ${plan.status}`);
  if (state.inputHash !== inputHash || now > Date.parse(plan.expiresAt)) {
    await cancel(state.confirmCode);
    return null;
  }
  return { ...state, status: 'prepared', expiresAt: plan.expiresAt };
}
