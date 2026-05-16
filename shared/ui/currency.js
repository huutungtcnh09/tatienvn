const vndFormatter = new Intl.NumberFormat("vi-VN", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0
});

export function formatCurrency(value) {
  return `${vndFormatter.format(Number(value || 0))} ₫`;
}

export function formatNumber(value) {
  return vndFormatter.format(Number(value || 0));
}

export function formatMoneyInput(value) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? vndFormatter.format(Number(digits)) : "";
}
