const STORAGE_KEY = "aurum_local_holdings_v1";
const MAX_ITEMS = 20;

function safeParse(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function readHoldings() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") return safeParse(raw);
    return [];
  } catch (error) {
    return [];
  }
}

function writeHoldings(items) {
  const next = (items || []).slice(0, MAX_ITEMS);
  wx.setStorageSync(STORAGE_KEY, next);
  return next;
}

function normalizeHolding(input = {}) {
  const name = String(input.name || "").trim();
  const code = String(input.code || "").trim().toUpperCase();
  const market = String(input.market || "other").trim() || "other";
  const cost = Number(input.cost);
  const quantity = Number(input.quantity);
  if (!name) throw new Error("请先填写名称");
  return {
    id: String(input.id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    name,
    code,
    market,
    cost: Number.isFinite(cost) && cost > 0 ? cost : null,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
    note: String(input.note || "").trim().slice(0, 200),
    updatedAt: new Date().toISOString(),
  };
}

function listHoldings() {
  return readHoldings()
    .map((item) => ({ ...item }))
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

function upsertHolding(input) {
  const holding = normalizeHolding(input);
  const current = readHoldings().filter((item) => item.id !== holding.id);
  // 同代码去重，避免用户反复添加同一只。
  const withoutSameCode = holding.code
    ? current.filter((item) => String(item.code || "").toUpperCase() !== holding.code)
    : current;
  return writeHoldings([holding, ...withoutSameCode]);
}

function removeHolding(id) {
  return writeHoldings(readHoldings().filter((item) => item.id !== id));
}

module.exports = {
  listHoldings,
  upsertHolding,
  removeHolding,
  MAX_ITEMS,
};
