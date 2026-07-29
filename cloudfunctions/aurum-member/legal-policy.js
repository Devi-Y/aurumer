const REQUIRED_LEGAL_VERSIONS = Object.freeze({
  termsVersion: "2026-07-28-v7",
  privacyVersion: "2026-07-28-v7",
});

function consentError(message) {
  const error = new Error(message);
  error.code = "LEGAL_CONSENT_REQUIRED";
  return error;
}

function validateLegalConsent(input, acceptedAt = new Date()) {
  if (!input || input.accepted !== true) {
    throw consentError("请先阅读并同意会员服务协议与隐私说明");
  }
  if (input.adultConfirmed !== true) {
    throw consentError("年度会员仅向已满 18 周岁的用户销售，请先完成年龄确认");
  }
  if (
    input.termsVersion !== REQUIRED_LEGAL_VERSIONS.termsVersion
    || input.privacyVersion !== REQUIRED_LEGAL_VERSIONS.privacyVersion
  ) {
    throw consentError("协议版本已更新，请重新阅读并确认");
  }
  return {
    ...REQUIRED_LEGAL_VERSIONS,
    adultConfirmed: true,
    acceptedAt,
  };
}

module.exports = {
  REQUIRED_LEGAL_VERSIONS,
  validateLegalConsent,
};
