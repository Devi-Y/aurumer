const FREE_LIMITS = {
  watchItems: 5,
  decisions: 5,
};

const MEMBER_LIMITS = {
  watchItems: 80,
  decisions: 300,
  eventMarks: 80,
  ipoRecords: 40,
  dividendLots: 80,
};

function freeRemaining(workspace = {}) {
  const watches = Array.isArray(workspace.watchItems) ? workspace.watchItems.length : 0;
  const decisions = Array.isArray(workspace.decisions) ? workspace.decisions.length : 0;
  return {
    watchItems: Math.max(0, FREE_LIMITS.watchItems - watches),
    decisions: Math.max(0, FREE_LIMITS.decisions - decisions),
  };
}

function cleanNumber(value, field, { min = 0, max = 1e12, required = false } = {}) {
  if (value == null || value === "") {
    if (required) {
      const error = new Error(`请填写${field}`);
      error.code = "INVALID_WORKSPACE_INPUT";
      throw error;
    }
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    const error = new Error(`${field}无效`);
    error.code = "INVALID_WORKSPACE_INPUT";
    throw error;
  }
  return number;
}

module.exports = {
  FREE_LIMITS,
  MEMBER_LIMITS,
  freeRemaining,
  cleanNumber,
};
