// Reconfirming a done plan returns its original submission response. Refresh the
// bank status rather than repeating a stale in-app-approval reminder.
export async function repeatedPaymentStatus(outcome, command) {
  if (!outcome.alreadyExecuted) return null;
  const uid = outcome.paymentOrderUid ?? outcome.result?.paymentOrderUid;
  if (!uid) return { message: 'No new payment request was submitted. The original response has no payment order UID to query.' };
  try {
    const status = await command(['payments', 'status', uid]);
    return { bankState: status.data.state, checkedAt: new Date().toISOString(), message: `No new payment request was submitted. Existing payment status: ${status.data.state}.` };
  } catch (e) {
    return { errorCode: e.code, message: 'No new payment request was submitted. The existing payment status could not be refreshed.' };
  }
}
