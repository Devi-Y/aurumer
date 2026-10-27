// 原 research-365d 商品仅保留存量订单与权益处理，不再接受新购或续费。
// 会员群是独立服务，不能复用旧套餐、价格或历史账本。
const RESEARCH_PURCHASES_ENABLED = false;
const RESEARCH_PURCHASE_MESSAGE = "研究内容免费，原年度研究会员已停止新购。历史订单和权益仍可查询。";

function assertResearchPurchaseAllowed() {
  if (RESEARCH_PURCHASES_ENABLED) return;
  const error = new Error(RESEARCH_PURCHASE_MESSAGE);
  error.code = "RESEARCH_PURCHASE_RETIRED";
  throw error;
}

module.exports = {
  RESEARCH_PURCHASES_ENABLED,
  RESEARCH_PURCHASE_MESSAGE,
  assertResearchPurchaseAllowed,
};
