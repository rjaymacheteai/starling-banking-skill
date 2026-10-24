// Personal-token responses can request bank consent instead of completing a write.
// Payments may nest this object; the live payee-update response returned it directly.
export function bankApproval(result) {
  const consent = result?.consentInformation ?? result;
  if (consent?.approvalType !== 'IN_APP_APPROVAL' || typeof consent.consentUid !== 'string' || !consent.consentUid) return {};
  return {
    actionState: 'awaiting_bank_approval',
    bankApproval: { type: consent.approvalType, consentUid: consent.consentUid },
    reminder: 'Starling requires approval in its app. This response does not confirm the action completed. Open the Starling app to review the request; do not resubmit it while approval is pending.',
  };
}
