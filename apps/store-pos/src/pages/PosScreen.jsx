import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency, formatMoneyInput, formatNumber } from "../utils/currency";
import { formatDateTimeVN, formatDateVN } from "../utils/datetime";
import SearchableSelect from "../components/SearchableSelect";

const DAILY_INTEREST_RATE = 0.0003288;

function SearchMonoIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readThreeDigitsVietnamese(number, isLeadingGroup = false) {
  const hundreds = Math.floor(number / 100);
  const tens = Math.floor((number % 100) / 10);
  const ones = number % 10;
  const words = [];

  if (hundreds > 0) {
    words.push(`${["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"][hundreds]} trăm`);
  } else if (isLeadingGroup && (tens > 0 || ones > 0)) {
    words.push("không trăm");
  }

  if (tens > 1) {
    words.push(`${["", "", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"][tens]} mươi`);
    if (ones === 1) words.push("mốt");
    else if (ones === 4) words.push("tư");
    else if (ones === 5) words.push("lăm");
    else if (ones > 0) words.push(["", "", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"][ones]);
  } else if (tens === 1) {
    words.push("mười");
    if (ones === 5) words.push("lăm");
    else if (ones > 0) words.push(["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"][ones]);
  } else if (ones > 0) {
    if (hundreds > 0) words.push("lẻ");
    words.push(["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"][ones]);
  }

  return words.join(" ").trim();
}

function toVietnameseMoneyWords(value) {
  const number = Math.max(0, Math.floor(Number(value || 0)));
  if (!number) return "Không đồng";

  const units = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];
  const groups = [];
  let remaining = number;
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }

  const parts = [];
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const groupValue = groups[i];
    if (groupValue === 0) continue;
    const hasHigherGroup = i < groups.length - 1;
    const groupWords = readThreeDigitsVietnamese(groupValue, hasHigherGroup);
    const unit = units[i] || "";
    parts.push(`${groupWords}${unit ? ` ${unit}` : ""}`.trim());
  }

  const sentence = parts.join(" ").replace(/\s+/g, " ").trim();
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} đồng`;
}

function resolvePrintLineTotal(item) {
  const qty = Number(item?.quantity || 0);
  const unitPrice = Number(item?.unitPrice || 0);
  const lineDiscount = Number(item?.discountAmount || 0);
  const totalFromApi = Number(item?.totalAmount);
  if (Number.isFinite(totalFromApi)) {
    return Math.max(totalFromApi, 0);
  }
  return Math.max(qty * unitPrice - lineDiscount, 0);
}

function resolvePrintFinalUnitPrice(item) {
  const qty = Math.max(Number(item?.quantity || 0), 0);
  if (qty <= 0) return Number(item?.unitPrice || 0);
  return resolvePrintLineTotal(item) / qty;
}

function resolvePrintUnitLabel(item) {
  return String(item?.unit || item?.product?.unit || "-").trim() || "-";
}

function resolvePrintQuantityLabel(item) {
  const qty = Number(item?.quantity || 0);
  const saleUnit = String(item?.unit || item?.product?.unit || "cái").trim();
  return `${formatNumber(qty)} (${saleUnit})`;
}

function renderPosReceiptHtml(order) {
  const orderItems = Array.isArray(order?.items) ? order.items : [];
  const customerName = order?.customer?.name || "Khách lẻ";
  const customerPhone = order?.customer?.phone || "-";
  const orderNo = order?.orderNo || order?.id || "-";
  const createdAt = order?.createdAt ? new Date(order.createdAt) : new Date();
  // Tính lại tạm tính: tổng giá gốc các dòng
  const subtotal = Array.isArray(order?.items)
    ? order.items.reduce((sum, item) => sum + Number(item?.unitPrice || 0) * Number(item?.quantity || 0), 0)
    : 0;
  const discount = Number(order?.discountAmount || 0);
  const total = Number(order?.totalAmount || 0);
  const paid = Number(order?.paidAmount || 0);
  const debt = Number(order?.debtAmount ?? Math.max(total - paid, 0));
  const change = paid > total ? paid - total : 0;
  const cashierName = order?.createdByUser?.name || order?.createdByUser?.username || "-";
  const storeName = order?.store?.name || "Cửa hàng";
  const storePhone = order?.store?.phone || "0354214678";
  const note = order?.note || "";
  const firstAllocation = Array.isArray(order?.receiptAllocations)
    ? order.receiptAllocations.find((row) => row?.receipt?.receiptNo)
    : null;
  const receiptNo = firstAllocation?.receipt?.receiptNo || null;

  const itemRows = orderItems.map((item, idx) => {
    const code = item?.product?.sku || item?.sku || item?.productId || "-";
    const name = item?.product?.name || item?.name || code;
    const qtyLabel = resolvePrintQuantityLabel(item);
    const unitPrice = resolvePrintFinalUnitPrice(item);
    const lineTotal = resolvePrintLineTotal(item);
    const giftTag = item?.isGift ? " [Tặng]" : "";
    return `
      <tr class="item-row">
        <td class="item-cell">
          <div class="item-name">${idx + 1}. ${escapeHtml(name)}${giftTag}</div>
          <div class="item-detail">
            <span class="item-code">${escapeHtml(code)}</span>
            <span class="item-calc">${escapeHtml(qtyLabel)} x ${formatCurrency(unitPrice)} = <strong>${formatCurrency(lineTotal)}</strong></span>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  const discountRow = discount > 0
    ? `<div class="total-row"><span>Giảm giá</span><span class="neg">- ${formatCurrency(discount)}</span></div>`
    : "";
  const debtRow = debt > 0
    ? `<div class="total-row debt-row"><span>Còn nợ</span><span>${formatCurrency(debt)}</span></div>`
    : "";
  const changeRow = change > 0
    ? `<div class="total-row"><span>Tiền thừa</span><span>${formatCurrency(change)}</span></div>`
    : "";
  const noteRow = note
    ? `<div class="note-row">Ghi chú: ${escapeHtml(note)}</div>`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;600;700;900&display=swap" rel="stylesheet" />
  <title>Phiếu tính tiền ${escapeHtml(orderNo)}</title>
  <style>
    @page { size: 80mm auto; margin: 2mm 0 5mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Be Vietnam Pro", "Segoe UI", Arial, sans-serif;
      font-size: 12px;
      color: #111;
      background: #fff;
    }
    /* HEADER */
    .header { text-align: center; padding: 4px 0 6px; }
    .store-name { font-size: 18px; font-weight: 900; letter-spacing: 2px; }
    .receipt-title {
      font-size: 12px; font-weight: 700;
      border: 1.5px solid #111;
      display: inline-block;
      padding: 2px 12px;
      margin: 5px 0 3px;
      letter-spacing: 1px;
    }
    .store-sub { font-size: 11px; color: #555; }
    /* SEPARATORS */
    .sep  { border: none; border-top: 1px dashed #999; margin: 5px 0; }
    .sep2 { border: none; border-top: 1.5px solid #111; margin: 5px 0; }
    /* META */
    .meta-row {
      display: table; width: 100%; margin: 3px 0; font-size: 11.5px;
    }
    .meta-label { display: table-cell; color: #555; width: 70px; vertical-align: top; }
    .meta-value { display: table-cell; font-weight: 600; text-align: right; }
    /* ITEMS */
    .item-row { border-bottom: 1px dotted #ccc; }
    .item-row:last-child { border-bottom: none; }
    .item-cell { padding: 5px 0; }
    .item-name { font-weight: 700; font-size: 12px; line-height: 1.4; }
    .item-detail {
      display: flex; justify-content: space-between;
      align-items: center; margin-top: 2px;
    }
    .item-code { font-size: 10px; color: #888; }
    .item-calc { font-size: 11.5px; color: #333; text-align: right; }
    .item-calc strong { font-size: 12px; color: #111; }
    /* TOTALS */
    .totals { padding: 2px 0; }
    .total-row {
      display: flex; justify-content: space-between;
      font-size: 12px; margin: 3px 0;
    }
    .total-grand {
      display: flex; justify-content: space-between;
      font-size: 14px; font-weight: 900;
      margin: 6px 0 3px; padding-top: 3px;
      border-top: 1.5px solid #111;
    }
    .total-paid {
      display: flex; justify-content: space-between;
      font-size: 12px; font-weight: 600; margin: 3px 0;
    }
    .neg  { color: #c0392b; }
    .debt-row { color: #c0392b; font-weight: 700; }
    .note-row { font-size: 11px; color: #555; margin: 3px 0; font-style: italic; }
    /* FOOTER */
    .footer { text-align: center; padding-top: 5px; }
    .footer-hotline { font-size: 12.5px; font-weight: 700; margin: 3px 0; }
    .footer-thanks   { font-size: 11.5px; color: #444; margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; }
    td.item-cell { display: block; }
  </style>
</head>
<body>
  <div class="header">
    <div class="store-name">TÁ TIẾN</div>
    <div class="receipt-title">PHIẾU TÍNH TIỀN</div>
    <div class="store-sub">${escapeHtml(storeName)}</div>
  </div>

  <hr class="sep" />

  <div class="meta-row"><span class="meta-label">Mã đơn:</span><span class="meta-value">${escapeHtml(orderNo)}</span></div>
  <div class="meta-row"><span class="meta-label">Ngày:</span><span class="meta-value">${escapeHtml(formatDateTimeVN(createdAt))}</span></div>

  <hr class="sep" />

  <div class="meta-row"><span class="meta-label">Khách:</span><span class="meta-value">${escapeHtml(customerName)}</span></div>
  <div class="meta-row"><span class="meta-label">Điện thoại:</span><span class="meta-value">${escapeHtml(customerPhone)}</span></div>

  <hr class="sep2" />

  <table>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals" style="margin-top:4px">
    <div class="total-row"><span>Tạm tính</span><span>${formatCurrency(subtotal)}</span></div>
    ${discountRow}
    <div class="total-grand"><span>TỔNG CỘNG</span><span>${formatCurrency(total)}</span></div>
  </div>

  <hr class="sep" />

  <div class="totals">
    ${changeRow}
  </div>

  ${noteRow ? `<hr class="sep" />${noteRow}` : ""}

  <hr class="sep" />

  <div class="footer">
    <div class="footer-hotline">Đặt hàng: ${escapeHtml(storePhone)}</div>
    <div class="footer-thanks">Cảm ơn quý khách! Hẹn gặp lại.</div>
  </div>

  <script>
    window.onload = function () {
      window.print();
      setTimeout(function () { window.close(); }, 300);
    };
  </script>
</body>
</html>`;
}

function renderA5DeliveryNoteHtml(order) {
  const orderItems = Array.isArray(order?.items) ? order.items : [];
  const orderNo = order?.orderNo || order?.id || "-";
  const createdAt = order?.createdAt ? new Date(order.createdAt) : new Date();
  const customerName = order?.customer?.name || "Khách lẻ";
  const customerPhone = order?.customer?.phone || "-";
  const customerAddress = order?.customer?.address || "-";
  const note = order?.note || "";
  const totalAmount = Number(
    order?.totalAmount
    || orderItems.reduce((sum, item) => {
      const qty = Number(item?.quantity || 0);
      const unitPrice = Number(item?.unitPrice || 0);
      const discountAmount = Number(item?.discountAmount || 0);
      return sum + Number(item?.totalAmount || qty * unitPrice - discountAmount);
    }, 0)
  );
  const totalAmountInWords = toVietnameseMoneyWords(totalAmount);
  const defaultCopyCount = 2;

  const itemRows = orderItems.map((item, index) => {
    const code = item?.product?.sku || item?.sku || item?.productId || "-";
    const name = item?.product?.name || item?.name || item?.productId || "Sản phẩm";
    const qty = Number(item?.quantity || 0);
    const unit = resolvePrintUnitLabel(item);
    const unitPrice = resolvePrintFinalUnitPrice(item);
    const lineTotal = resolvePrintLineTotal(item);
    return `
      <tr>
        <td class="center cell-fit">${index + 1}</td>
        <td class="cell-code">${escapeHtml(code)}</td>
        <td class="cell-name">${escapeHtml(name)}</td>
        <td class="center cell-fit">${qty}</td>
        <td class="center cell-fit">${escapeHtml(unit)}</td>
        <td class="right cell-fit">${formatCurrency(unitPrice)}</td>
        <td class="right cell-fit">${formatCurrency(lineTotal)}</td>
      </tr>
    `;
  }).join("");

  const singleCopyContent = `
  <div class="copy-head">
    <div class="company">TÁ TIẾN</div>
    <h1 class="title">PHIẾU GIAO HÀNG</h1>
    <p class="subtitle">Mã đơn: <strong>${escapeHtml(orderNo)}</strong> - Ngày: ${escapeHtml(formatDateTimeVN(createdAt))}</p>
  </div>

  <div class="meta">
    <div class="meta-row"><div class="label">Khách hàng:</div><div>${escapeHtml(customerName)}</div></div>
    <div class="meta-row"><div class="label">Số điện thoại:</div><div>${escapeHtml(customerPhone)}</div></div>
    <div class="meta-row"><div class="label">Địa chỉ giao hàng:</div><div>${escapeHtml(customerAddress)}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="cell-fit">STT</th>
        <th class="cell-code">Mã hàng</th>
        <th class="cell-name">Tên hàng hóa, dịch vụ</th>
        <th class="cell-fit">Số lượng</th>
        <th class="cell-fit">ĐVT</th>
        <th class="cell-fit">Đơn giá</th>
        <th class="cell-fit">Thành tiền</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <p class="note"><strong>Số tiền bằng chữ:</strong> ${escapeHtml(totalAmountInWords)}</p>
  <p class="note"><strong>Ghi chú:</strong> ${escapeHtml(note || "Không")}</p>

  <div class="sign">
    <div class="sign-box">
      <p class="sign-role"><strong>Người giao hàng</strong></p>
      <p class="sign-note">(Ký, ghi rõ họ tên)</p>
    </div>
    <div class="sign-box">
      <p class="sign-role"><strong>Người nhận hàng</strong></p>
      <p class="sign-note">(Ký, ghi rõ họ tên)</p>
    </div>
  </div>
  `;

  const copiesHtml = Array.from({ length: defaultCopyCount }, () => (
    `<section class="print-copy">${singleCopyContent}</section>`
  )).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Phiếu giao hàng ${escapeHtml(orderNo)}</title>
  <style>
    @page { size: A5; margin: 5mm; }
    body { font-family: "Times New Roman", serif; color: #111; font-size: 14px; margin: 0; }
    .company { text-align: center; font-size: 24px; font-weight: 700; margin: 0 0 4px; }
    .title { text-align: center; font-size: 24px; font-weight: 700; margin: 0 0 8px; }
    .subtitle { text-align: center; margin: 0 0 16px; }
    .meta { margin-bottom: 12px; }
    .meta-row { display: flex; margin-bottom: 6px; }
    .label { width: 140px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #111; padding: 6px; vertical-align: top; }
    th { text-align: center; }
    .center { text-align: center; }
    .right { text-align: right; white-space: nowrap; }
    .cell-fit { width: 1%; white-space: nowrap; }
    .cell-code { width: 16%; }
    .cell-name { width: auto; }
    .cell-code, .cell-name { word-break: break-word; }
    .note { margin-top: 10px; }
    .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 34px; }
    .sign-box { text-align: center; }
    .sign-box p { margin: 4px 0; }
    .sign-role { margin: 0; }
    .sign-note { margin: 8px 0 0; line-height: 1.25; }
    .print-copy { page-break-after: always; }
    .print-copy:last-child { page-break-after: auto; }
  </style>
</head>
<body>
  ${copiesHtml}

  <script>
    window.onload = function () {
      window.print();
      setTimeout(function () { window.close(); }, 300);
    };
  </script>
</body>
</html>`;
}

function renderA4PaymentNoticeHtml(order) {
  const orderItems = Array.isArray(order?.items) ? order.items : [];
  const orderNo = order?.orderNo || order?.id || "-";
  const createdAt = order?.createdAt ? new Date(order.createdAt) : new Date();
  const customerName = order?.customer?.name || "Khách lẻ";
  const customerPhone = order?.customer?.phone || "-";
  const customerAddress = order?.customer?.address || "-";
  const note = order?.note || "";
  // Tính lại tạm tính: tổng giá gốc các dòng
  const subtotal = Array.isArray(order?.items)
    ? order.items.reduce((sum, item) => sum + Number(item?.unitPrice || 0) * Number(item?.quantity || 0), 0)
    : 0;
  const discount = Number(order?.discountAmount || 0);
  const total = Number(order?.totalAmount || 0);
  const totalAmountInWords = toVietnameseMoneyWords(total);

  const itemRows = orderItems.map((item, index) => {
    const code = item?.product?.sku || item?.sku || item?.productId || "-";
    const name = item?.product?.name || item?.name || item?.productId || "Sản phẩm";
    const qty = Number(item?.quantity || 0);
    const unit = resolvePrintUnitLabel(item);
    const unitPrice = resolvePrintFinalUnitPrice(item);
    const lineTotal = resolvePrintLineTotal(item);
    return `
      <tr>
        <td class="center">${index + 1}</td>
        <td>${escapeHtml(code)}</td>
        <td>${escapeHtml(name)}</td>
        <td class="center">${qty}</td>
        <td class="center">${escapeHtml(unit)}</td>
        <td class="right">${formatCurrency(unitPrice)}</td>
        <td class="right">${formatCurrency(lineTotal)}</td>
      </tr>
    `;
  }).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Phiếu báo tiền ${escapeHtml(orderNo)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: 'Times New Roman', serif; color: #111; font-size: 15px; margin: 0; }
    .invoice-title { text-align: center; font-size: 28px; font-weight: bold; margin: 0 0 12px; letter-spacing: 1px; }
    .info-row { display: flex; justify-content: flex-start; gap: 40px; margin-bottom: 8px; }
    .info-label { min-width: 110px; color: #444; font-weight: 500; }
    .info-value { font-weight: 700; }
    .table-wrap { margin: 18px 0 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #222; padding: 7px 8px; }
    th { background: #f3f4f6; font-size: 15px; }
    .center { text-align: center; }
    .right { text-align: right; white-space: nowrap; }
    .summary-table { float: right; margin-top: 10px; min-width: 320px; }
    .summary-table td { border: none; padding: 5px 8px; font-size: 15px; }
    .summary-table tr.total td { font-weight: bold; font-size: 17px; background: #f3f4f6; }
    .amount-words { margin: 18px 0 8px; font-style: italic; color: #1d4ed8; font-size: 15px; }
    .note { margin: 8px 0 18px; color: #444; }
    .sign-row { display: flex; justify-content: space-between; margin-top: 38px; }
    .sign-box { text-align: center; width: 40%; }
    .sign-box p { margin: 4px 0; }
    .sign-role { margin: 0; }
    .sign-note { margin: 8px 0 0; line-height: 1.25; }
    .sign-space { height: 70px; }
  </style>
</head>
<body>
  <div class="invoice-title">PHIẾU BÁO TIỀN</div>
  <div class="info-row">
    <div><span class="info-label">Mã đơn:</span> <span class="info-value">${escapeHtml(orderNo)}</span></div>
    <div><span class="info-label">Ngày lập:</span> <span class="info-value">${escapeHtml(formatDateTimeVN(createdAt))}</span></div>
  </div>
  <div class="info-row">
    <div><span class="info-label">Khách hàng:</span> <span class="info-value">${escapeHtml(customerName)}</span></div>
    <div><span class="info-label">SĐT:</span> <span class="info-value">${escapeHtml(customerPhone)}</span></div>
  </div>
  <div class="info-row">
    <div><span class="info-label">Địa chỉ:</span> <span class="info-value">${escapeHtml(customerAddress)}</span></div>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th style="width: 40px">STT</th>
          <th style="width: 90px">Mã hàng</th>
          <th style="width: 260px">Tên hàng hóa, dịch vụ</th>
          <th style="width: 70px">Số lượng</th>
          <th style="width: 60px">ĐVT</th>
          <th style="width: 110px">Đơn giá</th>
          <th style="width: 120px">Thành tiền</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
  </div>
  <table class="summary-table">
    <tr><td>Tạm tính</td><td class="right">${formatCurrency(subtotal)}</td></tr>
    <tr><td>Giảm giá</td><td class="right">${formatCurrency(discount)}</td></tr>
    <tr class="total"><td>Tổng thanh toán</td><td class="right">${formatCurrency(total)}</td></tr>
  </table>
  <div style="clear: both"></div>
  <div class="amount-words">Số tiền bằng chữ: <b>${escapeHtml(totalAmountInWords)}</b></div>
  <div class="note">Ghi chú: ${escapeHtml(note || "Không")}</div>
  <div class="sign-row">
    <div class="sign-box">
      <p class="sign-role"><strong>Khách hàng</strong></p>
      <p class="sign-note">(Ký, ghi rõ họ tên)</p>
      <div class="sign-space"></div>
    </div>
    <div class="sign-box">
      <p class="sign-role"><strong>Nhân viên lập phiếu</strong></p>
      <p class="sign-note">(Ký, ghi rõ họ tên)</p>
      <div class="sign-space"></div>
    </div>
  </div>
  <script>
    window.onload = function () {
      window.print();
      setTimeout(function () { window.close(); }, 300);
    };
  </script>
</body>
</html>`;
}

function renderPosA4InvoiceHtml(order) {
  const orderItems = Array.isArray(order?.items) ? order.items : [];
  const customerName = order?.customer?.name || "Khách lẻ";
  const customerPhone = order?.customer?.phone || "-";
  const customerAddress = order?.customer?.address || "-";
  const orderNo = order?.orderNo || order?.id || "-";
  const createdAt = order?.createdAt ? new Date(order.createdAt) : new Date();
  // Tính lại tạm tính: tổng giá gốc các dòng
  const subtotal = Array.isArray(order?.items)
    ? order.items.reduce((sum, item) => sum + Number(item?.unitPrice || 0) * Number(item?.quantity || 0), 0)
    : 0;
  const discount = Number(order?.discountAmount || 0);
  const total = Number(order?.totalAmount || 0);

  const itemRows = orderItems.map((item, index) => {
    const code = item?.product?.sku || item?.sku || item?.productId || "-";
    const name = item?.product?.name || item?.name || item?.productId || "Sản phẩm";
    const qty = Number(item?.quantity || 0);
    const unit = resolvePrintUnitLabel(item);
    const unitPrice = resolvePrintFinalUnitPrice(item);
    const lineTotal = resolvePrintLineTotal(item);
    return `
      <tr>
        <td style="text-align: center; width: 40px;">${index + 1}</td>
        <td style="width: 80px;">${escapeHtml(code)}</td>
        <td>${escapeHtml(name)}</td>
        <td style="text-align: center; width: 60px;">${qty}</td>
        <td style="text-align: center; width: 70px;">${escapeHtml(unit)}</td>
        <td style="text-align: right; width: 100px;">${formatCurrency(unitPrice)}</td>
        <td style="text-align: right; width: 100px;">${formatCurrency(lineTotal)}</td>
      </tr>
    `;
  }).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Hóa đơn bán hàng ${escapeHtml(orderNo)}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: "Times New Roman", serif; color: #000; font-size: 13px; margin: 0; }
    .header { text-align: center; margin-bottom: 20px; }
    .company-name { font-size: 18px; font-weight: 700; margin: 0; }
    .invoice-title { font-size: 20px; font-weight: 700; margin: 8px 0; text-transform: uppercase; }
    .invoice-no { margin-bottom: 16px; font-size: 12px; }
    .customer-section { margin-bottom: 12px; }
    .customer-row { display: flex; margin-bottom: 4px; }
    .customer-label { width: 120px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 12px; margin-top: 12px; }
    th, td { border: 1px solid #000; padding: 6px; font-size: 12px; }
    th { text-align: center; background: #fff; font-weight: 700; }
    .center { text-align: center; }
    .right { text-align: right; }
    .totals-section { width: 300px; margin-left: auto; margin-top: 12px; }
    .totals-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #000; }
    .totals-row.total { font-weight: 700; font-size: 14px; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 6px 0; }
    .sign-section { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 40px; margin-top: 40px; text-align: center; }
    .sign-box { font-size: 12px; }
    .sign-box p { margin: 2px 0; }
    .sign-role { margin: 0; }
    .sign-note { margin: 8px 0 0; line-height: 1.25; }
  </style>
</head>
<body>
  <section class="header">
    <p class="company-name">TÁ TIẾN</p>
    <h1 class="invoice-title">HÓA ĐƠN BÁN HÀNG</h1>
    <div class="invoice-no">
      <p style="margin: 0;">Số HĐ: ${escapeHtml(orderNo)} | Ngày: ${escapeHtml(formatDateTimeVN(createdAt))}</p>
    </div>
  </section>

  <section class="customer-section">
    <div class="customer-row">
      <span class="customer-label"><strong>Khách hàng:</strong></span>
      <span>${escapeHtml(customerName)}</span>
    </div>
    <div class="customer-row">
      <span class="customer-label"><strong>Điện thoại:</strong></span>
      <span>${escapeHtml(customerPhone)}</span>
    </div>
    <div class="customer-row">
      <span class="customer-label"><strong>Địa chỉ:</strong></span>
      <span>${escapeHtml(customerAddress)}</span>
    </div>
  </section>

  <table>
    <thead>
      <tr>
        <th>STT</th>
        <th>Mã hàng</th>
        <th>Tên hàng</th>
        <th>SL</th>
        <th>ĐVT</th>
        <th>Đơn giá</th>
        <th>Thành tiền</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <section class="totals-section">
    <div class="totals-row">
      <span>Tạm tính:</span>
      <span>${formatCurrency(subtotal)}</span>
    </div>
    <div class="totals-row">
      <span>Giảm giá:</span>
      <span>${formatCurrency(discount)}</span>
    </div>
    <div class="totals-row total">
      <span>TỔNG CỘNG:</span>
      <span>${formatCurrency(total)}</span>
    </div>
  </section>

  <section class="sign-section">
    <div class="sign-box">
      <p class="sign-role"><strong>Người bán hàng</strong></p>
      <p class="sign-note">(Ký, ghi rõ họ tên)</p>
      <p style="height: 50px;"></p>
    </div>
    <div class="sign-box">
      <p class="sign-role"><strong>Khách hàng</strong></p>
      <p class="sign-note">(Ký, ghi rõ họ tên)</p>
      <p style="height: 50px;"></p>
    </div>
    <div class="sign-box">
      <p class="sign-role"><strong>Kế toán</strong></p>
      <p class="sign-note">(Ký, ghi rõ họ tên)</p>
      <p style="height: 50px;"></p>
    </div>
  </section>

  <script>
    window.onload = function () {
      window.print();
      setTimeout(function () { window.close(); }, 300);
    };
  </script>
</body>
</html>`;
}

function printOrderByTemplate(order, template) {
  const normalizedTemplate = template || "pos";
  let html = "";
  if (normalizedTemplate === "a5_delivery") {
    html = renderA5DeliveryNoteHtml(order);
  } else if (normalizedTemplate === "a4_notice") {
    html = renderA4PaymentNoticeHtml(order);
  } else if (normalizedTemplate === "a4_invoice") {
    html = renderPosA4InvoiceHtml(order);
  } else {
    html = renderPosReceiptHtml(order);
  }

  const popupWidth = normalizedTemplate === "pos" ? 460 : 980;
  const popupHeight = normalizedTemplate === "pos" ? 760 : 860;
  const popupLeft = Math.max(Math.round((window.screen.width - popupWidth) / 2), 0);
  const popupTop = Math.max(Math.round((window.screen.height - popupHeight) / 2), 0);
  const popupFeatures = [
    "popup=yes",
    `width=${popupWidth}`,
    `height=${popupHeight}`,
    `left=${popupLeft}`,
    `top=${popupTop}`,
    "resizable=yes",
    "scrollbars=yes",
    "toolbar=no",
    "menubar=no",
    "location=no",
    "status=no"
  ].join(",");

  const printWindow = window.open("", `print_order_${Date.now()}`, popupFeatures);
  if (!printWindow) {
    throw new Error("Trình duyệt đang chặn cửa sổ in. Vui lòng cho phép popup.");
  }

  if (typeof printWindow.focus === "function") {
    printWindow.focus();
  }

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

function isServiceProduct(product) {
  return product?.productType === "SERVICE";
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function buildOrderItemsSummary(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!items.length) return "Chưa có chi tiết mặt hàng";

  const normalizedItems = items.map((item) => {
    const qty = Math.max(Number(item?.quantity || 0), 0);
    const name = item?.product?.name || item?.name || item?.product?.sku || item?.sku || "Sản phẩm";
    return { name, qty };
  });

  const totalQty = normalizedItems.reduce((sum, item) => sum + item.qty, 0);
  const head = normalizedItems
    .slice(0, 2)
    .map((item) => `${item.name}${item.qty > 0 ? ` x${formatNumber(item.qty)}` : ""}`)
    .join(", ");

  const remain = normalizedItems.length - 2;
  const remainLabel = remain > 0 ? ` + ${formatNumber(remain)} mặt hàng khác` : "";
  const qtyLabel = totalQty > 0 ? ` (SL: ${formatNumber(totalQty)})` : "";
  return `${head}${remainLabel}${qtyLabel}`;
}

function getOrderPaidAmount(order) {
  const totalAmount = Math.max(Number(order?.totalAmount || 0), 0);
  const debtAmount = Math.max(Number(order?.remainingAmount ?? order?.debtAmount ?? 0), 0);
  const paidFromApi = Number(order?.paidAmount);

  if (Number.isFinite(paidFromApi)) {
    return Math.max(paidFromApi, 0);
  }

  return Math.max(totalAmount - debtAmount, 0);
}

function buildOutstandingOrderSummary(row) {
  const items = Array.isArray(row?.orderItemsSummary) ? row.orderItemsSummary : [];
  if (!items.length) return "-";

  const head = items
    .slice(0, 2)
    .map((item) => {
      const sku = item?.sku || item?.name || "Mặt hàng";
      const qty = Math.max(Number(item?.quantity || 0), 0);
      return qty > 0 ? `${sku} x${formatNumber(qty)}` : sku;
    })
    .join(", ");

  const remain = items.length - 2;
  const remainLabel = remain > 0 ? ` + ${formatNumber(remain)} mặt hàng khác` : "";
  return `${head}${remainLabel}`;
}

function toDateInputValue(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTodayInputValue() {
  return toDateInputValue(new Date());
}

function parseDateOnly(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return new Date(`${value}T00:00:00`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function calcOverdueDays(documentDate, interestDate) {
  const docDate = parseDateOnly(documentDate);
  const targetDate = parseDateOnly(interestDate);
  if (!docDate || !targetDate) return 0;
  const diffMs = targetDate.getTime() - docDate.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

function getInterestModeLabel(includeInterest) {
  return includeInterest
    ? `Có tính lãi (${DAILY_INTEREST_RATE}/ngày)`
    : "Không tính lãi";
}

function sanitizeForFileName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function downloadExcelFromHtml(filename, html) {
  const blob = new Blob([`\ufeff${html}`], {
    type: "application/vnd.ms-excel;charset=utf-8;"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildDebtAgingExcelHtml({ customer, rows, interestDate, totalPrincipal, totalInterest, includeInterest }) {
  const rowHtml = rows.map((row) => `
      <tr>
        <td style="border:1px solid #9ca3af; padding:6px; text-align:center;">${row.index}</td>
        <td style="border:1px solid #9ca3af; padding:6px; text-align:center;">${escapeHtml(row.documentDateLabel)}</td>
        <td style="border:1px solid #9ca3af; padding:6px;">${escapeHtml(row.documentNo)}</td>
        <td style="border:1px solid #9ca3af; padding:6px;">
          <div>${escapeHtml(row.orderSummary || "-")}</div>
          <div style="font-style: italic; color:#0f766e; margin-top:2px;">Đã thanh toán: ${formatCurrency(row.paidAmount)}</div>
        </td>
        <td style="border:1px solid #9ca3af; padding:6px; text-align:right;">${formatCurrency(row.amount)}</td>
        <td style="border:1px solid #9ca3af; padding:6px; text-align:center;">${formatNumber(row.overdueDays)}</td>
        <td style="border:1px solid #9ca3af; padding:6px; text-align:right;">${formatCurrency(row.interestAmount)}</td>
      </tr>
    `).join("");

  const totalPayable = totalPrincipal + totalInterest;
  const interestDateLabel = interestDate ? formatDateVN(`${interestDate}T00:00:00`) : "-";
  const interestModeLabel = getInterestModeLabel(includeInterest);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Bảng kê công nợ còn treo</title>
</head>
<body style="font-family: 'Times New Roman', serif; color: #111827;">
  <h2 style="margin: 0 0 8px;">BẢNG KÊ CÔNG NỢ CÒN TREO</h2>
  <p style="margin: 0 0 4px;"><strong>Khách hàng:</strong> ${escapeHtml(customer?.name || "-")}</p>
  <p style="margin: 0 0 4px;"><strong>Số điện thoại:</strong> ${escapeHtml(customer?.phone || "-")}</p>
  <p style="margin: 0 0 4px;"><strong>Địa chỉ:</strong> ${escapeHtml(customer?.address || "-")}</p>
  <p style="margin: 0 0 4px;"><strong>Ngày tính lãi:</strong> ${escapeHtml(interestDateLabel)}</p>
  <p style="margin: 0 0 10px;"><strong>Tùy chọn lãi:</strong> ${escapeHtml(interestModeLabel)}</p>

  <table cellspacing="0" cellpadding="0" style="border-collapse: collapse; width: 100%;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th style="border:1px solid #9ca3af; padding:6px;">STT</th>
        <th style="border:1px solid #9ca3af; padding:6px;">Ngày chứng từ</th>
        <th style="border:1px solid #9ca3af; padding:6px;">Số chứng từ</th>
        <th style="border:1px solid #9ca3af; padding:6px;">Tóm tắt đơn hàng / Đã thanh toán</th>
        <th style="border:1px solid #9ca3af; padding:6px;">Số tiền</th>
        <th style="border:1px solid #9ca3af; padding:6px;">Số ngày</th>
        <th style="border:1px solid #9ca3af; padding:6px;">Số tiền lãi</th>
      </tr>
    </thead>
    <tbody>
      ${rowHtml || `<tr><td colspan="7" style="border:1px solid #9ca3af; padding:8px; text-align:center;">Không có khoản nợ treo</td></tr>`}
    </tbody>
  </table>

  <div style="margin-top: 10px; width: 360px; margin-left: auto;">
    <table cellspacing="0" cellpadding="0" style="border-collapse: collapse; width: 100%;">
      <tr>
        <td style="border:1px solid #9ca3af; padding:6px;"><strong>Tổng gốc</strong></td>
        <td style="border:1px solid #9ca3af; padding:6px; text-align:right;"><strong>${formatCurrency(totalPrincipal)}</strong></td>
      </tr>
      <tr>
        <td style="border:1px solid #9ca3af; padding:6px;"><strong>Tổng lãi</strong></td>
        <td style="border:1px solid #9ca3af; padding:6px; text-align:right;"><strong>${formatCurrency(totalInterest)}</strong></td>
      </tr>
      <tr>
        <td style="border:1px solid #9ca3af; padding:6px; background:#eff6ff;"><strong>Tổng cộng</strong></td>
        <td style="border:1px solid #9ca3af; padding:6px; text-align:right; background:#eff6ff;"><strong>${formatCurrency(totalPayable)}</strong></td>
      </tr>
    </table>
  </div>
</body>
</html>`;
}

function parseInfoItems(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  return text
    .split(/\n|;|\u2022|\|/g)
    .map((item) => item.replace(/^[-*\s]+/, "").trim())
    .filter(Boolean);
}

function parseLabeledSectionsFromNote(note) {
  const lines = String(note || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sections = {
    ingredients: [],
    benefits: [],
    usage: []
  };

  let current = null;
  lines.forEach((line) => {
    const normalized = normalizeSearchText(line);
    if (normalized.startsWith("thanh phan") || normalized.startsWith("tp") || normalized.startsWith("ingredients")) {
      current = "ingredients";
      const value = line.split(":").slice(1).join(":").trim();
      if (value) sections.ingredients.push(...parseInfoItems(value));
      return;
    }
    if (normalized.startsWith("cong dung") || normalized.startsWith("cd") || normalized.startsWith("benefits")) {
      current = "benefits";
      const value = line.split(":").slice(1).join(":").trim();
      if (value) sections.benefits.push(...parseInfoItems(value));
      return;
    }
    if (normalized.startsWith("huong dan su dung") || normalized.startsWith("hdsd") || normalized.startsWith("cach dung") || normalized.startsWith("usage")) {
      current = "usage";
      const value = line.split(":").slice(1).join(":").trim();
      if (value) sections.usage.push(...parseInfoItems(value));
      return;
    }

    if (current) {
      sections[current].push(...parseInfoItems(line));
    }
  });

  return sections;
}

function getProductConsultationData(product) {
  const noteSections = parseLabeledSectionsFromNote(product?.supplierQuoteNote || "");

  const ingredients = [
    ...parseInfoItems(product?.ingredients),
    ...parseInfoItems(product?.composition),
    ...parseInfoItems(product?.activeIngredients),
    ...noteSections.ingredients
  ];
  const benefits = [
    ...parseInfoItems(product?.benefits),
    ...parseInfoItems(product?.usageBenefits),
    ...parseInfoItems(product?.indications),
    ...parseInfoItems(product?.effect),
    ...noteSections.benefits
  ];
  const usage = [
    ...parseInfoItems(product?.usageGuide),
    ...parseInfoItems(product?.instructions),
    ...parseInfoItems(product?.howToUse),
    ...parseInfoItems(product?.dosage),
    ...noteSections.usage
  ];

  return {
    ingredients: Array.from(new Set(ingredients)),
    benefits: Array.from(new Set(benefits)),
    usage: Array.from(new Set(usage))
  };
}

function buildConsultQuickScript(product, sections) {
  const name = product?.name || "Sản phẩm";
  const sku = product?.sku ? `[${product.sku}]` : "";
  const unit = product?.unit ? `Đơn vị: ${product.unit}.` : "";
  const price = Number(product?.defaultPrice || 0);
  const priceLabel = price > 0 ? `Đơn giá: ${formatCurrency(price)}.` : "";

  const ingredientList = sections.ingredients.length
    ? sections.ingredients.slice(0, 3).join(", ")
    : "";
  const ingredientLine = ingredientList ? `Thành phần chính: ${ingredientList}.` : "";

  const benefitList = sections.benefits.length
    ? sections.benefits.slice(0, 3).join("; ")
    : "hỗ trợ nhu cầu sử dụng hằng ngày";
  const benefitLine = `Công dụng: ${benefitList}.`;

  const usageList = sections.usage.length
    ? sections.usage.slice(0, 2).join("; ")
    : "Dùng theo hướng dẫn trên bao bì";
  const usageLine = `Hướng dẫn sử dụng: ${usageList}.`;

  return [sku && name ? `${sku} ${name}` : name, unit, priceLabel, ingredientLine, benefitLine, usageLine]
    .filter(Boolean)
    .join(" ");
}

function formatPromotionType(type) {
  const raw = String(type || "").toUpperCase();
  if (raw === "BUY_X_GET_Y") return "Mua X tặng Y";
  if (raw === "DISCOUNT") return "Giảm giá";
  return raw || "-";
}

function getCustomerPromotionTier(customer) {
  const tier = String(customer?.customerPriceTier || "").toUpperCase();
  if (tier === "LEVEL_2" || tier === "LEVEL_2_SPECIAL") return tier;
  return "RETAIL";
}

function promotionMatchesCustomerTier(promotion, customerTier) {
  const requiredTier = String(promotion?.customerTier || "ALL").toUpperCase();
  if (requiredTier === "ALL") return true;
  return requiredTier === customerTier;
}

function getProductPromotionPrice(product) {
  return Number(product?.promoPrice ?? 0);
}

function isPromotionActive(promotion, now = new Date()) {
  if (!promotion || promotion.isActive === false) return false;
  const startDate = toValidDate(promotion.startDate);
  const endDate = toValidDate(promotion.endDate);
  if (!startDate || !endDate) return false;
  return now >= startDate && now <= endDate;
}

function toValidDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function validateCustomerInfoForm(form) {
  const errors = {};
  const name = String(form?.name || "").trim();
  const email = String(form?.email || "").trim();

  if (name.length < 2) {
    errors.name = "Tên khách hàng cần tối thiểu 2 ký tự.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Email không đúng định dạng.";
  }

  for (const field of ["phone", "phone2", "phone3"]) {
    const value = String(form?.[field] || "").trim();
    if (value && value.length < 8) {
      errors[field] = "Số điện thoại cần tối thiểu 8 ký tự.";
    }
  }

  return errors;
}

export default function PosScreen({
  customers = [],
  businessAreas = [],
  staffUsers = [],
  products = [],
  inventory = [],
  orders = [],
  onLoadOrders,
  onReloadData,
  activeStoreId,
  onCreateOrder,
  onCreateReceipt,
  onLoadCustomerAging,
  onLoadCustomerOverview,
  onLoadCustomerPriceList,
  onUpdateCustomerPriceList,
  onDeleteCustomerPriceList,
  onLoadCustomerNotes,
  onCreateCustomerNote,
  onUpdateCustomerInfo,
  onLoadMarketingCustomAudiences,
  onLoadMarketingCustomAudienceById,
  onAddMarketingAudienceCustomer,
  onRemoveMarketingAudienceCustomer,
  canEditCustomerInfo = false,
  onLoadProductInventoryHistory,
  onLoadGiftRedemptions,
  onCreateGiftRedemption,
  onCancelGiftRedemption,
  promotions = [],
  onNavigate = null
}) {
  const [keyword, setKeyword] = useState("");
  const [showProductList, setShowProductList] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [cart, setCart] = useState([]);
  const [customerPrices, setCustomerPrices] = useState({});
  const [loadingPriceList, setLoadingPriceList] = useState(false);
  const [showPriceDialog, setShowPriceDialog] = useState(false);
  const [pricePanelLoading, setPricePanelLoading] = useState(false);
  const [priceDialogRows, setPriceDialogRows] = useState([]);
  const [priceDialogFilter, setPriceDialogFilter] = useState("");
  const [priceForm, setPriceForm] = useState({ productId: "", price: 0 });
  const [deletingPriceRowId, setDeletingPriceRowId] = useState("");
  const [showCopyPricePanel, setShowCopyPricePanel] = useState(false);
  const [copySourceCustomerId, setCopySourceCustomerId] = useState("");
  const [payment, setPayment] = useState({
    paymentMethod: "CASH",
    paidAmount: 0,
    discountAmount: 0,
    note: ""
  });
  const [isPaidAmountManual, setIsPaidAmountManual] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [showPrintTemplatePicker, setShowPrintTemplatePicker] = useState(false);
  const [selectedPrintTemplate, setSelectedPrintTemplate] = useState("pos");
  const [createdOrderForPrint, setCreatedOrderForPrint] = useState(null);
  const [notification, setNotification] = useState({ message: "", type: "", visible: false });
  const [showQuickReceiptDialog, setShowQuickReceiptDialog] = useState(false);
  const [isSubmittingQuickReceipt, setIsSubmittingQuickReceipt] = useState(false);
  const [loadingQuickReceiptOrders, setLoadingQuickReceiptOrders] = useState(false);
  const [quickReceipt, setQuickReceipt] = useState({
    amount: 0,
    discountAmount: 0,
    note: ""
  });
  const [showCustomerNotesDialog, setShowCustomerNotesDialog] = useState(false);
  const [customerNotes, setCustomerNotes] = useState([]);
  const [loadingCustomerNotes, setLoadingCustomerNotes] = useState(false);
  const [loadingPinnedCustomerNote, setLoadingPinnedCustomerNote] = useState(false);
  const [creatingCustomerNote, setCreatingCustomerNote] = useState(false);
  const [customerNoteForm, setCustomerNoteForm] = useState({
    content: "",
    isStarred: false
  });
  const [showEditCustomerDialog, setShowEditCustomerDialog] = useState(false);
  const [savingCustomerInfo, setSavingCustomerInfo] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: "",
    ledgerCode: "",
    phone: "",
    phone2: "",
    phone3: "",
    email: "",
    address: "",
    accountOwnerPositionId: "",
    businessAreaId: "",
    customerPriceTier: ""
  });
  const [customerFormErrors, setCustomerFormErrors] = useState({});
  const [customerFormMessage, setCustomerFormMessage] = useState("");
  const [quickReceiptSelectedOrderIds, setQuickReceiptSelectedOrderIds] = useState([]);
  const [quickReceiptCustomerId, setQuickReceiptCustomerId] = useState("");
  const [quickReceiptCustomerSnapshot, setQuickReceiptCustomerSnapshot] = useState(null);
  const [quickReceiptOrdersSnapshot, setQuickReceiptOrdersSnapshot] = useState(null);
  const [showDebtExportDialog, setShowDebtExportDialog] = useState(false);
  const [debtExportLoading, setDebtExportLoading] = useState(false);
  const [debtExportDate, setDebtExportDate] = useState(getTodayInputValue());
  const [debtIncludeInterest, setDebtIncludeInterest] = useState(true);
  const [debtOutstandingRows, setDebtOutstandingRows] = useState([]);

  const [showCustomerOverviewDialog, setShowCustomerOverviewDialog] = useState(false);
  const [customerOverviewLoading, setCustomerOverviewLoading] = useState(false);
  const [customerOverviewData, setCustomerOverviewData] = useState(null);
  const [customerOverviewPreset, setCustomerOverviewPreset] = useState("this-month");
  const [consultProductId, setConsultProductId] = useState(null);
  const [showStockHistoryDialog, setShowStockHistoryDialog] = useState(false);
  const [stockHistoryLoading, setStockHistoryLoading] = useState(false);
  const [stockHistoryProduct, setStockHistoryProduct] = useState(null);
  const [stockHistorySummary, setStockHistorySummary] = useState({ totalIn: 0, totalOut: 0, netChange: 0 });
  const [stockHistoryRows, setStockHistoryRows] = useState([]);
  const [stockHistoryFilters, setStockHistoryFilters] = useState(() => {
    const today = getTodayInputValue();
    return {
      customerKeyword: "",
      movementType: "ALL",
      dateFrom: today,
      dateTo: today
    };
  });
  const [showFacebookAudienceDialog, setShowFacebookAudienceDialog] = useState(false);
  const [facebookAudiences, setFacebookAudiences] = useState([]);
  const [facebookAudienceLoading, setFacebookAudienceLoading] = useState(false);
  const [facebookAudienceSavingId, setFacebookAudienceSavingId] = useState("");
  const [facebookAudienceMessage, setFacebookAudienceMessage] = useState("");
  const [facebookAudienceSearch, setFacebookAudienceSearch] = useState("");
  const [facebookAudienceOnlyMember, setFacebookAudienceOnlyMember] = useState(false);

  // Ref để tránh stale closure khi khôi phục query lúc onBlur
  const selectedCustomerIdRef = useRef(selectedCustomerId);
  useEffect(() => {
    selectedCustomerIdRef.current = selectedCustomerId;
  }, [selectedCustomerId]);

  const [showCustomerMenu, setShowCustomerMenu] = useState(false);
  const customerMenuRef = useRef(null);
  useEffect(() => {
    if (!showCustomerMenu) return;
    const handleOutside = (e) => {
      if (customerMenuRef.current && !customerMenuRef.current.contains(e.target)) {
        setShowCustomerMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [showCustomerMenu]);

  // Gift dialog state
  const [showGiftDialog, setShowGiftDialog] = useState(false);
  const [giftDialogLoading, setGiftDialogLoading] = useState(false);
  const [giftHistory, setGiftHistory] = useState([]);
  const [giftProductSearch, setGiftProductSearch] = useState("");
  const [giftSelectedProduct, setGiftSelectedProduct] = useState(null);
  const [giftQuantity, setGiftQuantity] = useState(1);
  const [giftNote, setGiftNote] = useState("");
  const [giftSubmitting, setGiftSubmitting] = useState(false);
  const [giftCancelling, setGiftCancelling] = useState(null);
  const [giftMessage, setGiftMessage] = useState({ text: "", type: "" });
  const [giftCurrentPoints, setGiftCurrentPoints] = useState(null);

  const showNotification = (message, type = "success") => {
    setNotification({ message, type, visible: true });
    const timer = setTimeout(() => {
      setNotification((prev) => ({ ...prev, visible: false }));
    }, 4000);
    return () => clearTimeout(timer);
  };

  const formatMoney = (value) => formatMoneyInput(value);
  const parseMoneyInput = (value) => {
    const digitsOnly = String(value ?? "").replace(/[^\d]/g, "");
    return digitsOnly ? Number(digitsOnly) : 0;
  };

  const inventoryMap = useMemo(() => {
    const map = new Map();
    inventory.forEach((row) => {
      if (!row?.productId) return;
      map.set(row.productId, {
        stock: Number(row.quantity || 0),
        reserved: Number(row.reservedQuantity || 0),
        available: Number(row.availableQuantity || 0)
      });
    });
    return map;
  }, [inventory]);

  const recentCustomerProductOptions = useMemo(() => {
    if (!selectedCustomerId) return [];

    const latestOrderAtByProductId = new Map();
    for (const order of orders || []) {
      if (order?.customerId !== selectedCustomerId) continue;
      const status = String(order?.status || "").toUpperCase();
      if (["CANCELLED", "REFUNDED"].includes(status)) continue;

      const createdAt = new Date(order?.createdAt || 0).getTime();
      if (Number.isNaN(createdAt)) continue;

      const items = Array.isArray(order?.items) ? order.items : [];
      for (const item of items) {
        const productId = item?.productId || item?.product?.id;
        if (!productId) continue;
        const prev = latestOrderAtByProductId.get(productId) || 0;
        if (createdAt > prev) {
          latestOrderAtByProductId.set(productId, createdAt);
        }
      }
    }

    if (!latestOrderAtByProductId.size) return [];

    const productById = new Map((products || []).map((product) => [product.id, product]));
    return Array.from(latestOrderAtByProductId.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([productId]) => productById.get(productId))
      .filter(Boolean)
      .map((product) => {
        const inv = inventoryMap.get(product.id) || { stock: 0, reserved: 0, available: 0 };
        return {
          ...product,
          stock: inv.stock,
          reservedQuantity: inv.reserved,
          availableQuantity: inv.available
        };
      })
      .slice(0, 12);
  }, [inventoryMap, orders, products, selectedCustomerId]);

  const productOptions = useMemo(() => {
    const term = keyword.trim().toLowerCase();
    if (!term) {
      return recentCustomerProductOptions;
    }

    return products
      .filter((p) => {
        const name = (p.name || "").toLowerCase();
        const sku = (p.sku || "").toLowerCase();
        const unit = (p.unit || "").toLowerCase();
        return name.includes(term) || sku.includes(term) || unit.includes(term);
      })
      .map((p) => {
        const inv = inventoryMap.get(p.id) || { stock: 0, reserved: 0, available: 0 };
        return {
          ...p,
          stock: inv.stock,
          reservedQuantity: inv.reserved,
          availableQuantity: inv.available
        };
      })
      .sort((a, b) => {
        if (isServiceProduct(a) && !isServiceProduct(b)) return 1;
        if (!isServiceProduct(a) && isServiceProduct(b)) return -1;
        const stockDiff = Number(b.availableQuantity || 0) - Number(a.availableQuantity || 0);
        if (stockDiff !== 0) return stockDiff;
        return (a.name || "").localeCompare(b.name || "", "vi");
      })
      .slice(0, 12);
  }, [keyword, products, inventoryMap, recentCustomerProductOptions]);

  const giftSearchResults = useMemo(() => {
    const term = giftProductSearch.trim().toLowerCase();
    if (!term) return [];

    return products
      .filter((p) => {
        const hasPoints = (Number(p.rewardPoints || 0) > 0) || (Number(p.giftPointsCost || 0) > 0);
        if (!hasPoints) return false;
        const name = (p.name || "").toLowerCase();
        const sku = (p.sku || "").toLowerCase();
        return name.includes(term) || sku.includes(term);
      })
      .map((p) => {
        const inv = inventoryMap.get(p.id) || { stock: 0, reserved: 0, available: 0 };
        const availableQuantity = Number(inv.available || 0);
        const service = isServiceProduct(p);
        return {
          ...p,
          availableQuantity,
          isOutOfStock: !service && availableQuantity <= 0
        };
      })
      .sort((a, b) => {
        if (isServiceProduct(a) && !isServiceProduct(b)) return 1;
        if (!isServiceProduct(a) && isServiceProduct(b)) return -1;
        return Number(b.availableQuantity || 0) - Number(a.availableQuantity || 0);
      })
      .slice(0, 20);
  }, [giftProductSearch, inventoryMap, products]);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId) || null;
  }, [selectedCustomerId, customers]);

  const giftPointsValue = giftCurrentPoints ?? selectedCustomer?.rewardPoints ?? null;
  const giftPointsNegative = Number(giftPointsValue || 0) < 0;

  const formatCustomerQuery = (customer) => {
    if (!customer) return "";
    const phoneLabel = customer.phone || "Không có số điện thoại";
    return `${customer.name} - ${phoneLabel}`;
  };

  const retailCustomer = useMemo(() => {
    if (!customers.length) return null;

    const byName = customers.find((customer) => {
      const normalizedName = normalizeSearchText(customer?.name);
      return normalizedName === "khach le" || normalizedName.includes("khach le");
    });
    if (byName) return byName;

    return customers.find((customer) => {
      const normalizedCode = normalizeSearchText(customer?.code);
      return normalizedCode === "retail" || normalizedCode === "guest";
    }) || null;
  }, [customers]);

  const prioritizedCustomers = useMemo(() => {
    if (!customers.length) return [];

    const isRetailLike = (customer) => {
      const normalizedName = normalizeSearchText(customer?.name);
      const normalizedCode = normalizeSearchText(customer?.code);
      return normalizedName === "khach le"
        || normalizedName.includes("khach le")
        || normalizedCode === "retail"
        || normalizedCode === "guest";
    };

    const isSplitRetailLike = (customer) => {
      const normalizedName = normalizeSearchText(customer?.name);
      const normalizedCode = normalizeSearchText(customer?.code);
      return normalizedName === "boc le"
        || normalizedName.includes("boc le")
        || normalizedCode === "boc-le"
        || normalizedCode === "boc_le"
        || normalizedCode === "bocle";
    };

    const selected = [];
    const retail = customers.find(isRetailLike);
    const splitRetail = customers.find((customer) => {
      if (retail && customer.id === retail.id) return false;
      return isSplitRetailLike(customer);
    });

    if (retail) selected.push(retail);
    if (splitRetail) selected.push(splitRetail);
    return selected;
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const term = normalizeSearchText(customerQuery);
    const maxVisibleCustomers = 50;
    if (!term) {
      const prioritizedIds = new Set(prioritizedCustomers.map((customer) => customer.id));
      const restCustomers = customers.filter((customer) => !prioritizedIds.has(customer.id));
      return [...prioritizedCustomers, ...restCustomers].slice(0, maxVisibleCustomers);
    }

    return customers
      .map((c) => {
        const name = normalizeSearchText(c.name);
        const phone = normalizeSearchText(c.phone);
        const code = normalizeSearchText(c.code);
        const matched = name.includes(term) || phone.includes(term) || code.includes(term);
        if (!matched) return null;

        const exact = Number(name === term || code === term || phone === term);
        const startsWith = Number(name.startsWith(term) || code.startsWith(term) || phone.startsWith(term));
        return { customer: c, exact, startsWith };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (b.exact !== a.exact) return b.exact - a.exact;
        if (b.startsWith !== a.startsWith) return b.startsWith - a.startsWith;
        return 0;
      })
      .map((entry) => entry.customer)
      .slice(0, maxVisibleCustomers);
  }, [customerQuery, customers, prioritizedCustomers]);

  const positionOptions = useMemo(() => {
    const byId = new Map();
    customers.forEach((customer) => {
      if (!customer?.accountOwnerPositionId || byId.has(customer.accountOwnerPositionId)) return;
      byId.set(customer.accountOwnerPositionId, {
        id: customer.accountOwnerPositionId,
        label: customer.accountOwnerPosition?.name || customer.accountOwnerPosition?.code || customer.accountOwnerPositionId
      });
    });

    return Array.from(byId.values());
  }, [customers]);

  const getQuickReceiptOrderDebt = (order) => Math.max(Number(order?.remainingAmount ?? order?.debtAmount ?? 0), 0);
  const normalizeEntityId = (value) => String(value || "").trim();

  const quickReceiptOrderSource = useMemo(() => {
    const merged = new Map();

    const append = (rows) => {
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        const id = normalizeEntityId(row?.id);
        if (!id) continue;
        const prev = merged.get(id);
        merged.set(id, prev ? { ...prev, ...row } : row);
      }
    };

    append(orders);
    append(quickReceiptOrdersSnapshot);

    return Array.from(merged.values());
  }, [orders, quickReceiptOrdersSnapshot]);
  const activeQuickReceiptCustomerId = quickReceiptCustomerId || selectedCustomerId;

  const quickReceiptDebtOrders = useMemo(() => {
    const activeCustomerId = normalizeEntityId(activeQuickReceiptCustomerId);
    const activeCustomerName = normalizeSearchText(quickReceiptCustomerSnapshot?.name || selectedCustomer?.name || "");
    const activeCustomerPhone = String(quickReceiptCustomerSnapshot?.phone || selectedCustomer?.phone || "").replace(/\D/g, "");
    if (!activeCustomerId) return [];
    return quickReceiptOrderSource
      .filter((order) => {
        const orderCustomerId = normalizeEntityId(order?.customerId ?? order?.customer?.id);
        const orderCustomerName = normalizeSearchText(order?.customer?.name || "");
        const orderCustomerPhone = String(order?.customer?.phone || "").replace(/\D/g, "");
        const matchedById = Boolean(orderCustomerId && orderCustomerId === activeCustomerId);
        const matchedByIdentity = Boolean(
          !matchedById
          && activeCustomerName
          && orderCustomerName
          && activeCustomerName === orderCustomerName
          && (!activeCustomerPhone || !orderCustomerPhone || activeCustomerPhone === orderCustomerPhone)
        );
        if (!matchedById && !matchedByIdentity) return false;
        if (getQuickReceiptOrderDebt(order) <= 0) return false;
        const status = String(order.status || "").trim().toUpperCase();
        return !["DRAFT", "CANCELLED", "REFUNDED"].includes(status);
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [
    activeQuickReceiptCustomerId,
    quickReceiptCustomerSnapshot?.name,
    quickReceiptCustomerSnapshot?.phone,
    quickReceiptOrderSource,
    selectedCustomer?.name,
    selectedCustomer?.phone
  ]);

  const quickReceiptSelectedDebt = useMemo(() => {
    return quickReceiptDebtOrders
      .filter((order) => quickReceiptSelectedOrderIds.includes(order.id))
      .reduce((sum, order) => sum + getQuickReceiptOrderDebt(order), 0);
  }, [quickReceiptDebtOrders, quickReceiptSelectedOrderIds]);

  const debtExportRows = useMemo(() => {
    return debtOutstandingRows.map((row, index) => {
      const amount = Math.max(Number(row.remainingAmount || 0), 0);
      const documentDateRaw = row.documentDate || row.createdAt;
      const overdueDays = calcOverdueDays(documentDateRaw, debtExportDate);
      const rawInterest = debtIncludeInterest ? (amount * DAILY_INTEREST_RATE * overdueDays) : 0;
      const interestAmount = Math.max(Number(rawInterest || 0), 0);
      const documentNo = row.transactionType === "OPENING_BALANCE"
        ? "Số dư đầu kỳ"
        : (row.documentNo || row.referenceId || "-");
      const orderSummary = buildOutstandingOrderSummary(row);
      const paidAmount = Math.max(Number(row.settledAmount ?? row.paidAmount ?? 0), 0);
      return {
        index: index + 1,
        referenceId: row.referenceId,
        documentNo,
        orderSummary,
        paidAmount,
        documentDateLabel: documentDateRaw ? formatDateVN(documentDateRaw) : "-",
        amount,
        overdueDays,
        interestAmount
      };
    });
  }, [debtOutstandingRows, debtExportDate, debtIncludeInterest]);

  const debtExportTotals = useMemo(() => {
    const principal = debtExportRows.reduce((sum, row) => sum + row.amount, 0);
    const interest = debtExportRows.reduce((sum, row) => sum + row.interestAmount, 0);
    return {
      principal,
      interest,
      payable: principal + interest
    };
  }, [debtExportRows]);

  const latestStarredCustomerNote = useMemo(() => {
    const starred = customerNotes
      .filter((note) => note?.isStarred)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return starred[0] || null;
  }, [customerNotes]);

  const productMap = useMemo(() => {
    return new Map(products.map((product) => [product.id, product]));
  }, [products]);

  const consultProduct = useMemo(() => {
    if (!consultProductId) return null;
    const fromCatalog = productMap.get(consultProductId);
    if (fromCatalog) return fromCatalog;
    const fromCart = cart.find((item) => item.productId === consultProductId);
    return fromCart || null;
  }, [consultProductId, productMap, cart]);

  const consultSections = useMemo(() => {
    if (!consultProduct) {
      return { ingredients: [], benefits: [], usage: [] };
    }
    return getProductConsultationData(consultProduct);
  }, [consultProduct]);

  const consultPromotionDetails = useMemo(() => {
    if (!consultProduct?.id) return [];
    const now = new Date();

    return promotions
      .filter((promo) => promo?.triggerProductId === consultProduct.id || promo?.rewardProductId === consultProduct.id)
      .map((promo) => {
        const startDate = toValidDate(promo.startDate);
        const endDate = toValidDate(promo.endDate);
        const isDateActive = Boolean(startDate && endDate && now >= startDate && now <= endDate);
        const isEnabled = promo.isActive !== false;
        const status = isEnabled && isDateActive
          ? "Đang áp dụng"
          : (isEnabled ? "Chưa/đã hết hạn" : "Đang tắt");

        const triggerName = promo.triggerProductId === consultProduct.id
          ? `${consultProduct.name || "Sản phẩm đang xem"} (sản phẩm điều kiện)`
          : (productMap.get(promo.triggerProductId)?.name || promo.triggerProductId || "-");
        const rewardName = promo.rewardProductId === consultProduct.id
          ? `${consultProduct.name || "Sản phẩm đang xem"} (sản phẩm quà tặng)`
          : (productMap.get(promo.rewardProductId)?.name || promo.rewardProductId || "Không có");

        return {
          id: promo.id || `${promo.name || "promo"}-${promo.triggerProductId || "x"}-${promo.rewardProductId || "y"}`,
          name: promo.name || "Chương trình khuyến mãi",
          typeLabel: formatPromotionType(promo.type),
          triggerName,
          triggerQty: Number(promo.triggerQty || 1),
          rewardName,
          rewardQty: Number(promo.rewardQty || 0),
          startDateLabel: startDate ? formatDateVN(startDate) : "-",
          endDateLabel: endDate ? formatDateVN(endDate) : "-",
          status,
          statusClass: isEnabled && isDateActive ? "is-active" : (isEnabled ? "is-expired" : "is-disabled")
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "vi"));
  }, [consultProduct, promotions, productMap]);

  const filteredStockHistoryRows = useMemo(() => {
    const customerKeyword = normalizeSearchText(stockHistoryFilters.customerKeyword);
    return stockHistoryRows.filter((row) => {
      const actor = normalizeSearchText(row.actorName || "");
      const rowDate = toDateInputValue(row.happenedAt);

      const matchCustomer = !customerKeyword || actor.includes(customerKeyword);
      const matchType = stockHistoryFilters.movementType === "ALL" || row.movementType === stockHistoryFilters.movementType;
      const matchFrom = !stockHistoryFilters.dateFrom || (rowDate && rowDate >= stockHistoryFilters.dateFrom);
      const matchTo = !stockHistoryFilters.dateTo || (rowDate && rowDate <= stockHistoryFilters.dateTo);

      return matchCustomer && matchType && matchFrom && matchTo;
    });
  }, [stockHistoryRows, stockHistoryFilters]);

  const filteredStockHistorySummary = useMemo(() => {
    const totalIn = filteredStockHistoryRows
      .filter((row) => row.movementType === "IN")
      .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const totalOut = filteredStockHistoryRows
      .filter((row) => row.movementType === "OUT")
      .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    return {
      totalIn,
      totalOut,
      netChange: totalIn - totalOut
    };
  }, [filteredStockHistoryRows]);

  // --- Quà tặng từ chương trình khuyến mại (derived, không lưu trong cart) ---
  const giftItems = useMemo(() => {
    const gifts = [];
    const now = new Date();
    const selectedPromotionTier = getCustomerPromotionTier(selectedCustomer);
    for (const promo of promotions) {
      if (String(promo?.type || "").toUpperCase() !== "BUY_X_GET_Y") continue;
      if (!promo.rewardProductId) continue;
      if (!isPromotionActive(promo, now)) continue;
      if (!promotionMatchesCustomerTier(promo, selectedPromotionTier)) continue;
      const triggerItem = cart.find((i) => i.productId === promo.triggerProductId && !i.isGift);
      if (!triggerItem || triggerItem.quantity < promo.triggerQty) continue;
      const rewardProduct = productMap.get(promo.rewardProductId);
      if (!rewardProduct) continue;
      gifts.push({
        productId: promo.rewardProductId,
        sku: rewardProduct.sku || "",
        name: rewardProduct.name,
        quantity: promo.rewardQty || 1,
        unitPrice: 0,
        discountAmount: 0,
        isGift: true,
        promoName: promo.name,
        usesCustomPrice: false,
        isUnitPriceManual: false
      });
    }
    return gifts;
  }, [cart, promotions, productMap, selectedCustomer]);

  const effectiveCart = useMemo(() => {
    const now = new Date();
    const selectedPromotionTier = getCustomerPromotionTier(selectedCustomer);
    return cart.map((item) => {
      if (item.isGift || item.isUnitPriceManual) {
        return {
          ...item,
          effectiveDiscountAmount: Number(item.discountAmount || 0),
          effectiveLineTotal: Math.max(item.quantity * item.unitPrice - Number(item.discountAmount || 0), 0),
          appliedPromotionName: ""
        };
      }

      const matchedPromotion = promotions.find((promo) => {
        return String(promo?.type || "").toUpperCase() === "DISCOUNT"
          && promo.triggerProductId === item.productId
          && Number(item.quantity || 0) >= Number(promo.triggerQty || 1)
          && isPromotionActive(promo, now)
          && promotionMatchesCustomerTier(promo, selectedPromotionTier);
      });

      if (!matchedPromotion) {
        return {
          ...item,
          effectiveDiscountAmount: Number(item.discountAmount || 0),
          effectiveLineTotal: Math.max(item.quantity * item.unitPrice - Number(item.discountAmount || 0), 0),
          appliedPromotionName: ""
        };
      }

      const product = productMap.get(item.productId);
      const promotionPrice = getProductPromotionPrice(product);
      const currentUnitPrice = Number(item.unitPrice || 0);
      if (!(promotionPrice > 0) || promotionPrice >= currentUnitPrice) {
        return {
          ...item,
          effectiveDiscountAmount: Number(item.discountAmount || 0),
          effectiveLineTotal: Math.max(item.quantity * item.unitPrice - Number(item.discountAmount || 0), 0),
          appliedPromotionName: ""
        };
      }

      const promoDiscount = (currentUnitPrice - promotionPrice) * Number(item.quantity || 0);
      const effectiveDiscountAmount = Math.max(Number(item.discountAmount || 0) + promoDiscount, 0);
      const effectiveLineTotal = Math.max(Number(item.quantity || 0) * currentUnitPrice - effectiveDiscountAmount, 0);

      return {
        ...item,
        effectiveDiscountAmount,
        effectiveLineTotal,
        appliedPromotionName: matchedPromotion.name || "Khuyến mại giảm giá",
        appliedPromotionSpecialPrice: promotionPrice
      };
    });
  }, [cart, productMap, promotions, selectedCustomer]);

  // --- Điểm thưởng ước tính ---
  const totalRewardPoints = useMemo(() => {
    return cart.reduce((sum, item) => {
      if (item.isGift) return sum;
      const product = productMap.get(item.productId);
      return sum + (Number(product?.rewardPoints) || 0) * item.quantity;
    }, 0);
  }, [cart, productMap]);

  // --- Cảnh báo vượt tồn kho ---
  const stockWarnings = useMemo(() => {
    return cart
      .filter((item) => {
        if (item.isGift) return false;
        const product = productMap.get(item.productId);
        if (isServiceProduct(product)) return false;
        const inv = inventoryMap.get(item.productId);
        return item.quantity > (inv?.available ?? 0);
      })
      .map((item) => item.name);
  }, [cart, inventoryMap]);

  const resolveCustomerPrice = (product) => {
    const customPrice = customerPrices[product.id];
    if (customPrice !== undefined) {
      return { unitPrice: Number(customPrice || 0), source: "CUSTOM" };
    }

    const defaultPrice = Number(product?.salePrice ?? product?.defaultPrice ?? 0);
    const level2Price = Number(product?.priceLevel2 ?? product?.level2Price ?? 0);
    const level2SpecialPrice = Number(product?.priceLevel2Special ?? product?.level2SpecialPrice ?? 0);
    const tier = selectedCustomer?.customerPriceTier;

    if (tier === "LEVEL_2_SPECIAL") {
      const unitPrice = level2SpecialPrice > 0
        ? level2SpecialPrice
        : (level2Price > 0 ? level2Price : defaultPrice);
      return { unitPrice, source: unitPrice === defaultPrice ? "DEFAULT" : "TIER" };
    }

    if (tier === "LEVEL_2") {
      const unitPrice = level2Price > 0 ? level2Price : defaultPrice;
      return { unitPrice, source: unitPrice === defaultPrice ? "DEFAULT" : "TIER" };
    }

    return { unitPrice: defaultPrice, source: "DEFAULT" };
  };

  useEffect(() => {
    let cancelled = false;

    const loadPrices = async () => {
      if (!selectedCustomer?.id || !onLoadCustomerPriceList) {
        setCustomerPrices({});
        return;
      }

      try {
        setLoadingPriceList(true);
        const rows = await onLoadCustomerPriceList(selectedCustomer.id);
        if (cancelled) return;

        const nextMap = {};
        rows.forEach((row) => {
          nextMap[row.productId] = Number(row.price);
        });
        setCustomerPrices(nextMap);
      } catch (_error) {
        if (!cancelled) {
          setCustomerPrices({});
        }
      } finally {
        if (!cancelled) {
          setLoadingPriceList(false);
        }
      }
    };

    loadPrices();

    return () => {
      cancelled = true;
    };
  }, [selectedCustomer?.id, onLoadCustomerPriceList]);

  useEffect(() => {
    let cancelled = false;

    const loadPinnedNote = async () => {
      if (!selectedCustomer?.id || !onLoadCustomerNotes) {
        setCustomerNotes([]);
        return;
      }

      try {
        setLoadingPinnedCustomerNote(true);
        const rows = await Promise.resolve(onLoadCustomerNotes(selectedCustomer.id));
        if (cancelled) return;
        setCustomerNotes(rows || []);
      } catch (_error) {
        if (!cancelled) {
          setCustomerNotes([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingPinnedCustomerNote(false);
        }
      }
    };

    void loadPinnedNote();

    return () => {
      cancelled = true;
    };
  }, [selectedCustomer?.id, onLoadCustomerNotes]);

  useEffect(() => {
    setCart((prev) => prev.map((item) => {
      if (item.isUnitPriceManual) {
        const product = productMap.get(item.productId);
        const resolved = product ? resolveCustomerPrice(product) : { source: "DEFAULT" };
        return {
          ...item,
          usesCustomPrice: resolved.source === "CUSTOM",
          priceSource: resolved.source
        };
      }

      const product = productMap.get(item.productId);
      if (!product) return item;
      const resolved = resolveCustomerPrice(product);
      return {
        ...item,
        unitPrice: resolved.unitPrice || item.unitPrice,
        usesCustomPrice: resolved.source === "CUSTOM",
        priceSource: resolved.source
      };
    }));
  }, [customerPrices, productMap, selectedCustomer?.customerPriceTier]);

  useEffect(() => {
    if (!customers.length) return;

    const hasSelectedCustomer = selectedCustomerId && customers.some((customer) => customer.id === selectedCustomerId);
    if (hasSelectedCustomer) return;

    if (!retailCustomer) return;

    setSelectedCustomerId(retailCustomer.id);
    setCustomerQuery(formatCustomerQuery(retailCustomer));
  }, [customers, selectedCustomerId, retailCustomer]);

  useEffect(() => {
    if (!showQuickReceiptDialog) return;
    setQuickReceipt((prev) => ({
      ...prev,
      amount: Math.max(Number(quickReceiptSelectedDebt || 0), 0)
    }));
  }, [showQuickReceiptDialog, quickReceiptSelectedDebt]);

  const addToCart = (product) => {
    setCart((prev) => {
      const existed = prev.find((i) => i.productId === product.id);
      const resolved = resolveCustomerPrice(product);
      const unitPrice = resolved.unitPrice;
      if (existed) {
        return prev.map((i) => i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, {
        productId: product.id,
        sku: product.sku || "",
        name: product.name,
        productType: product.productType || "GOODS",
        quantity: 1,
        unitPrice,
        discountAmount: 0,
        isGift: false,
        usesCustomPrice: resolved.source === "CUSTOM",
        priceSource: resolved.source,
        isUnitPriceManual: false
      }];
    });
    setKeyword("");
    setShowProductList(false);
  };

  const updateItemQuantity = (productId, nextQuantity) => {
    const safeQuantity = Math.max(1, Number(nextQuantity || 1));
    setCart((prev) => prev.map((item) => (
      item.productId === productId ? { ...item, quantity: safeQuantity } : item
    )));
  };

  const updateItemUnitPrice = (productId, rawValue) => {
    const nextUnitPrice = parseMoneyInput(rawValue);
    setCart((prev) => prev.map((item) => (
      item.productId === productId
        ? { ...item, unitPrice: nextUnitPrice, isUnitPriceManual: true }
        : item
    )));
  };

  const removeCartItem = (productId) => {
    if (consultProductId === productId) {
      setConsultProductId(null);
    }
    setCart((prev) => prev.filter((item) => item.productId !== productId));
  };

  const openConsultPanel = (productId) => {
    setConsultProductId(productId);
  };

  const closeConsultPanel = () => {
    setConsultProductId(null);
  };

  const closeStockHistoryDialog = () => {
    setShowStockHistoryDialog(false);
    setStockHistoryLoading(false);
    setStockHistoryProduct(null);
    setStockHistorySummary({ totalIn: 0, totalOut: 0, netChange: 0 });
    setStockHistoryRows([]);
    const today = getTodayInputValue();
    setStockHistoryFilters({ customerKeyword: "", movementType: "ALL", dateFrom: today, dateTo: today });
  };

  const openStockHistoryDialog = async (cartItem) => {
    const product = productMap.get(cartItem.productId) || cartItem;
    setShowStockHistoryDialog(true);
    setStockHistoryLoading(true);
    setStockHistoryProduct(product);
    setStockHistoryRows([]);
    setStockHistorySummary({ totalIn: 0, totalOut: 0, netChange: 0 });
    const today = getTodayInputValue();
    setStockHistoryFilters({ customerKeyword: "", movementType: "ALL", dateFrom: today, dateTo: today });

    if (isServiceProduct(product)) {
      setStockHistoryLoading(false);
      return;
    }

    if (!onLoadProductInventoryHistory) {
      setStockHistoryLoading(false);
      showNotification("Chưa cấu hình dữ liệu lịch sử xuất nhập", "warning");
      return;
    }

    try {
      const data = await onLoadProductInventoryHistory(cartItem.productId);
      setStockHistoryRows(data?.movements || []);
      setStockHistorySummary(data?.summary || { totalIn: 0, totalOut: 0, netChange: 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không tải được lịch sử xuất nhập";
      showNotification(message, "error");
    } finally {
      setStockHistoryLoading(false);
    }
  };

  const copyConsultScript = async () => {
    if (!consultProduct) return;
    const script = buildConsultQuickScript(consultProduct, consultSections);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(script);
        showNotification("Đã sao chép lời tư vấn nhanh", "success");
      } else {
        showNotification("Trình duyệt không hỗ trợ sao chép tự động", "warning");
      }
    } catch (_err) {
      showNotification("Không thể sao chép lời tư vấn", "error");
    }
  };

  const subtotal = effectiveCart.reduce((sum, item) => sum + Number(item.effectiveLineTotal || 0), 0);
  const grandTotal = Math.max(subtotal - Number(payment.discountAmount || 0), 0);
  const manualPaidAmount = Math.min(Number(payment.paidAmount || 0), grandTotal);
  const availableCredit = Math.max(-Number(selectedCustomer?.netBalance || 0), 0);
  const autoAppliedBalance = Math.min(availableCredit, Math.max(grandTotal - manualPaidAmount, 0));
  const effectivePaidAmount = Math.min(grandTotal, manualPaidAmount + autoAppliedBalance);
  const remainingDebt = Math.max(grandTotal - effectivePaidAmount, 0);
  const canSubmitOrder = Boolean(selectedCustomer && cart.length && activeStoreId && !isSubmittingOrder);
  const canSaveDraft = Boolean(selectedCustomer && cart.length && activeStoreId && !isSubmittingOrder);

  useEffect(() => {
    setPayment((prev) => ({
      ...prev,
      paidAmount: isPaidAmountManual
        ? (prev.paidAmount > grandTotal ? grandTotal : prev.paidAmount)
        : grandTotal
    }));
  }, [grandTotal, isPaidAmountManual]);

  const saveDraft = async () => {
    if (!selectedCustomer) {
      showNotification("Vui lòng chọn khách hàng trước khi lưu nháp", "error");
      return;
    }
    if (!cart.length) {
      showNotification("Đơn hàng chưa có sản phẩm", "error");
      return;
    }
    if (!activeStoreId) {
      showNotification("Chưa xác định được cửa hàng đang hoạt động", "error");
      return;
    }
    if (isSubmittingOrder) return;
    try {
      setIsSubmittingOrder(true);
      const allItems = [
        ...effectiveCart.map(({ usesCustomPrice, sku, promoName, effectiveDiscountAmount, effectiveLineTotal, appliedPromotionName, appliedPromotionSpecialPrice, ...item }) => ({
          ...item,
          discountAmount: Number(effectiveDiscountAmount || item.discountAmount || 0)
        })),
        ...giftItems.map(({ usesCustomPrice, sku, promoName, ...item }) => item)
      ];
      const createdOrder = await Promise.resolve(onCreateOrder({
        storeId: activeStoreId,
        customerId: selectedCustomer.id,
        paymentMethod: payment.paymentMethod,
        paidAmount: 0,
        discountAmount: Number(payment.discountAmount || 0),
        asDraft: true,
        note: payment.note || undefined,
        items: allItems
      }));
      if (createdOrder) {
        showNotification(`Đã lưu nháp đơn hàng ${createdOrder.orderNo || ""}`, "success");
      }
      setCart([]);
      setPayment({ paymentMethod: "CASH", paidAmount: 0, discountAmount: 0, note: "" });
      setIsPaidAmountManual(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lỗi không xác định";
      showNotification(`Lưu nháp thất bại: ${message}`, "error");
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const submit = async () => {
    if (!selectedCustomer) {
      showNotification("Vui lòng chọn khách hàng trước khi tạo đơn hàng", "error");
      return;
    }

    if (!cart.length) {
      showNotification("Đơn hàng chưa có sản phẩm", "error");
      return;
    }

    if (!activeStoreId) {
      showNotification("Chưa xác định được cửa hàng đang hoạt động", "error");
      return;
    }

    if (isSubmittingOrder) {
      return;
    }

    try {
      setIsSubmittingOrder(true);
      const allItems = [
        ...effectiveCart.map(({ usesCustomPrice, sku, promoName, effectiveDiscountAmount, effectiveLineTotal, appliedPromotionName, appliedPromotionSpecialPrice, ...item }) => ({
          ...item,
          discountAmount: Number(effectiveDiscountAmount || item.discountAmount || 0)
        })),
        ...giftItems.map(({ usesCustomPrice, sku, promoName, ...item }) => item)
      ];
      const createdOrder = await Promise.resolve(onCreateOrder({
        storeId: activeStoreId,
        customerId: selectedCustomer.id,
        paymentMethod: payment.paymentMethod,
        paidAmount: manualPaidAmount,
        discountAmount: Number(payment.discountAmount || 0),
        note: payment.note || undefined,
        items: allItems
      }));

      if (createdOrder) {
        const createdReceiptNo = Array.isArray(createdOrder.receiptAllocations)
          ? createdOrder.receiptAllocations.find((row) => row?.receipt?.receiptNo)?.receipt?.receiptNo
          : null;
        showNotification(
          createdReceiptNo
            ? `Tạo đơn hàng thành công. Phiếu thu: ${createdReceiptNo}`
            : "Tạo đơn hàng thành công!",
          "success"
        );
        setCreatedOrderForPrint(createdOrder);
        setSelectedPrintTemplate("pos");
        setShowPrintTemplatePicker(true);
      }

      setCart([]);
  setPayment({ paymentMethod: "CASH", paidAmount: 0, discountAmount: 0, note: "" });
      setIsPaidAmountManual(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lỗi không xác định";
      showNotification(`Tạo đơn hàng thất bại: ${message}`, "error");
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handlePrintSelectedTemplate = () => {
    if (!createdOrderForPrint) return;
    try {
      printOrderByTemplate(createdOrderForPrint, selectedPrintTemplate);
      setShowPrintTemplatePicker(false);
      setCreatedOrderForPrint(null);
      setSelectedPrintTemplate("pos");
    } catch (printError) {
      const printMessage = printError instanceof Error ? printError.message : "Không thể mở cửa sổ in";
      showNotification(`In phiếu thất bại: ${printMessage}`, "warning");
    }
  };

  const handleSelectCustomer = (customer) => {
    setSelectedCustomerId(customer.id);
    setCustomerQuery(formatCustomerQuery(customer));
    setShowCustomerList(false);
  };

  const handleClearCustomer = () => {
    if (retailCustomer) {
      setSelectedCustomerId(retailCustomer.id);
      setCustomerQuery(formatCustomerQuery(retailCustomer));
    } else {
      setSelectedCustomerId("");
      setCustomerQuery("");
    }
    setCustomerPrices({});
    setShowCustomerList(false);
  };

  const refreshQuickReceiptOrders = async ({ customerId, reloadAll = false } = {}) => {
    if (!customerId) return;
    if (!onReloadData && !onLoadOrders) return;

    setLoadingQuickReceiptOrders(true);
    try {
      if (reloadAll && onReloadData) {
        await Promise.resolve(onReloadData());
      }
    } catch {
      // Keep existing data when full reload fails.
    }

    try {
      if (onLoadOrders) {
        const loadedOrders = await Promise.resolve(onLoadOrders());
        const normalized = Array.isArray(loadedOrders) ? loadedOrders : [];
        setQuickReceiptOrdersSnapshot(normalized.length ? normalized : null);
      } else {
        setQuickReceiptOrdersSnapshot(null);
      }
    } catch {
      // Keep existing data when loading orders fails.
      setQuickReceiptOrdersSnapshot(null);
    } finally {
      setLoadingQuickReceiptOrders(false);
    }
  };

  const openQuickReceiptDialog = async () => {
    if (!selectedCustomer?.id) {
      showNotification("Vui lòng chọn khách hàng trước khi thu tiền", "error");
      return;
    }

    const customerId = selectedCustomer.id;
    setQuickReceiptCustomerId(customerId);
    setQuickReceiptCustomerSnapshot({
      id: customerId,
      name: selectedCustomer.name || "-",
      phone: selectedCustomer.phone || "-"
    });
    await refreshQuickReceiptOrders({ customerId, reloadAll: true });

    setQuickReceipt({ amount: 0, discountAmount: 0, note: "" });
    setQuickReceiptSelectedOrderIds([]);
    setShowQuickReceiptDialog(true);
  };

  const loadOverviewForPreset = async (customerId, preset) => {
    if (!onLoadCustomerOverview) return;
    setCustomerOverviewLoading(true);
    try {
      const data = await Promise.resolve(onLoadCustomerOverview(customerId, preset));
      setCustomerOverviewData(data || null);
    } catch {
      setCustomerOverviewData(null);
    } finally {
      setCustomerOverviewLoading(false);
    }
  };

  const openCustomerOverviewDialog = async () => {
    if (!selectedCustomer?.id) {
      showNotification("Vui lòng chọn khách hàng trước", "error");
      return;
    }
    setCustomerOverviewPreset("this-month");
    setCustomerOverviewData(null);
    setShowCustomerOverviewDialog(true);
    await loadOverviewForPreset(selectedCustomer.id, "this-month");
  };

  const openDebtExportDialog = async () => {
    if (!selectedCustomer?.id) {
      showNotification("Vui lòng chọn khách hàng trước khi xuất công nợ", "error");
      return;
    }
    if (!onLoadCustomerAging) {
      showNotification("Chức năng dữ liệu công nợ chưa sẵn sàng", "error");
      return;
    }

    setDebtExportDate(getTodayInputValue());
    setDebtIncludeInterest(true);
    setDebtExportLoading(true);
    setShowDebtExportDialog(true);
    try {
      const agingRes = await Promise.resolve(onLoadCustomerAging(selectedCustomer.id));
      const rows = Array.isArray(agingRes?.outstandingDetails)
        ? agingRes.outstandingDetails
            .filter((item) => Number(item?.remainingAmount || 0) > 0)
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        : [];
      setDebtOutstandingRows(rows);
      if (!rows.length) {
        showNotification("Khách hàng hiện không có khoản nợ còn treo", "warning");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không tải được dữ liệu công nợ";
      setDebtOutstandingRows([]);
      showNotification(`Không tải được dữ liệu công nợ: ${message}`, "error");
    } finally {
      setDebtExportLoading(false);
    }
  };

  const exportDebtAgingExcel = () => {
    if (!selectedCustomer?.id) {
      showNotification("Vui lòng chọn khách hàng trước khi xuất công nợ", "error");
      return;
    }
    if (debtIncludeInterest && !debtExportDate) {
      showNotification("Vui lòng chọn ngày tính lãi", "error");
      return;
    }

    const html = buildDebtAgingExcelHtml({
      customer: selectedCustomer,
      rows: debtExportRows,
      interestDate: debtExportDate,
      totalPrincipal: debtExportTotals.principal,
      totalInterest: debtExportTotals.interest,
      includeInterest: debtIncludeInterest
    });
    const safeCustomerName = sanitizeForFileName(selectedCustomer.name || "khach-hang") || "khach-hang";
    const safeDate = sanitizeForFileName(debtExportDate) || "ngay-tinh-lai";
    const safeInterestMode = debtIncludeInterest ? "co-lai" : "khong-lai";
    const filename = `bang-ke-cong-no-${safeCustomerName}-${safeDate}-${safeInterestMode}.xls`;
    downloadExcelFromHtml(filename, html);
    showNotification("Đã xuất file Excel công nợ còn treo", "success");
  };

  const priceByProductIdDialog = useMemo(() => {
    const map = new Map();
    priceDialogRows.forEach((row) => map.set(row.productId, Number(row.price || 0)));
    return map;
  }, [priceDialogRows]);

  const filteredPriceDialogRows = useMemo(() => {
    const keyword = priceDialogFilter.trim().toLowerCase();
    if (!keyword) return priceDialogRows;
    return priceDialogRows.filter((row) => {
      const text = [row.product?.sku || "", row.product?.name || "", row.product?.unit || ""].join(" ").toLowerCase();
      return text.includes(keyword);
    });
  }, [priceDialogRows, priceDialogFilter]);

  const productOptionsForPriceDialog = useMemo(() =>
    products.map((p) => ({ value: p.id, label: `${p.sku || ""} - ${p.name || ""}${p.unit ? ` (${p.unit})` : ""}` })),
    [products]
  );

  const handlePriceProductChange = (productId) => {
    const product = products.find((p) => p.id === productId);
    const customPrice = priceByProductIdDialog.get(productId);
    setPriceForm({ productId, price: customPrice ?? Number(product?.defaultPrice || 0) });
  };

  const copySourceCustomerOptions = useMemo(() =>
    customers
      .filter((c) => c.id !== selectedCustomer?.id)
      .map((c) => ({
        value: c.id,
        label: c.name || "Không tên",
        description: `${c.phone || "-"} - ${c.address || "-"}`,
        keywords: `${c.name || ""} ${c.phone || ""} ${c.address || ""}`.toLowerCase()
      })),
    [customers, selectedCustomer]
  );

  const copyPriceListFromCustomer = async () => {
    if (!selectedCustomer?.id || !copySourceCustomerId || !onLoadCustomerPriceList || !onUpdateCustomerPriceList) return;
    try {
      setPricePanelLoading(true);
      const sourcePriceList = await onLoadCustomerPriceList(copySourceCustomerId);
      if (!sourcePriceList || sourcePriceList.length === 0) {
        showNotification("Khách hàng được chọn không có bảng giá riêng", "error");
        return;
      }
      let successCount = 0;
      for (const item of sourcePriceList) {
        try {
          await onUpdateCustomerPriceList(selectedCustomer.id, item.productId, {
            price: item.price,
            storeId: activeStoreId || undefined
          });
          successCount++;
        } catch {
          // bỏ qua lỗi từng dòng
        }
      }
      const rows = await onLoadCustomerPriceList(selectedCustomer.id);
      setPriceDialogRows(rows || []);
      const map = {};
      (rows || []).forEach((r) => { map[r.productId] = Number(r.price); });
      setCustomerPrices(map);
      setShowCopyPricePanel(false);
      setCopySourceCustomerId("");
      showNotification(`Đã sao chép thành công ${successCount}/${sourcePriceList.length} giá`, "success");
    } catch (error) {
      showNotification(`Lỗi khi sao chép bảng giá: ${error.message}`, "error");
    } finally {
      setPricePanelLoading(false);
    }
  };

  const openPriceDialog = async () => {
    if (!selectedCustomer?.id || !onLoadCustomerPriceList) return;
    setShowPriceDialog(true);
    setPricePanelLoading(true);
    setPriceDialogFilter("");
    try {
      const rows = await onLoadCustomerPriceList(selectedCustomer.id);
      setPriceDialogRows(rows || []);
      const firstProductId = (rows || [])[0]?.productId || products[0]?.id || "";
      if (firstProductId) {
        const product = products.find((p) => p.id === firstProductId);
        const customPrice = (rows || []).find((r) => r.productId === firstProductId);
        setPriceForm({ productId: firstProductId, price: customPrice ? Number(customPrice.price) : Number(product?.defaultPrice || 0) });
      }
    } catch (error) {
      showNotification(`Lỗi tải bảng giá: ${error.message}`, "error");
      setShowPriceDialog(false);
    } finally {
      setPricePanelLoading(false);
    }
  };

  const closePriceDialog = () => {
    setShowPriceDialog(false);
    setPriceDialogRows([]);
    setPriceDialogFilter("");
    setPriceForm({ productId: "", price: 0 });
    setDeletingPriceRowId("");
    setShowCopyPricePanel(false);
    setCopySourceCustomerId("");
  };

  const submitPriceDialog = async () => {
    if (!selectedCustomer?.id || !priceForm.productId || Number(priceForm.price) <= 0) return;
    if (!onUpdateCustomerPriceList) return;
    try {
      await onUpdateCustomerPriceList(selectedCustomer.id, priceForm.productId, {
        price: Number(priceForm.price),
        storeId: activeStoreId || undefined
      });
      const rows = await onLoadCustomerPriceList(selectedCustomer.id);
      setPriceDialogRows(rows || []);
      const map = {};
      (rows || []).forEach((row) => { map[row.productId] = Number(row.price); });
      setCustomerPrices(map);
      showNotification("Đã cập nhật bảng giá riêng", "success");
    } catch (error) {
      showNotification(`Lỗi: ${error.message}`, "error");
    }
  };

  const deletePriceDialogRow = async (row) => {
    if (!selectedCustomer?.id || !onDeleteCustomerPriceList) return;
    if (!window.confirm(`Xóa giá riêng của sản phẩm ${row.product?.name || row.productId}?`)) return;
    try {
      setDeletingPriceRowId(row.id);
      await onDeleteCustomerPriceList(selectedCustomer.id, row.productId);
      const rows = await onLoadCustomerPriceList(selectedCustomer.id);
      setPriceDialogRows(rows || []);
      const map = {};
      (rows || []).forEach((r) => { map[r.productId] = Number(r.price); });
      setCustomerPrices(map);
      if (priceForm.productId === row.productId) {
        const fallback = (rows || [])[0]?.productId || "";
        if (fallback) {
          const product = products.find((p) => p.id === fallback);
          const cp = (rows || []).find((r) => r.productId === fallback);
          setPriceForm({ productId: fallback, price: cp ? Number(cp.price) : Number(product?.defaultPrice || 0) });
        } else {
          setPriceForm({ productId: "", price: 0 });
        }
      }
    } catch (error) {
      showNotification(`Lỗi xóa: ${error.message}`, "error");
    } finally {
      setDeletingPriceRowId("");
    }
  };

  const openCustomerNotesDialog = async () => {
    setShowCustomerNotesDialog(true);
    setCustomerNoteForm({ content: "", isStarred: false });

    try {
      setLoadingCustomerNotes(true);
      const rows = await Promise.resolve(onLoadCustomerNotes(selectedCustomer.id));
      setCustomerNotes(rows || []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lỗi không xác định";
      showNotification(`Không tải được ghi chú: ${message}`, "error");
    } finally {
      setLoadingCustomerNotes(false);
    }
  };

  const submitCustomerNote = async () => {
    if (!selectedCustomer?.id) {
      showNotification("Vui lòng chọn khách hàng trước khi tạo ghi chú", "error");
      return;
    }
    if (!onCreateCustomerNote || !onLoadCustomerNotes) {
      showNotification("Chức năng ghi chú chưa sẵn sàng", "error");
      return;
    }

    const content = customerNoteForm.content.trim();
    if (!content) {
      showNotification("Nội dung ghi chú không được để trống", "error");
      return;
    }

    try {
      setCreatingCustomerNote(true);
      await Promise.resolve(onCreateCustomerNote(selectedCustomer.id, {
        content,
        isStarred: Boolean(customerNoteForm.isStarred)
      }));
      const rows = await Promise.resolve(onLoadCustomerNotes(selectedCustomer.id));
      setCustomerNotes(rows || []);
      setCustomerNoteForm({ content: "", isStarred: false });
      showNotification("Đã tạo ghi chú khách hàng", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lỗi không xác định";
      showNotification(`Tạo ghi chú thất bại: ${message}`, "error");
    } finally {
      setCreatingCustomerNote(false);
    }
  };

  const openGiftDialog = async () => {
    if (!selectedCustomer?.id) {
      showNotification("Vui lòng chọn khách hàng trước", "error");
      return;
    }
    setGiftSelectedProduct(null);
    setGiftProductSearch("");
    setGiftQuantity(1);
    setGiftNote("");
    setGiftMessage({ text: "", type: "" });
    setGiftCurrentPoints(selectedCustomer?.rewardPoints ?? null);
    setShowGiftDialog(true);
    if (onLoadGiftRedemptions) {
      try {
        setGiftDialogLoading(true);
        const rows = await Promise.resolve(onLoadGiftRedemptions(selectedCustomer.id));
        setGiftHistory(rows || []);
      } catch {
        setGiftHistory([]);
      } finally {
        setGiftDialogLoading(false);
      }
    }
  };

  const submitGiftRedemption = async () => {
    if (!selectedCustomer?.id || !onCreateGiftRedemption) return;
    if (!giftSelectedProduct) {
      setGiftMessage({ text: "Vui lòng chọn sản phẩm tặng", type: "error" });
      return;
    }
    try {
      setGiftSubmitting(true);
      const result = await Promise.resolve(onCreateGiftRedemption(selectedCustomer.id, {
        productId: giftSelectedProduct.id,
        quantity: giftQuantity,
        note: giftNote.trim() || undefined,
        storeId: activeStoreId || undefined
      }));
      const newPoints = result?.data?.newRewardPoints ?? result?.newRewardPoints;
      const inventoryDeducted = result?.data?.inventoryDeducted ?? result?.inventoryDeducted;
      if (newPoints != null) setGiftCurrentPoints(newPoints);
      const stockNote = inventoryDeducted ? " | Đã trừ tồn kho" : (activeStoreId ? " | Không tìm thấy tồn kho tại cửa hàng" : " | Chưa gán cửa hàng");
      setGiftMessage({ text: `Tặng quà thành công! Điểm còn lại: ${newPoints ?? "?"}${stockNote}`, type: "success" });
      window.setTimeout(() => {
        window.location.reload();
      }, 120);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Lỗi không xác định";
      setGiftMessage({ text: `Tặng quà thất bại: ${msg}`, type: "error" });
    } finally {
      setGiftSubmitting(false);
    }
  };

  const cancelGiftItem = async (redemptionId) => {
    if (!selectedCustomer?.id || !onCancelGiftRedemption) return;
    if (!window.confirm("Xác nhận hủy lần tặng quà này? Điểm sẽ được hoàn lại và tồn kho được cộng trở lại.")) return;
    try {
      setGiftCancelling(redemptionId);
      await Promise.resolve(onCancelGiftRedemption(selectedCustomer.id, redemptionId));
      setGiftMessage({ text: "Đã hủy tặng quà và hoàn điểm, cộng lại tồn kho", type: "success" });
      setGiftCurrentPoints((prev) => prev != null ? prev + (giftHistory.find((r) => r.id === redemptionId)?.pointsCost ?? 0) : prev);
      if (onLoadGiftRedemptions) {
        const rows = await Promise.resolve(onLoadGiftRedemptions(selectedCustomer.id));
        setGiftHistory(rows || []);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Lỗi không xác định";
      setGiftMessage({ text: `Hủy thất bại: ${msg}`, type: "error" });
    } finally {
      setGiftCancelling(null);
    }
  };

  const openEditCustomerDialog = () => {
    if (!canEditCustomerInfo || !onUpdateCustomerInfo) {
      showNotification("Bạn không có quyền sửa thông tin khách hàng", "error");
      return;
    }
    if (!selectedCustomer?.id) {
      showNotification("Vui lòng chọn khách hàng trước khi chỉnh sửa", "error");
      return;
    }

    setCustomerForm({
      name: selectedCustomer.name || "",
      ledgerCode: selectedCustomer.ledgerCode || "",
      phone: selectedCustomer.phone || "",
      phone2: selectedCustomer.phone2 || "",
      phone3: selectedCustomer.phone3 || "",
      email: selectedCustomer.email || "",
      address: selectedCustomer.address || "",
      accountOwnerPositionId: selectedCustomer.accountOwnerPositionId || "",
      businessAreaId: selectedCustomer.businessAreaId || "",
      customerPriceTier: selectedCustomer.customerPriceTier || ""
    });
    setCustomerFormErrors({});
    setCustomerFormMessage("");
    setShowEditCustomerDialog(true);
  };

  const handleCustomerFormChange = (field, value) => {
    setCustomerForm((prev) => ({ ...prev, [field]: value }));
    setCustomerFormErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    if (customerFormMessage) {
      setCustomerFormMessage("");
    }
  };

  const submitCustomerInfo = async () => {
    if (!selectedCustomer?.id || !canEditCustomerInfo || !onUpdateCustomerInfo) {
      return;
    }

    const errors = validateCustomerInfoForm(customerForm);
    if (Object.keys(errors).length) {
      setCustomerFormErrors(errors);
      setCustomerFormMessage("Biểu mẫu còn lỗi. Vui lòng kiểm tra các trường được đánh dấu.");
      return;
    }

    try {
      setSavingCustomerInfo(true);
      const updated = await onUpdateCustomerInfo(selectedCustomer.id, {
        name: customerForm.name.trim(),
        ledgerCode: customerForm.ledgerCode?.trim() || null,
        phone: customerForm.phone?.trim() || "",
        phone2: customerForm.phone2?.trim() || "",
        phone3: customerForm.phone3?.trim() || "",
        email: customerForm.email?.trim() || "",
        address: customerForm.address?.trim() || "",
        accountOwnerPositionId: customerForm.accountOwnerPositionId || null,
        businessAreaId: customerForm.businessAreaId || null,
        customerPriceTier: customerForm.customerPriceTier || null
      });

      const nextCustomer = updated?.id ? updated : {
        ...selectedCustomer,
        name: customerForm.name.trim(),
        ledgerCode: customerForm.ledgerCode?.trim() || null,
        phone: customerForm.phone?.trim() || "",
        phone2: customerForm.phone2?.trim() || "",
        phone3: customerForm.phone3?.trim() || "",
        email: customerForm.email?.trim() || "",
        address: customerForm.address?.trim() || "",
        accountOwnerPositionId: customerForm.accountOwnerPositionId || null,
        businessAreaId: customerForm.businessAreaId || null,
        customerPriceTier: customerForm.customerPriceTier || null
      };

      setSelectedCustomerId(nextCustomer.id);
      setCustomerQuery(formatCustomerQuery(nextCustomer));
      setShowEditCustomerDialog(false);
      setCustomerFormErrors({});
      setCustomerFormMessage("");
      showNotification("Đã cập nhật thông tin khách hàng", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lỗi không xác định";
      setCustomerFormMessage(`Lỗi: ${message}`);
    } finally {
      setSavingCustomerInfo(false);
    }
  };

  const loadFacebookAudiencesForSelectedCustomer = async ({ resetFilters = false } = {}) => {
    if (!selectedCustomer?.id || !onLoadMarketingCustomAudiences || !onLoadMarketingCustomAudienceById) {
      return;
    }

    setFacebookAudienceLoading(true);
    setFacebookAudienceMessage("");
    if (resetFilters) {
      setFacebookAudienceSearch("");
      setFacebookAudienceOnlyMember(false);
    }

    try {
      const rows = await Promise.resolve(onLoadMarketingCustomAudiences());
      const detailedRows = await Promise.all((rows || []).map(async (audience) => {
        try {
          const detail = await Promise.resolve(onLoadMarketingCustomAudienceById(audience.id));
          const details = Array.isArray(detail?.details) ? detail.details : [];
          return {
            ...audience,
            details,
            matchedDetail: details.find((item) => item.customerId === selectedCustomer.id) || null
          };
        } catch (_error) {
          return {
            ...audience,
            details: [],
            matchedDetail: null
          };
        }
      }));
      setFacebookAudiences(detailedRows);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không tải được đối tượng tùy chỉnh";
      setFacebookAudienceMessage(`Lỗi: ${message}`);
    } finally {
      setFacebookAudienceLoading(false);
    }
  };

  const openFacebookAudienceDialog = async () => {
    if (!selectedCustomer?.id) {
      showNotification("Vui lòng chọn khách hàng trước khi mở Quảng cáo Facebook", "error");
      return;
    }
    if (!onLoadMarketingCustomAudiences || !onLoadMarketingCustomAudienceById) {
      showNotification("Chức năng Quảng cáo Facebook chưa sẵn sàng", "error");
      return;
    }

    setShowFacebookAudienceDialog(true);
    await loadFacebookAudiencesForSelectedCustomer({ resetFilters: true });
  };

  const toggleCustomerAudienceMembership = async (audience) => {
    if (!selectedCustomer?.id || !audience?.id) return;

    const isMember = Boolean(audience?.matchedDetail?.id);
    if ((isMember && !onRemoveMarketingAudienceCustomer) || (!isMember && !onAddMarketingAudienceCustomer)) {
      showNotification("Chức năng cập nhật đối tượng chưa sẵn sàng", "error");
      return;
    }

    setFacebookAudienceSavingId(audience.id);
    setFacebookAudienceMessage("");
    try {
      const updatedAudience = isMember
        ? await Promise.resolve(onRemoveMarketingAudienceCustomer(audience.id, audience.matchedDetail.id))
        : await Promise.resolve(onAddMarketingAudienceCustomer(audience.id, selectedCustomer.id));
      const nextDetails = Array.isArray(updatedAudience?.details) ? updatedAudience.details : [];

      setFacebookAudiences((prev) => prev.map((item) => {
        if (item.id !== audience.id) return item;
        return {
          ...item,
          ...updatedAudience,
          details: nextDetails,
          matchedDetail: nextDetails.find((detail) => detail.customerId === selectedCustomer.id) || null
        };
      }));
      setFacebookAudienceMessage(isMember ? "Đã xóa khách hàng khỏi đối tượng tùy chỉnh." : "Đã thêm khách hàng vào đối tượng tùy chỉnh.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể cập nhật đối tượng tùy chỉnh";
      setFacebookAudienceMessage(`Lỗi: ${message}`);
    } finally {
      setFacebookAudienceSavingId("");
    }
  };

  const toggleQuickReceiptOrder = (orderId) => {
    setQuickReceiptSelectedOrderIds((prev) => (
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    ));
  };

  const submitQuickReceipt = async () => {
    const amount = Number(quickReceipt.amount || 0);
    const discountAmount = Number(quickReceipt.discountAmount || 0);
    if (!selectedCustomer?.id) {
      showNotification("Chưa có khách hàng để tạo phiếu thu", "error");
      return;
    }
    if (!activeStoreId) {
      showNotification("Chưa xác định được cửa hàng đang hoạt động", "error");
      return;
    }
    if (!onCreateReceipt) {
      showNotification("Chức năng thu tiền chưa sẵn sàng", "error");
      return;
    }
    if (amount <= 0 && discountAmount <= 0) {
      showNotification("Cần nhập Số tiền thu hoặc Chiết khấu lớn hơn 0", "error");
      return;
    }

    try {
      setIsSubmittingQuickReceipt(true);
      const receiptType = amount > 0 ? "PAYMENT" : "DISCOUNT";
      await Promise.resolve(onCreateReceipt({
        customerId: selectedCustomer.id,
        storeId: activeStoreId,
        paymentMethod: "CASH",
        amount,
        discountAmount,
        type: receiptType,
        note: quickReceipt.note || undefined,
        orderIds: quickReceiptSelectedOrderIds
      }));
      setShowQuickReceiptDialog(false);
      setQuickReceipt({ amount: 0, discountAmount: 0, note: "" });
      setQuickReceiptSelectedOrderIds([]);
      showNotification("Tạo phiếu thu thành công", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lỗi không xác định";
      showNotification(`Tạo phiếu thu thất bại: ${message}`, "error");
    } finally {
      setIsSubmittingQuickReceipt(false);
    }
  };

  return (
    <section className="pos-main">
      <div className="left-col">
        <div className="toolbar product-search">
          <div className="product-search-wrap">
            <SearchMonoIcon />
            <input
              placeholder="Tìm sản phẩm"
              value={keyword}
              onFocus={() => {
                if (keyword.trim() || recentCustomerProductOptions.length) {
                  setShowProductList(true);
                }
              }}
              onChange={(e) => {
                const value = e.target.value;
                setKeyword(value);
                setShowProductList(Boolean(value.trim()) || recentCustomerProductOptions.length > 0);
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (!productOptions.length) return;
                e.preventDefault();
                addToCart(productOptions[0]);
              }}
              onBlur={() => setTimeout(() => setShowProductList(false), 120)}
            />
          </div>

          {showProductList ? (
            <div className="product-dropdown">
              {productOptions.length ? (
                productOptions.map((p) => {
                  const stock = Number(p.availableQuantity ?? p.stock ?? p.quantity ?? 0);
                  const resolved = resolveCustomerPrice(p);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className="product-option"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addToCart(p)}
                    >
                      <div className="product-thumb-wrap">
                        {p.imageUrl ? (
                          <img className="product-thumb" src={p.imageUrl} alt={p.name} />
                        ) : (
                          <div className="product-thumb product-thumb-fallback">{(p.name || "SP").slice(0, 2).toUpperCase()}</div>
                        )}
                      </div>
                      <div className="product-meta">
                        <div className="product-meta-top">
                          <strong>{p.name || "-"}</strong>
                          <span>{formatCurrency(resolved.unitPrice)}</span>
                        </div>
                        <div className="product-meta-bottom">
                          <span>M: {p.sku || "-"}</span>
                          <span>DVT: {p.unit || "-"}</span>
                          <span>{isServiceProduct(p) ? "Dịch vụ" : `Tồn: ${formatNumber(stock)}`}</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="product-empty">Không có sản phẩm phù hợp</div>
              )}
            </div>
          ) : null}
        </div>
        <div className="cart">
          <div className="order-detail-head">
            <h3>Chi tiết đơn hàng</h3>
            <span>{cart.length} mặt hàng</span>
          </div>

          {!cart.length ? <div className="order-empty">Chưa có sản phẩm nào trong đơn.</div> : null}

          {cart.length ? (
            <div className="order-list" role="table" aria-label="Danh sách sản phẩm trong đơn hàng">
              <div className="order-list-head" role="row">
                <span className="order-head-name">Tên sản phẩm</span>
                <span className="order-head-stock">Tồn hiện tại</span>
                <span className="order-head-price">Đơn giá</span>
                <span className="order-head-qty">Số lượng</span>
                <span className="order-head-total">Thành tiền</span>
                <span className="order-head-action">Thao tác</span>
              </div>

              {effectiveCart.map((i) => {
                const inv = inventoryMap.get(i.productId) || { stock: 0, reserved: 0, available: 0 };
                const available = Number(inv.available || 0);
                const code = i.sku || productMap.get(i.productId)?.sku || "-";
                const product = productMap.get(i.productId);
                const service = isServiceProduct(product || i);
                return (
                <div key={i.productId} className="order-list-row" role="row">
                  <div className="order-col-name">
                    <span className="order-col-code">{code}</span>
                    <strong>{i.name}</strong>
                    <div className="order-line-tags">
                      {i.isUnitPriceManual ? <small className="price-badge">Giá sửa tay</small> : null}
                      {!i.isUnitPriceManual && i.usesCustomPrice ? <small className="price-badge">Giá riêng</small> : null}
                      {!i.isUnitPriceManual && !i.usesCustomPrice && i.priceSource === "TIER" ? <small className="price-badge">Giá theo loại KH</small> : null}
                      {i.appliedPromotionName ? <small className="price-badge">{`${i.appliedPromotionName} · Giá KM ${formatCurrency(i.appliedPromotionSpecialPrice)}`}</small> : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`order-stock-cell ${service ? "" : available <= 0 ? "is-empty" : available <= 5 ? "is-low" : ""}`}
                    onClick={() => openStockHistoryDialog(i)}
                    title={service ? "Dịch vụ không theo dõi xuất nhập tồn" : "Xem lịch sử xuất nhập để truy vết"}
                  >
                    <strong>{service ? "DV" : formatNumber(available)}</strong>
                    <small>{service ? "Không quản lý tồn" : "Tồn khả dụng"}</small>
                  </button>

                  <label className="unit-price-edit order-col-price">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      style={{ textAlign: "right" }}
                      value={formatMoney(i.unitPrice)}
                      onChange={(e) => updateItemUnitPrice(i.productId, e.target.value)}
                    />
                  </label>

                  <div className="qty-control order-col-qty" aria-label={`Số lượng của ${i.name}`}>
                    <button type="button" onClick={() => updateItemQuantity(i.productId, i.quantity - 1)}>-</button>
                    <input
                      type="number"
                      className="qty-input-no-spin"
                      min="1"
                      value={i.quantity}
                      onChange={(e) => updateItemQuantity(i.productId, e.target.value)}
                    />
                    <button type="button" onClick={() => updateItemQuantity(i.productId, i.quantity + 1)}>+</button>
                  </div>

                  <strong className="line-total order-col-total">{formatCurrency(i.effectiveLineTotal)}</strong>

                  <div className="order-col-action">
                    <button
                      type="button"
                      className="line-consult-btn"
                      onClick={() => openConsultPanel(i.productId)}
                      title="Xem tư vấn nhanh"
                    >
                      i
                    </button>
                    <button
                      type="button"
                      className="line-remove-btn"
                      onClick={() => removeCartItem(i.productId)}
                    >
                      Xóa
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          ) : null}

          <div className="cart-total">Tạm tính: {formatCurrency(subtotal)}</div>

          {stockWarnings.length > 0 && (
            <div className="stock-warning-banner">
              Lưu ý: Số lượng vượt tồn kho: {stockWarnings.join(", ")}. Vui lòng kiểm tra lại.
            </div>
          )}

          {giftItems.length > 0 && (
            <div className="gift-items-section">
              <div className="gift-items-header">Quà tặng khuyến mại</div>
              {giftItems.map((g) => (
                <div key={g.productId} className="gift-item-row">
                  <span className="gift-item-name">{g.name}</span>
                  <span className="gift-item-qty">x{g.quantity}</span>
                  <span className="gift-item-promo">{g.promoName}</span>
                  <span className="gift-item-price">Miễn phí</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="right-col">
        <div className="form-group customer-picker">
          <div className="customer-input-wrap">
            <input
              placeholder="Tìm và chọn khách hàng"
              value={customerQuery}
              onFocus={() => {
                setCustomerQuery("");
                setShowCustomerList(true);
              }}
              onChange={(e) => {
                setCustomerQuery(e.target.value);
                setShowCustomerList(true);
              }}
              onBlur={() => setTimeout(() => {
                setShowCustomerList(false);
                // Khôi phục tên khách đã chọn nếu người dùng không chọn khách mới
                const current = customers.find((c) => c.id === selectedCustomerIdRef.current);
                if (current) {
                  setCustomerQuery(formatCustomerQuery(current));
                }
              }, 120)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && filteredCustomers.length > 0) {
                  e.preventDefault();
                  handleSelectCustomer(filteredCustomers[0]);
                }
              }}
            />
            <div ref={customerMenuRef} className="customer-menu-wrap">
              <button
                type="button"
                className="customer-menu-btn"
                title="Thao tác khách hàng"
                onClick={() => setShowCustomerMenu((v) => !v)}
              >
                ···
              </button>
              {showCustomerMenu && (
                <div className="customer-action-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerMenu(false);
                      void openGiftDialog();
                    }}
                    disabled={!selectedCustomer?.id}
                  >
                    Tặng quà
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerMenu(false);
                      void openFacebookAudienceDialog();
                    }}
                    disabled={!selectedCustomer?.id || !onLoadMarketingCustomAudiences || !onLoadMarketingCustomAudienceById}
                  >
                    Quảng cáo Facebook
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerMenu(false);
                      openEditCustomerDialog();
                    }}
                    disabled={!selectedCustomer?.id || !canEditCustomerInfo || !onUpdateCustomerInfo}
                  >
                    Sửa thông tin
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerMenu(false);
                      void openCustomerNotesDialog();
                    }}
                    disabled={!selectedCustomer?.id || !onLoadCustomerNotes}
                  >
                    Ghi chú
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCustomerMenu(false); openQuickReceiptDialog(); }}
                  >
                    Thu tiền
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerMenu(false);
                      void openDebtExportDialog();
                    }}
                    disabled={!selectedCustomer?.id || !onLoadCustomerAging}
                  >
                    Xuất Excel công nợ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerMenu(false);
                      void openPriceDialog();
                    }}
                    disabled={!selectedCustomer?.id || !onLoadCustomerPriceList}
                  >
                    Bảng giá
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCustomerMenu(false); void openCustomerOverviewDialog(); }}
                    disabled={!selectedCustomer?.id}
                  >
                    Tổng quan khách hàng
                  </button>
                </div>
              )}
            </div>
          </div>

          {showCustomerList ? (
            <div className="customer-dropdown">
              {filteredCustomers.length ? (
                filteredCustomers.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    className={`customer-option ${selectedCustomerId === customer.id ? "selected" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectCustomer(customer)}
                  >
                    <strong>{formatCustomerQuery(customer)}</strong>
                  </button>
                ))
              ) : (
                <div className="customer-empty">Không tìm thấy khách hàng phù hợp</div>
              )}
            </div>
          ) : null}
        </div>
        <div className="customer-card">
          <div className="customer-card-body">
            <div className="cinfo-row"><span>Họ tên</span><span>{selectedCustomer?.name || "-"}</span></div>
            <div className="cinfo-row"><span>Mã sổ gốc</span><span>{selectedCustomer?.ledgerCode || "-"}</span></div>
            <div className="cinfo-row"><span>Số điện thoại</span><span>{selectedCustomer?.phone || "-"}</span></div>
            <div className="cinfo-row"><span>Địa chỉ</span><span>{selectedCustomer?.address || "-"}</span></div>
            <div className="cinfo-row cinfo-highlight"><span>Số dư</span><span>{formatCurrency(selectedCustomer?.netBalance)}</span></div>
            <div className="cinfo-row"><span>Bảng giá riêng</span><span>{loadingPriceList ? "Đang tải..." : `${Object.keys(customerPrices).length} sản phẩm`}</span></div>
            <div className="cinfo-row" title={latestStarredCustomerNote?.content || ""}>
              <span>Ghi chú</span>
              <span>
                {loadingPinnedCustomerNote
                  ? "Đang tải..."
                  : latestStarredCustomerNote
                    ? `★ ${latestStarredCustomerNote.content}`
                    : "-"}
              </span>
            </div>
          </div>
        </div>
        <div className="payment-info">
          <div className="form-group">
            <label>Chiết khấu đơn hàng</label>
            <input
              type="text"
              inputMode="numeric"
              className="payment-no-spin"
              placeholder="0"
              style={{ textAlign: "right" }}
              value={formatMoney(payment.discountAmount)}
              onChange={(e) => {
                const nextValue = parseMoneyInput(e.target.value);
                setPayment((prev) => ({ ...prev, discountAmount: nextValue }));
              }}
            />
          </div>
          <div className="form-group">
            <label>Số tiền thu</label>
            <input
              type="text"
              inputMode="numeric"
              className="payment-no-spin"
              placeholder="0"
              style={{ textAlign: "right" }}
              value={formatMoney(payment.paidAmount)}
              onFocus={() => {
                setIsPaidAmountManual(true);
                setPayment((prev) => ({ ...prev, paidAmount: "" }));
              }}
              onChange={(e) => {
                setIsPaidAmountManual(true);
                const nextValue = parseMoneyInput(e.target.value);
                setPayment((prev) => ({ ...prev, paidAmount: Math.min(nextValue, grandTotal) }));
              }}
            />
          </div>
          <div className="form-group">
            <label>Ghi chú</label>
            <input
              value={payment.note}
              onChange={(e) => setPayment((prev) => ({ ...prev, note: e.target.value }))}
              placeholder="Tùy chọn"
            />
          </div>

          {/* Giữ hàng tự động cho tất cả đơn POS - không hiển thị UI */}

          <p>Tổng thanh toán: {formatCurrency(grandTotal)}</p>
          <p>Tự cấn từ số dư: {formatCurrency(autoAppliedBalance)}</p>
          <p>Còn nợ sau bán: {formatCurrency(remainingDebt)}</p>
          {totalRewardPoints > 0 && (
            <p className="reward-points-hint">Điểm thưởng dự kiến: +{formatNumber(totalRewardPoints)} điểm</p>
          )}
        </div>

        {notification.visible && (
          <div className={`order-notification notification-${notification.type}`}>
            {notification.message}
          </div>
        )}

        <div className="order-submit-footer">
          <button
            type="button"
            className="order-submit-btn order-submit-btn--draft"
            onClick={saveDraft}
            disabled={!canSaveDraft}
            title="Lưu tạm đơn hàng ở trạng thái Nháp để xử lý sau. Đơn nháp chưa tạo phiếu thu và chưa ghi nhận nghiệp vụ bán hàng hoàn tất."
          >
            Lưu nháp
          </button>
          <button
            type="button"
            className="order-submit-btn"
            onClick={submit}
            disabled={!canSubmitOrder}
          >
            {isSubmittingOrder ? "Đang xử lý..." : "Tạo đơn hàng"}
          </button>
        </div>
      </div>

      {isSubmittingOrder ? (
        <div className="order-processing-overlay" role="status" aria-live="polite" aria-busy="true">
          <div className="order-processing-card">
            <span className="order-processing-spinner" aria-hidden="true" />
            <p>Đang xử lý, vui lòng chờ...</p>
          </div>
        </div>
      ) : null}

      {showPrintTemplatePicker && createdOrderForPrint ? (
        <div className="dialog-overlay pos-print-template-overlay" onClick={() => setShowPrintTemplatePicker(false)}>
          <div className="dialog-panel pos-print-template-panel" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>Chọn mẫu in</h2>
              <button className="close-btn close-btn--emphasis" type="button" onClick={() => setShowPrintTemplatePicker(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body">
              <p className="pos-print-template-note">Đơn hàng đã tạo thành công. Vui lòng chọn mẫu in:</p>
              <div className="pos-print-template-list">
                <label className={`pos-print-template-item ${selectedPrintTemplate === "pos" ? "active" : ""}`}>
                  <input
                    type="radio"
                    name="print-template"
                    value="pos"
                    checked={selectedPrintTemplate === "pos"}
                    onChange={(e) => setSelectedPrintTemplate(e.target.value)}
                  />
                  <div>
                    <strong>Mẫu POS (mặc định)</strong>
                    <p>📄 Khổ 80 mm × cuộn — Phù hợp máy in nhiệt tại quầy.</p>
                  </div>
                </label>

                <label className={`pos-print-template-item ${selectedPrintTemplate === "a5_delivery" ? "active" : ""}`}>
                  <input
                    type="radio"
                    name="print-template"
                    value="a5_delivery"
                    checked={selectedPrintTemplate === "a5_delivery"}
                    onChange={(e) => setSelectedPrintTemplate(e.target.value)}
                  />
                  <div>
                    <strong>Mẫu A5: Phiếu giao hàng</strong>
                    <p>📄 Khổ A5 (148 × 210 mm) — Thông tin giao nhận, danh sách hàng hóa và ô ký nhận.</p>
                  </div>
                </label>

                <label className={`pos-print-template-item ${selectedPrintTemplate === "a4_notice" ? "active" : ""}`}>
                  <input
                    type="radio"
                    name="print-template"
                    value="a4_notice"
                    checked={selectedPrintTemplate === "a4_notice"}
                    onChange={(e) => setSelectedPrintTemplate(e.target.value)}
                  />
                  <div>
                    <strong>Mẫu A4: Phiếu báo tiền</strong>
                    <p>📄 Khổ A4 (210 × 297 mm) — Bố cục chuyên nghiệp, tập trung tổng giá trị đơn hàng để xác nhận.</p>
                  </div>
                </label>

                <label className={`pos-print-template-item ${selectedPrintTemplate === "a4_invoice" ? "active" : ""}`}>
                  <input
                    type="radio"
                    name="print-template"
                    value="a4_invoice"
                    checked={selectedPrintTemplate === "a4_invoice"}
                    onChange={(e) => setSelectedPrintTemplate(e.target.value)}
                  />
                  <div>
                    <strong>Mẫu A4: Hóa đơn bán hàng</strong>
                    <p>📄 Khổ A4 (210 × 297 mm) — Hóa đơn chính thức với đầy đủ thông tin khách hàng, chi tiết hàng hóa và ký xác nhận.</p>
                  </div>
                </label>
              </div>
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setShowPrintTemplatePicker(false);
                  setCreatedOrderForPrint(null);
                  setSelectedPrintTemplate("pos");
                }}
              >
                Bỏ qua
              </button>
              <button type="button" className="btn-primary" onClick={handlePrintSelectedTemplate}>
                In theo mẫu đã chọn
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showQuickReceiptDialog ? (
        <div className="dialog-overlay" onClick={() => setShowQuickReceiptDialog(false)}>
          <div className="dialog-panel dialog-panel--receipt-create" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Thu tiền khách hàng</h2>
                <p className="product-create-subtitle">Tạo phiếu thu nhanh ngay tại màn hình tạo đơn.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowQuickReceiptDialog(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body product-create-body">
              <section className="detail-card">
                <div className="cinfo-row"><span>Khách hàng</span><span>{quickReceiptCustomerSnapshot?.name || selectedCustomer?.name || "-"}</span></div>
                <div className="cinfo-row"><span>Số điện thoại</span><span>{quickReceiptCustomerSnapshot?.phone || selectedCustomer?.phone || "-"}</span></div>
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 12 }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Số tiền thu</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="payment-no-spin"
                    placeholder="0"
                    style={{ textAlign: "right" }}
                    value={formatMoney(quickReceipt.amount)}
                    onChange={(e) => setQuickReceipt((prev) => ({ ...prev, amount: parseMoneyInput(e.target.value) }))}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label>Chiết khấu</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="payment-no-spin"
                    placeholder="0"
                    style={{ textAlign: "right" }}
                    value={formatMoney(quickReceipt.discountAmount)}
                    onChange={(e) => setQuickReceipt((prev) => ({ ...prev, discountAmount: parseMoneyInput(e.target.value) }))}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label>Ghi chú</label>
                  <input
                    value={quickReceipt.note}
                    onChange={(e) => setQuickReceipt((prev) => ({ ...prev, note: e.target.value }))}
                    placeholder="Tùy chọn"
                  />
                </div>
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 10 }}>
                <div className="cinfo-row"><span>Đơn hàng cần thu</span><span>{quickReceiptDebtOrders.length} đơn</span></div>
                <div className="cinfo-row cinfo-highlight"><span>Tổng nợ đơn chọn</span><span>{formatCurrency(quickReceiptSelectedDebt)}</span></div>
                <div
                  style={{
                    marginTop: 0,
                    padding: "8px 10px",
                    border: "1px solid #c9d8ff",
                    borderRadius: 8,
                    background: "#f3f7ff",
                    color: "#1f3f8f",
                    fontSize: 13
                  }}
                >
                  <strong>Lưu ý quan trọng:</strong> Nếu không chọn đơn cụ thể, hệ thống sẽ ưu tiên cấn số dư đầu kỳ trước,
                  sau đó mới phân bổ vào đơn nợ từ cũ đến mới.
                </div>
                <div className="customer-empty" style={{ marginTop: 0 }}>Mẹo: Chọn đơn cụ thể nếu bạn muốn chỉ định đơn được cấn trước.</div>
                {loadingQuickReceiptOrders ? (
                  <div className="customer-empty">Đang tải lại danh sách đơn hàng...</div>
                ) : null}
                {quickReceiptDebtOrders.length ? (
                  <div className="quick-receipt-order-list" role="listbox" aria-label="Đơn hàng công nợ">
                    {quickReceiptDebtOrders.map((order) => {
                      const checked = quickReceiptSelectedOrderIds.includes(order.id);
                      const totalAmount = Math.max(Number(order.totalAmount || 0), 0);
                      const paidAmount = getOrderPaidAmount(order);
                      const debtAmount = getQuickReceiptOrderDebt(order);
                      const orderSummary = buildOrderItemsSummary(order);
                      return (
                        <label key={order.id} className={`quick-receipt-order-item ${checked ? "selected" : ""}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleQuickReceiptOrder(order.id)}
                          />
                          <div>
                            <strong>{order.orderNo || order.id?.slice(0, 8) || "-"}</strong>
                            <p className="quick-receipt-order-meta">Ngày tạo: {formatDateTimeVN(order.createdAt)}</p>
                            <p className="quick-receipt-order-summary">Tóm tắt: {orderSummary}</p>
                            <p className="quick-receipt-order-meta">
                              Tổng đơn: {formatCurrency(totalAmount)} • Đã thu: {formatCurrency(paidAmount)} • Còn nợ: {formatCurrency(debtAmount)}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="customer-empty" style={{ display: "grid", gap: 8 }}>
                    <span>Khách hàng này hiện không có đơn hàng còn nợ</span>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => refreshQuickReceiptOrders({ customerId: activeQuickReceiptCustomerId, reloadAll: true })}
                      disabled={loadingQuickReceiptOrders}
                    >
                      {loadingQuickReceiptOrders ? "Đang tải..." : "Tải lại danh sách đơn"}
                    </button>
                  </div>
                )}
              </section>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowQuickReceiptDialog(false)}>
                Hủy
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={submitQuickReceipt}
                disabled={
                  isSubmittingQuickReceipt
                  || (Number(quickReceipt.amount || 0) <= 0 && Number(quickReceipt.discountAmount || 0) <= 0)
                }
              >
                {isSubmittingQuickReceipt ? "Đang lưu..." : "Lưu phiếu thu"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDebtExportDialog ? (
        <div className="dialog-overlay" onClick={() => setShowDebtExportDialog(false)}>
          <div className="dialog-panel dialog-panel--debt-export" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Xuất Excel công nợ còn treo</h2>
                <p className="product-create-subtitle">Cho phép bật/tắt tính lãi trước khi xuất bảng kê công nợ.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowDebtExportDialog(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body product-create-body">
              <section className="detail-card" style={{ display: "grid", gap: 8 }}>
                <div className="cinfo-row"><span>Khách hàng</span><span>{selectedCustomer?.name || "-"}</span></div>
                <div className="cinfo-row"><span>Số điện thoại</span><span>{selectedCustomer?.phone || "-"}</span></div>
                <div className="cinfo-row"><span>Địa chỉ</span><span>{selectedCustomer?.address || "-"}</span></div>
              </section>

              <section className="detail-card debt-export-controls">
                <label>
                  Ngày tính lãi
                  <input
                    type="date"
                    value={debtExportDate}
                    onChange={(e) => setDebtExportDate(e.target.value)}
                  />
                </label>
                <label>
                  Mức lãi suất/ngày
                  <input type="text" value={DAILY_INTEREST_RATE} disabled />
                </label>
                <label>
                  Không tính lãi
                  <input
                    type="checkbox"
                    checked={!debtIncludeInterest}
                    onChange={(e) => setDebtIncludeInterest(!e.target.checked)}
                  />
                </label>
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 8 }}>
                <div className="cinfo-row"><span>Tổng nợ gốc còn treo</span><span>{formatCurrency(debtExportTotals.principal)}</span></div>
                <div className="cinfo-row"><span>Tổng tiền lãi</span><span>{formatCurrency(debtExportTotals.interest)}</span></div>
                <div className="cinfo-row cinfo-highlight"><span>Tổng cộng</span><span>{formatCurrency(debtExportTotals.payable)}</span></div>
              </section>

              <section className="detail-card debt-export-list-shell">
                {debtExportLoading ? (
                  <div className="customer-empty">Đang tải dữ liệu công nợ...</div>
                ) : debtExportRows.length ? (
                  <table className="simple-table">
                    <thead>
                      <tr>
                        <th>STT</th>
                        <th>Ngày chứng từ</th>
                        <th>Số chứng từ</th>
                        <th>Tóm tắt đơn hàng / Đã thanh toán</th>
                        <th className="text-right">Số tiền</th>
                        <th className="text-right">Số ngày</th>
                        <th className="text-right">Số tiền lãi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debtExportRows.map((row) => (
                        <tr key={`${row.referenceId}-${row.index}`}>
                          <td>{row.index}</td>
                          <td>{row.documentDateLabel}</td>
                          <td className="mono">{row.documentNo}</td>
                          <td>
                            <div>{row.orderSummary || "-"}</div>
                            <div style={{ color: "#0f766e", fontStyle: "italic", marginTop: 2 }}>
                              Đã thanh toán: {formatCurrency(row.paidAmount)}
                            </div>
                          </td>
                          <td className="text-right mono">{formatCurrency(row.amount)}</td>
                          <td className="text-right">{formatNumber(row.overdueDays)}</td>
                          <td className="text-right mono">{formatCurrency(row.interestAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="customer-empty">Không có khoản nợ treo để xuất</div>
                )}
              </section>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowDebtExportDialog(false)}>
                Hủy
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={exportDebtAgingExcel}
                disabled={debtExportLoading}
              >
                Xuất Excel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCustomerNotesDialog ? (
        <div className="dialog-overlay" onClick={() => setShowCustomerNotesDialog(false)}>
          <div className="dialog-panel dialog-panel--customer-note" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Ghi chú khách hàng</h2>
                <p className="product-create-subtitle">Theo dõi lịch sử ghi chú theo khách hàng, có thể đánh dấu sao cho ghi chú quan trọng.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowCustomerNotesDialog(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body" style={{ display: "grid", gap: 12 }}>
              <section className="detail-card">
                <div className="cinfo-row"><span>Khách hàng</span><span>{selectedCustomer?.name || "-"}</span></div>
                <div className="cinfo-row"><span>Mã khách hàng</span><span>{selectedCustomer?.code || selectedCustomer?.id?.slice(0, 8) || "-"}</span></div>
                <div className="cinfo-row"><span>Mã sổ gốc</span><span>{selectedCustomer?.ledgerCode || "-"}</span></div>
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 10 }}>
                <h3 style={{ margin: 0 }}>Lịch sử ghi chú</h3>
                {loadingCustomerNotes ? (
                  <p style={{ margin: 0 }}>Đang tải ghi chú...</p>
                ) : customerNotes.length ? (
                  <div className="customer-note-list">
                    {customerNotes.map((note) => {
                      const creatorName = note?.creator?.fullName || note?.creator?.email || "Không rõ người tạo";
                      return (
                        <article key={note.id} className={`customer-note-item ${note.isStarred ? "starred" : ""}`}>
                          <div className="customer-note-head">
                            <strong>{note.isStarred ? "★ Ghi chú quan trọng" : "Ghi chú"}</strong>
                            <span>{formatDateTimeVN(note.createdAt)}</span>
                          </div>
                          <p>{note.content}</p>
                          <small>Tạo bởi: {creatorName}</small>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="customer-empty">Khách hàng này chưa có ghi chú nào</div>
                )}
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 10 }}>
                <h3 style={{ margin: 0 }}>Tạo ghi chú mới</h3>
                <textarea
                  rows={4}
                  value={customerNoteForm.content}
                  onChange={(e) => setCustomerNoteForm((prev) => ({ ...prev, content: e.target.value }))}
                  placeholder="Nhập nội dung ghi chú liên quan đến khách hàng"
                />
                <label className="order-option-toggle" style={{ width: "fit-content" }}>
                  <input
                    type="checkbox"
                    checked={customerNoteForm.isStarred}
                    onChange={(e) => setCustomerNoteForm((prev) => ({ ...prev, isStarred: e.target.checked }))}
                  />
                  Gắn sao cho ghi chú này
                </label>
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowCustomerNotesDialog(false)}>
                Đóng
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={submitCustomerNote}
                disabled={creatingCustomerNote || !customerNoteForm.content.trim()}
              >
                {creatingCustomerNote ? "Đang lưu..." : "Lưu ghi chú"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showEditCustomerDialog ? (
        <div className="dialog-overlay" onClick={() => setShowEditCustomerDialog(false)}>
          <div className="dialog-panel dialog-panel--customer-edit" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Sửa thông tin khách hàng</h2>
                <p className="product-create-subtitle">Cập nhật nhanh hồ sơ khách hàng ngay tại màn hình tạo đơn.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowEditCustomerDialog(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {customerFormMessage ? (
                <div className="field-error" style={{ gridColumn: "1 / -1" }}>{customerFormMessage}</div>
              ) : null}

              <div className="form-group" style={{ margin: 0 }}>
                <label>Tên khách hàng</label>
                <input
                  className={customerFormErrors.name ? "form-control form-control--invalid" : "form-control"}
                  style={{ fontWeight: "bold" }}
                  value={customerForm.name}
                  onChange={(e) => handleCustomerFormChange("name", e.target.value)}
                  placeholder="Nhập họ tên khách hàng"
                />
                {customerFormErrors.name ? <div className="field-error">{customerFormErrors.name}</div> : null}
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label>Mã sổ gốc</label>
                <input
                  style={{ fontWeight: "bold" }}
                  value={customerForm.ledgerCode}
                  onChange={(e) => handleCustomerFormChange("ledgerCode", e.target.value)}
                  placeholder="Ví dụ: SG-KH-001"
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label>Số điện thoại</label>
                <input
                  className={customerFormErrors.phone ? "form-control form-control--invalid" : "form-control"}
                  style={{ fontWeight: "bold" }}
                  value={customerForm.phone}
                  onChange={(e) => handleCustomerFormChange("phone", e.target.value)}
                  placeholder="Nhập số điện thoại"
                />
                {customerFormErrors.phone ? <div className="field-error">{customerFormErrors.phone}</div> : null}
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label>Số điện thoại 2</label>
                <input
                  className={customerFormErrors.phone2 ? "form-control form-control--invalid" : "form-control"}
                  style={{ fontWeight: "bold" }}
                  value={customerForm.phone2}
                  onChange={(e) => handleCustomerFormChange("phone2", e.target.value)}
                  placeholder="Nhập số điện thoại phụ"
                />
                {customerFormErrors.phone2 ? <div className="field-error">{customerFormErrors.phone2}</div> : null}
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label>Số điện thoại 3</label>
                <input
                  className={customerFormErrors.phone3 ? "form-control form-control--invalid" : "form-control"}
                  style={{ fontWeight: "bold" }}
                  value={customerForm.phone3}
                  onChange={(e) => handleCustomerFormChange("phone3", e.target.value)}
                  placeholder="Nhập số điện thoại phụ thứ 2"
                />
                {customerFormErrors.phone3 ? <div className="field-error">{customerFormErrors.phone3}</div> : null}
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label>Email</label>
                <input
                  className={customerFormErrors.email ? "form-control form-control--invalid" : "form-control"}
                  style={{ fontWeight: "bold" }}
                  value={customerForm.email}
                  onChange={(e) => handleCustomerFormChange("email", e.target.value)}
                  placeholder="Nhập email"
                />
                {customerFormErrors.email ? <div className="field-error">{customerFormErrors.email}</div> : null}
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label>Vị trí phụ trách</label>
                <select
                  style={{ fontWeight: "bold" }}
                  value={customerForm.accountOwnerPositionId}
                  onChange={(e) => handleCustomerFormChange("accountOwnerPositionId", e.target.value)}
                >
                  <option value="">Chưa gán vị trí</option>
                  {positionOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label>Loại khách hàng</label>
                <select
                  style={{ fontWeight: "bold" }}
                  value={customerForm.customerPriceTier}
                  onChange={(e) => handleCustomerFormChange("customerPriceTier", e.target.value)}
                >
                  <option value="">Mặc định</option>
                  <option value="LEVEL_2">Cấp 2</option>
                  <option value="LEVEL_2_SPECIAL">Cấp 2 đặc biệt</option>
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label>Khu vực kinh doanh</label>
                <select
                  style={{ fontWeight: "bold" }}
                  value={customerForm.businessAreaId}
                  onChange={(e) => handleCustomerFormChange("businessAreaId", e.target.value)}
                >
                  <option value="">Chưa gán khu vực</option>
                  {businessAreas.map((area) => (
                    <option key={area.id} value={area.id}>{area.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ margin: 0, gridColumn: "1 / -1" }}>
                <label>Địa chỉ</label>
                <textarea
                  style={{ fontWeight: "bold" }}
                  value={customerForm.address}
                  onChange={(e) => handleCustomerFormChange("address", e.target.value)}
                  rows={3}
                  placeholder="Nhập địa chỉ"
                />
              </div>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowEditCustomerDialog(false)} disabled={savingCustomerInfo}>
                Hủy
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={submitCustomerInfo}
                disabled={savingCustomerInfo}
              >
                {savingCustomerInfo ? "Đang lưu..." : "Lưu thông tin"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showFacebookAudienceDialog ? (
        <div className="dialog-overlay" onClick={() => setShowFacebookAudienceDialog(false)}>
          <div className="dialog-panel dialog-panel--facebook-audience" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Quảng cáo Facebook</h2>
                <p className="product-create-subtitle">Khách hàng này đang có trong những đối tượng tùy chỉnh nào, và có thể thêm hoặc xóa ngay tại đây.</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowFacebookAudienceDialog(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: 12 }}>
              <section className="detail-card detail-card-grid">
                <div className="cinfo-row"><span>Khách hàng</span><span>{selectedCustomer?.name || "-"}</span></div>
                <div className="cinfo-row"><span>Email</span><span>{selectedCustomer?.email || "-"}</span></div>
                <div className="cinfo-row"><span>SĐT 1</span><span>{selectedCustomer?.phone || "-"}</span></div>
                <div className="cinfo-row"><span>SĐT 2</span><span>{selectedCustomer?.phone2 || "-"}</span></div>
                <div className="cinfo-row"><span>SĐT 3</span><span>{selectedCustomer?.phone3 || "-"}</span></div>
                <div className="facebook-audience-summary-pill">
                  Đang thuộc {facebookAudiences.filter((audience) => Boolean(audience?.matchedDetail?.id)).length} audience
                </div>
              </section>

              <section className="detail-card" style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <h3 style={{ margin: 0 }}>Danh sách đối tượng tùy chỉnh</h3>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={() => void loadFacebookAudiencesForSelectedCustomer()}
                      disabled={facebookAudienceLoading}
                    >
                      {facebookAudienceLoading ? "Đang tải..." : "Làm mới"}
                    </button>
                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={() => {
                        setShowFacebookAudienceDialog(false);
                        openEditCustomerDialog();
                      }}
                      disabled={!canEditCustomerInfo || !onUpdateCustomerInfo}
                    >
                      Cập nhật email và số điện thoại
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) auto", gap: 10, alignItems: "center" }}>
                  <input
                    type="text"
                    value={facebookAudienceSearch}
                    onChange={(e) => setFacebookAudienceSearch(e.target.value)}
                    placeholder="Tìm theo tên audience, mô tả hoặc Facebook ID"
                  />
                  <label className="order-option-toggle" style={{ width: "fit-content", whiteSpace: "nowrap" }}>
                    <input
                      type="checkbox"
                      checked={facebookAudienceOnlyMember}
                      onChange={(e) => setFacebookAudienceOnlyMember(e.target.checked)}
                    />
                    Chỉ hiện audience đang có
                  </label>
                </div>

                {facebookAudienceMessage ? (
                  <div className={facebookAudienceMessage.startsWith("Lỗi:") ? "field-error" : "info-box"}>{facebookAudienceMessage}</div>
                ) : null}

                {facebookAudienceLoading ? (
                  <div className="customer-empty">Đang tải đối tượng tùy chỉnh...</div>
                ) : (() => {
                  const keyword = facebookAudienceSearch.trim().toLowerCase();
                  const filteredAudiences = facebookAudiences
                    .filter((audience) => {
                      const isMember = Boolean(audience?.matchedDetail?.id);
                      if (facebookAudienceOnlyMember && !isMember) {
                        return false;
                      }
                      if (!keyword) {
                        return true;
                      }
                      return [audience?.name, audience?.description, audience?.facebookAudienceId]
                        .some((value) => String(value || "").toLowerCase().includes(keyword));
                    })
                    .sort((left, right) => {
                      const leftMember = Boolean(left?.matchedDetail?.id);
                      const rightMember = Boolean(right?.matchedDetail?.id);
                      if (leftMember !== rightMember) {
                        return leftMember ? -1 : 1;
                      }
                      return String(left?.name || "").localeCompare(String(right?.name || ""), "vi");
                    });

                  return filteredAudiences.length ? (
                  <div className="table-container" style={{ margin: 0 }}>
                    <table className="simple-table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Tên đối tượng</th>
                          <th>Facebook ID</th>
                          <th>Thành viên</th>
                          <th>Trạng thái</th>
                          <th>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAudiences.map((audience) => {
                          const isMember = Boolean(audience?.matchedDetail?.id);
                          const memberCount = Array.isArray(audience?.details)
                            ? audience.details.length
                            : Number(audience?.detailCount || 0);
                          return (
                            <tr key={audience.id}>
                              <td>
                                <div>{audience.name || "-"}</div>
                                <div className="facebook-audience-description">{audience.description || "Không có mô tả"}</div>
                              </td>
                              <td className="mono">{audience.facebookAudienceId || "-"}</td>
                              <td className="mono">{memberCount}</td>
                              <td>
                                <span className={`facebook-audience-pill ${isMember ? "is-member" : "is-idle"}`}>
                                  {isMember ? "Đang có" : "Chưa có"}
                                </span>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className={isMember ? "btn-cancel" : "btn-primary"}
                                  onClick={() => void toggleCustomerAudienceMembership(audience)}
                                  disabled={facebookAudienceSavingId === audience.id}
                                >
                                  {facebookAudienceSavingId === audience.id ? "Đang lưu..." : isMember ? "Xóa khỏi đối tượng" : "Thêm vào đối tượng"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  ) : (
                    <div className="customer-empty">
                      {facebookAudiences.length
                        ? "Không có audience nào khớp bộ lọc hiện tại."
                        : "Chưa có đối tượng tùy chỉnh nào để quản lý."}
                    </div>
                  );
                })()}
              </section>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowFacebookAudienceDialog(false)}>
                Đóng
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setShowFacebookAudienceDialog(false);
                  openEditCustomerDialog();
                }}
                disabled={!canEditCustomerInfo || !onUpdateCustomerInfo}
              >
                Mở sửa thông tin khách hàng
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showCustomerOverviewDialog ? (
        <div className="dialog-overlay" onClick={() => setShowCustomerOverviewDialog(false)}>
          <div className="dialog-panel" style={{ maxWidth: 640, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Tổng quan khách hàng</h2>
                <p className="product-create-subtitle">{selectedCustomer?.name}{selectedCustomer?.phone ? ` · ${selectedCustomer.phone}` : ""}</p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowCustomerOverviewDialog(false)} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body product-create-body">
              {/* Period tabs */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                {[
                  { key: "this-week", label: "Tuần này" },
                  { key: "this-month", label: "Tháng này" },
                  { key: "this-quarter", label: "Quý này" },
                  { key: "this-year", label: "Năm nay" },
                  { key: "last-year", label: "Năm trước" }
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    className={customerOverviewPreset === key ? "btn-primary" : "btn-cancel"}
                    style={{ padding: "4px 12px", fontSize: "0.8rem" }}
                    onClick={() => {
                      setCustomerOverviewPreset(key);
                      void loadOverviewForPreset(selectedCustomer.id, key);
                    }}
                  >{label}</button>
                ))}
              </div>

              {customerOverviewLoading ? (
                <div className="customer-empty" style={{ padding: "24px 0" }}>Đang tải dữ liệu...</div>
              ) : customerOverviewData ? (() => {
                const ov = customerOverviewData;
                const fmt = (v) => formatCurrency(v || 0);
                const fmtN = (v) => formatNumber(v || 0);

                // ── Tuổi nợ ────────────────────────────────────────
                const agingColors = { current: "#16a34a", "1-30": "#ca8a04", "31-60": "#ea580c", "61-90": "#dc2626", ">90": "#7f1d1d" };
                const agingLabels = { current: "Chưa đến hạn", "1-30": "1–30 ngày", "31-60": "31–60 ngày", "61-90": "61–90 ngày", ">90": ">90 ngày" };
                const agingBuckets = ov.aging?.buckets || [];
                const maxAgingAmt = Math.max(...agingBuckets.map((b) => b.amount), 1);

                // ── KPI cards ──────────────────────────────────────
                const kpiCards = [
                  { label: "Doanh thu", value: fmt(ov.period?.revenue), color: "#0ea5e9" },
                  { label: "Tổng đơn", value: fmtN(ov.period?.totalOrders), color: "#8b5cf6" },
                  { label: "Số thu ròng", value: fmt(ov.period?.netCollection), color: "#10b981" },
                  { label: "Số dư ròng", value: fmt(ov.period?.netBalance), color: ov.period?.netBalance > 0 ? "#ef4444" : "#16a34a" },
                  { label: "Giá trị tặng quà", value: fmt(ov.period?.giftValue), color: "#f59e0b" }
                ];

                // ── Chart helpers ─────────────────────────────────
                const monthLabel = (m) => {
                  const [y, mo] = m.split("-");
                  return `T${parseInt(mo)}/${y.slice(2)}`;
                };
                const renderBarChart = (rows, valueKey, color) => {
                  const maxVal = Math.max(...rows.map((r) => r[valueKey]), 1);
                  return (
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 80, marginTop: 8 }}>
                      {rows.map((r) => {
                        const h = Math.max(4, Math.round((r[valueKey] / maxVal) * 72));
                        return (
                          <div key={r.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <div
                              title={`${monthLabel(r.month)}: ${formatCurrency(r[valueKey])}`}
                              style={{ width: "100%", height: h, background: r[valueKey] > 0 ? color : "#e2e8f0", borderRadius: "3px 3px 0 0" }}
                            />
                            <span style={{ fontSize: "0.6rem", color: "#94a3b8", lineHeight: 1 }}>{monthLabel(r.month)}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                };

                return (
                  <>
                    {/* Tuổi nợ */}
                    <section className="detail-card" style={{ display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <strong style={{ fontSize: "0.85rem" }}>Tuổi nợ</strong>
                        <span style={{ fontSize: "0.8rem", color: ov.aging?.totalDebt > 0 ? "#ef4444" : "#16a34a", fontVariantNumeric: "tabular-nums" }}>
                          Tổng: {fmt(ov.aging?.totalDebt)}
                        </span>
                      </div>
                      {agingBuckets.filter((b) => b.amount > 0).length === 0 ? (
                        <div style={{ fontSize: "0.8rem", color: "#16a34a" }}>Không có nợ tồn đọng ✓</div>
                      ) : agingBuckets.map((b) => (
                        <div key={b.bucket} style={{ display: "grid", gap: 3 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                            <span style={{ color: agingColors[b.bucket] || "#64748b" }}>{agingLabels[b.bucket] || b.bucket}</span>
                            <span className="mono">{fmt(b.amount)}</span>
                          </div>
                          <div style={{ background: "#e2e8f0", borderRadius: 3, height: 6, overflow: "hidden" }}>
                            <div style={{ width: `${Math.round((b.amount / maxAgingAmt) * 100)}%`, height: 6, background: agingColors[b.bucket] || "#94a3b8", borderRadius: 3 }} />
                          </div>
                        </div>
                      ))}
                    </section>

                    {/* KPI cards */}
                    <section className="detail-card">
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
                        {kpiCards.map((card) => (
                          <div key={card.label} style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px", border: "1px solid #e2e8f0" }}>
                            <div style={{ fontSize: "0.72rem", color: "#64748b", marginBottom: 4 }}>{card.label}</div>
                            <div style={{ fontSize: "0.92rem", fontWeight: 700, color: card.color, fontVariantNumeric: "tabular-nums" }}>{card.value}</div>
                          </div>
                        ))}
                      </div>
                    </section>

                    {/* Biểu đồ doanh thu 12 tháng */}
                    <section className="detail-card" style={{ display: "grid", gap: 4 }}>
                      <strong style={{ fontSize: "0.85rem" }}>Doanh thu 12 tháng gần nhất</strong>
                      {renderBarChart(ov.monthlyRevenue || [], "revenue", "#0ea5e9")}
                    </section>

                    {/* Biểu đồ số tiền thu 12 tháng */}
                    <section className="detail-card" style={{ display: "grid", gap: 4 }}>
                      <strong style={{ fontSize: "0.85rem" }}>Số tiền thu 12 tháng gần nhất</strong>
                      {renderBarChart(ov.monthlyCollection || [], "amount", "#10b981")}
                    </section>
                  </>
                );
              })() : (
                <div className="customer-empty" style={{ padding: "24px 0" }}>Không tải được dữ liệu. Vui lòng thử lại.</div>
              )}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowCustomerOverviewDialog(false)}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {showPriceDialog ? (
        <div className="dialog-overlay dialog-overlay--stack" onClick={closePriceDialog}>
          <div className="dialog-panel dialog-panel--price" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h2>Bảng giá riêng {selectedCustomer ? `- ${selectedCustomer.name}` : ""}</h2>
              <button className="close-btn close-btn--emphasis" type="button" onClick={closePriceDialog} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body">
              {pricePanelLoading ? (
                <p>Đang tải bảng giá...</p>
              ) : (
                <>
                  <div className="detail-section">
                    <div className="form-row">
                      <div className="form-group">
                        <label>Sản phẩm</label>
                        <SearchableSelect
                          value={priceForm.productId}
                          onChange={(val) => handlePriceProductChange(val)}
                          options={productOptionsForPriceDialog}
                          searchPlaceholder="Tìm theo mã, tên, đơn vị..."
                        />
                      </div>
                      <div className="form-group">
                        <label>Giá áp dụng</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          style={{ textAlign: "right" }}
                          value={formatMoneyInput(priceForm.price)}
                          onChange={(e) => setPriceForm((prev) => ({ ...prev, price: parseMoneyInput(e.target.value) }))}
                        />
                      </div>
                    </div>
                    <div className="detail-actions">
                      <button type="button" className="btn-primary" onClick={submitPriceDialog} disabled={!priceForm.productId || Number(priceForm.price) <= 0}>
                        Lưu giá riêng
                      </button>
                      <button type="button" className="btn-secondary" onClick={() => setShowCopyPricePanel(true)} disabled={!selectedCustomer?.id}>
                        Sao chép từ khách khác
                      </button>
                    </div>
                  </div>

                  <div className="detail-section">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                      <h3 style={{ margin: 0 }}>Bảng giá riêng hiện có</h3>
                      <input
                        type="text"
                        placeholder="Tìm theo mã, tên, đơn vị..."
                        value={priceDialogFilter}
                        onChange={(e) => setPriceDialogFilter(e.target.value)}
                        style={{ width: 200, padding: "6px 10px", border: "1px solid var(--line)", borderRadius: "8px", fontFamily: "inherit" }}
                      />
                    </div>
                    <div className="list-shell">
                      <table className="simple-table">
                        <thead>
                          <tr>
                            <th>Mã</th>
                            <th>Sản phẩm</th>
                            <th>Đơn vị</th>
                            <th className="text-right">Giá riêng</th>
                            <th className="text-right">Giá mặc định</th>
                            <th className="text-right">Chênh lệch</th>
                            <th className="text-right">Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredPriceDialogRows.length ? (
                            filteredPriceDialogRows.map((row) => {
                              const customPrice = Number(row.price);
                              const defaultPrice = Number(row.product?.defaultPrice || 0);
                              const diff = customPrice - defaultPrice;
                              const diffPercent = defaultPrice > 0 ? ((diff / defaultPrice) * 100).toFixed(1) : 0;
                              return (
                                <tr
                                  key={row.id}
                                  className={row.productId === priceForm.productId ? "customer-price-row customer-price-row--active" : "customer-price-row"}
                                  onClick={() => handlePriceProductChange(row.productId)}
                                  title="Bấm để nạp dòng này lên form chỉnh giá"
                                >
                                  <td className="mono">{row.product?.sku || row.productId.slice(0, 8)}</td>
                                  <td>{row.product?.name || row.productId}</td>
                                  <td>{row.product?.unit || "-"}</td>
                                  <td className="text-right mono">{formatCurrency(customPrice)}</td>
                                  <td className="text-right mono">{formatCurrency(defaultPrice)}</td>
                                  <td className="text-right mono" style={{ color: diff > 0 ? "#2b8a3e" : diff < 0 ? "#c92a2a" : "#666" }}>
                                    {formatCurrency(diff)} ({diffPercent}%)
                                  </td>
                                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="btn-cancel"
                                      style={{ padding: "4px 10px", fontSize: 12 }}
                                      disabled={deletingPriceRowId === row.id}
                                      onClick={() => deletePriceDialogRow(row)}
                                    >
                                      {deletingPriceRowId === row.id ? "Đang xóa..." : "Xóa"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })
                          ) : (
                            <tr>
                              <td colSpan="7" className="text-center">Chưa có bảng giá riêng</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={closePriceDialog}>Đóng</button>
            </div>

            {showCopyPricePanel ? (
              <div className="dialog-overlay dialog-overlay--stack" onClick={() => setShowCopyPricePanel(false)}>
                <div className="dialog-panel" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
                  <div className="dialog-header">
                    <h3>Sao chép bảng giá từ khách hàng khác</h3>
                    <button className="close-btn close-btn--emphasis" type="button" onClick={() => setShowCopyPricePanel(false)} aria-label="Đóng">x</button>
                  </div>
                  <div className="dialog-body">
                    <div className="detail-section">
                      <label>Chọn khách hàng để sao chép:</label>
                      <div style={{ marginTop: 8 }}>
                        <SearchableSelect
                          value={copySourceCustomerId}
                          onChange={setCopySourceCustomerId}
                          options={copySourceCustomerOptions}
                          allLabel="-- Chọn khách hàng --"
                          searchPlaceholder="Tìm theo tên, số điện thoại, địa chỉ..."
                        />
                      </div>
                    </div>
                  </div>
                  <div className="dialog-footer">
                    <button type="button" className="btn-cancel" onClick={() => setShowCopyPricePanel(false)}>Hủy</button>
                    <button type="button" className="btn-primary" onClick={copyPriceListFromCustomer} disabled={!copySourceCustomerId || pricePanelLoading}>
                      {pricePanelLoading ? "Đang sao chép..." : "Sao chép"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {consultProduct ? (
        <div className="dialog-overlay" onClick={closeConsultPanel}>
          <div className="dialog-panel dialog-panel--consult" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Thông tin tư vấn sản phẩm</h2>
                <p className="product-create-subtitle">Xem nhanh thành phần, công dụng và hướng dẫn sử dụng để tư vấn khách tại quầy.</p>
              </div>
              <button className="close-btn" type="button" onClick={closeConsultPanel} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body consult-body">
              <section className="detail-card consult-product-summary">
                <div className="consult-product-head">
                  <div className="product-thumb-wrap consult-product-thumb-wrap">
                    {consultProduct?.imageUrl ? (
                      <img className="product-thumb" src={consultProduct.imageUrl} alt={consultProduct?.name || "Sản phẩm"} />
                    ) : (
                      <div className="product-thumb product-thumb-fallback">{(consultProduct?.name || "SP").slice(0, 2).toUpperCase()}</div>
                    )}
                  </div>
                  <div className="consult-product-title">
                    <strong>{consultProduct?.name || "-"}</strong>
                    <small>{consultProduct?.sku || "-"}</small>
                  </div>
                </div>
                <div className="cinfo-row"><span>Mã sản phẩm</span><span>{consultProduct?.sku || "-"}</span></div>
                <div className="cinfo-row"><span>Tên sản phẩm</span><span>{consultProduct?.name || "-"}</span></div>
                <div className="cinfo-row"><span>Đơn vị</span><span>{consultProduct?.unit || "-"}</span></div>
              </section>

              <section className="detail-card consult-section-card">
                <h3>Thành phần</h3>
                {consultSections.ingredients.length ? (
                  <ul>
                    {consultSections.ingredients.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : (
                  <p className="consult-empty">Chưa có dữ liệu thành phần. Có thể bổ sung trong thông tin sản phẩm.</p>
                )}
              </section>

              <section className="detail-card consult-section-card">
                <h3>Công dụng</h3>
                {consultSections.benefits.length ? (
                  <ul>
                    {consultSections.benefits.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : (
                  <p className="consult-empty">Chưa có dữ liệu công dụng. Có thể bổ sung trong thông tin sản phẩm.</p>
                )}
              </section>

              <section className="detail-card consult-section-card">
                <h3>Hướng dẫn sử dụng</h3>
                {consultSections.usage.length ? (
                  <ul>
                    {consultSections.usage.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : (
                  <p className="consult-empty">Chưa có dữ liệu hướng dẫn sử dụng. Có thể bổ sung trong thông tin sản phẩm.</p>
                )}
              </section>

              <section className="detail-card consult-section-card">
                <h3>Chi tiết chương trình khuyến mãi</h3>
                {consultPromotionDetails.length ? (
                  <div className="consult-promo-list">
                    {consultPromotionDetails.map((promo) => (
                      <article key={promo.id} className="consult-promo-item">
                        <div className="consult-promo-head">
                          <strong>{promo.name}</strong>
                          <span className={`consult-promo-status ${promo.statusClass}`}>{promo.status}</span>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ marginLeft: "auto", padding: "2px 10px", fontSize: 12 }}
                            onClick={async () => {
                              const reward = promo.rewardQty > 0
                                ? `Tặng ${promo.rewardQty} x ${promo.rewardName}`
                                : "Theo cấu hình CTKM";
                              const text = `🎁 ${promo.name} (${promo.status})\nThời gian: ${promo.startDateLabel} - ${promo.endDateLabel}\nĐiều kiện: Mua ${promo.triggerQty} x ${promo.triggerName}\nƯu đãi: ${reward}`;
                              try {
                                if (navigator?.clipboard?.writeText) {
                                  await navigator.clipboard.writeText(text);
                                  showNotification("Đã sao chép thông tin CTKM", "success");
                                } else {
                                  showNotification("Trình duyệt không hỗ trợ sao chép", "warning");
                                }
                              } catch {
                                showNotification("Không thể sao chép", "error");
                              }
                            }}
                          >
                            Sao chép
                          </button>
                        </div>
                        <div className="consult-promo-grid">
                          <div><span>Loại CTKM</span><strong>{promo.typeLabel}</strong></div>
                          <div><span>Điều kiện</span><strong>Mua {promo.triggerQty} x {promo.triggerName}</strong></div>
                          <div><span>Ưu đãi</span><strong>{promo.rewardQty > 0 ? `Tặng ${promo.rewardQty} x ${promo.rewardName}` : "Theo cấu hình CTKM"}</strong></div>
                          <div><span>Thời gian</span><strong>{promo.startDateLabel} - {promo.endDateLabel}</strong></div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="consult-empty">Sản phẩm này hiện chưa có chương trình khuyến mãi liên quan.</p>
                )}
              </section>
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={copyConsultScript}>Sao chép lời tư vấn nhanh</button>
              <button type="button" className="btn-primary" onClick={closeConsultPanel}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {showStockHistoryDialog ? (
        <div className="dialog-overlay" onClick={closeStockHistoryDialog}>
          <div className="dialog-panel dialog-panel--stock-history" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Lịch sử xuất nhập  {stockHistoryProduct?.sku || "-"}  {stockHistoryProduct?.name || "Sản phẩm"}</h2>
                <p className="product-create-subtitle">Theo dõi luồng nhập từ mua hàng, xuất theo đơn bán, và nhập trả hàng để truy vết tồn kho.</p>
              </div>
              <button className="close-btn" type="button" onClick={closeStockHistoryDialog} aria-label="Đóng">x</button>
            </div>
            <div className="dialog-body" style={{ display: "grid", gap: 12 }}>
              {isServiceProduct(stockHistoryProduct) ? (
                <div className="info-box">Sản phẩm dịch vụ không theo dõi xuất nhập tồn kho.</div>
              ) : (
                <>
                  <div className="stock-history-summary-row" style={{ margin: 0 }}>
                    <div className="products-summary-card" style={{ borderTopColor: "#2b8a3e" }}>
                      <div className="products-summary-label">Tổng nhập</div>
                      <div className="products-summary-value" style={{ color: "#2b8a3e" }}>{formatNumber(filteredStockHistorySummary.totalIn || 0)}</div>
                    </div>
                    <div className="products-summary-card" style={{ borderTopColor: "#c92a2a" }}>
                      <div className="products-summary-label">Tổng xuất</div>
                      <div className="products-summary-value" style={{ color: "#c92a2a" }}>{formatNumber(filteredStockHistorySummary.totalOut || 0)}</div>
                    </div>
                    <div className="products-summary-card" style={{ borderTopColor: "#1971c2" }}>
                      <div className="products-summary-label">Chênh lệch</div>
                      <div className="products-summary-value" style={{ color: "#1971c2" }}>{formatNumber(filteredStockHistorySummary.netChange || 0)}</div>
                    </div>
                  </div>

                  <div className="detail-card" style={{ display: "grid", gap: 10, margin: 0 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1.4fr) 150px 140px 140px auto", gap: 8, alignItems: "center" }}>
                      <input
                        type="text"
                        placeholder="Tìm khách hàng/NCC..."
                        value={stockHistoryFilters.customerKeyword}
                        onChange={(e) => setStockHistoryFilters((prev) => ({ ...prev, customerKeyword: e.target.value }))}
                      />
                      <select
                        value={stockHistoryFilters.movementType}
                        onChange={(e) => setStockHistoryFilters((prev) => ({ ...prev, movementType: e.target.value }))}
                      >
                        <option value="ALL">Tất cả loại</option>
                        <option value="IN">Nhập</option>
                        <option value="OUT">Xuất</option>
                      </select>
                      <input
                        type="date"
                        value={stockHistoryFilters.dateFrom}
                        onChange={(e) => setStockHistoryFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
                      />
                      <input
                        type="date"
                        value={stockHistoryFilters.dateTo}
                        onChange={(e) => setStockHistoryFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="btn-cancel"
                        onClick={() => {
                          const today = getTodayInputValue();
                          setStockHistoryFilters({ customerKeyword: "", movementType: "ALL", dateFrom: today, dateTo: today });
                        }}
                      >
                        Hôm nay
                      </button>
                    </div>
                  </div>

                  {stockHistoryLoading ? (
                    <p>Đang tải lịch sử xuất nhập...</p>
                  ) : filteredStockHistoryRows.length ? (
                    <div className="table-container" style={{ margin: 0 }}>
                      <table className="data-table" style={{ margin: 0 }}>
                        <thead>
                          <tr>
                            <th>Thời điểm</th>
                            <th>Loại</th>
                            <th>Mã nguồn</th>
                            <th>Cửa hàng</th>
                            <th>Đối tác</th>
                            <th className="text-right">SL</th>
                            <th>Ghi chú</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredStockHistoryRows.map((row, idx) => (
                            <tr key={`${row.sourceType}-${row.sourceNo}-${idx}`}>
                              <td>{formatDateTimeVN(row.happenedAt)}</td>
                              <td>
                                <span className={`inventory-movement-badge ${row.movementType === "IN" ? "inventory-movement-badge--in" : "inventory-movement-badge--out"}`}>
                                  {row.movementType === "IN" ? "Nhập" : "Xuất"}
                                </span>
                              </td>
                              <td className="font-mono">{row.sourceNo || "-"}</td>
                              <td>{row.storeName || "-"}</td>
                              <td>{row.actorName || "-"}</td>
                              <td className="text-right" style={{ color: row.movementType === "IN" ? "#2b8a3e" : "#c92a2a", fontWeight: 600 }}>
                                {row.movementType === "IN" ? "+" : "-"}{formatNumber(row.quantity || 0)}
                              </td>
                              <td>{row.note || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p>Không có dữ liệu phù hợp bộ lọc hiện tại.</p>
                  )}
                </>
              )}
            </div>
            <div className="dialog-footer">
              <button type="button" className="btn-primary" onClick={closeStockHistoryDialog}>Đóng</button>
            </div>
          </div>
        </div>
      ) : null}

      {showGiftDialog ? (
        <div className="dialog-overlay dialog-overlay--stack" onClick={() => setShowGiftDialog(false)}>
          <div className="dialog-panel dialog-panel--gift" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <div>
                <h2>Tặng quà</h2>
                <p className="product-create-subtitle">
                  {selectedCustomer?.name || "Khách hàng"} &mdash; Điểm thưởng hiện tại:
                  <span className={`gift-points-badge ${giftPointsNegative ? "gift-points-badge--negative" : ""}`}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="gift-points-badge__icon">
                      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
                      <path d="M8 12h8M12 8v8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    <strong>{giftPointsValue ?? "?"}</strong>
                  </span>
                  {activeStoreId && <span style={{ fontSize: 11, color: "#868e96", marginLeft: 8 }}>({"Cửa hàng: " + activeStoreId.slice(-6)})</span>}
                </p>
              </div>
              <button className="close-btn" type="button" onClick={() => setShowGiftDialog(false)} aria-label="Đóng">x</button>
            </div>

            <div className="dialog-body">
              {/* Chọn sản phẩm */}
              <section className="detail-card" style={{ marginBottom: 12 }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>Chọn sản phẩm tặng</h3>
                <div style={{ marginBottom: 8 }}>
                  <input
                    className="text-input"
                    placeholder="Tìm sản phẩm theo tên hoặc SKU..."
                    value={giftProductSearch}
                    onChange={(e) => {
                      setGiftProductSearch(e.target.value);
                      setGiftSelectedProduct(null);
                    }}
                  />
                </div>
                {giftProductSearch.trim().length > 0 && (
                  <div className="gift-product-list">
                    {giftSearchResults
                      .map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className={`gift-product-row ${giftSelectedProduct?.id === p.id ? "gift-product-row--selected" : ""} ${p.isOutOfStock ? "gift-product-row--disabled" : ""}`}
                          onClick={() => {
                            if (p.isOutOfStock) return;
                            setGiftSelectedProduct(p);
                            setGiftProductSearch("");
                          }}
                          disabled={p.isOutOfStock}
                        >
                          <span className="gift-product-name">{p.name}</span>
                          <span className="gift-product-sku mono">{p.sku}</span>
                          <span className={`gift-product-stock ${isServiceProduct(p) ? "gift-product-stock--service" : (Number(p.availableQuantity || 0) <= 0 ? "gift-product-stock--empty" : "")}`}>
                            {isServiceProduct(p) ? "Dịch vụ" : `Tồn: ${formatNumber(Number(p.availableQuantity || 0))}`}
                          </span>
                          <span className="gift-product-pts">{p.giftPointsCost > 0 ? `${p.giftPointsCost} điểm` : "0 điểm"}</span>
                        </button>
                      ))}
                    {giftSearchResults.length === 0 && (
                      <div style={{ padding: "8px 0", color: "#888" }}>Không tìm thấy sản phẩm</div>
                    )}
                  </div>
                )}
                {giftSelectedProduct && (
                  <div className="gift-selected-product">
                    <span>{giftSelectedProduct.name}</span>
                    <span className="mono" style={{ color: "#555" }}>{giftSelectedProduct.sku}</span>
                    <span style={{ color: Number((inventoryMap.get(giftSelectedProduct.id)?.available) || 0) > 0 ? "#2b8a3e" : "#c92a2a", fontWeight: 600 }}>
                      {isServiceProduct(giftSelectedProduct)
                        ? "Dịch vụ"
                        : `Tồn hiện tại: ${formatNumber(Number((inventoryMap.get(giftSelectedProduct.id)?.available) || 0))}`}
                    </span>
                    <span style={{ color: "#c92a2a", fontWeight: 600 }}>{giftSelectedProduct.giftPointsCost > 0 ? `Trừ ${giftSelectedProduct.giftPointsCost} điểm` : "0 điểm"}</span>
                    <button type="button" className="btn-cancel" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setGiftSelectedProduct(null)}>Xóa</button>
                  </div>
                )}
              </section>

              {/* Số lượng và ghi chú */}
              <section className="detail-card" style={{ marginBottom: 12 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Số lượng</label>
                    <input
                      type="number"
                      className="text-input"
                      min={1}
                      value={giftQuantity}
                      onChange={(e) => setGiftQuantity(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Điểm bị trừ</label>
                    <input
                      type="text"
                      className="text-input"
                      readOnly
                      value={giftSelectedProduct ? giftSelectedProduct.giftPointsCost * giftQuantity : 0}
                      style={{ background: "#f8f9fa", color: "#c92a2a", fontWeight: 600 }}
                    />
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: 8 }}>
                  <label>Ghi chú</label>
                  <input
                    className="text-input"
                    placeholder="Ghi chú (tùy chọn)"
                    value={giftNote}
                    onChange={(e) => setGiftNote(e.target.value)}
                  />
                </div>
                {giftMessage.text && (
                  <div className={`form-message form-message--${giftMessage.type}`} style={{ marginTop: 8 }}>
                    {giftMessage.text}
                  </div>
                )}
              </section>

              {/* Lịch sử tặng quà */}
              <section className="detail-card">
                <h3 style={{ margin: "0 0 10px", fontSize: 14 }}>Lịch sử tặng quà</h3>
                {giftDialogLoading ? (
                  <p>Đang tải...</p>
                ) : giftHistory.length === 0 ? (
                  <p style={{ color: "#888", fontSize: 13 }}>Chưa có lịch sử tặng quà.</p>
                ) : (
                  <div className="gift-history-table-wrap">
                    <table className="simple-table">
                      <thead>
                        <tr>
                          <th>Sản phẩm</th>
                          <th className="text-right">SL</th>
                          <th className="text-right">Điểm bị trừ</th>
                          <th>Ghi chú</th>
                          <th>Thời gian</th>
                          <th>Trạng thái</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {giftHistory.map((r) => (
                          <tr key={r.id} style={r.status === "CANCELLED" ? { opacity: 0.5, textDecoration: "line-through" } : undefined}>
                            <td>{r.productName}</td>
                            <td className="text-right mono">{r.quantity}</td>
                            <td className="text-right mono" style={{ color: r.status === "CANCELLED" ? "#aaa" : "#c92a2a" }}>{r.pointsCost}</td>
                            <td>{r.note || "-"}</td>
                            <td className="mono" style={{ fontSize: 12 }}>{r.createdAt ? formatDateTimeVN(new Date(r.createdAt)) : "-"}</td>
                            <td style={{ fontSize: 12, color: r.status === "CANCELLED" ? "#888" : "#2f9e44", fontWeight: 600 }}>
                              {r.status === "CANCELLED" ? "Đã hủy" : "Hiệu lực"}
                            </td>
                            <td>
                              {r.status !== "CANCELLED" && onCancelGiftRedemption && (
                                <button
                                  type="button"
                                  style={{ fontSize: 11, padding: "2px 8px", background: "#fff3f3", border: "1px solid #ffa8a8", color: "#c92a2a", borderRadius: 4, cursor: "pointer" }}
                                  disabled={giftCancelling === r.id}
                                  onClick={() => void cancelGiftItem(r.id)}
                                >
                                  {giftCancelling === r.id ? "..." : "Hủy"}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <div className="dialog-footer">
              <button type="button" className="btn-cancel" onClick={() => setShowGiftDialog(false)}>
                Đóng
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!giftSelectedProduct || giftSubmitting || !onCreateGiftRedemption}
                onClick={() => void submitGiftRedemption()}
              >
                {giftSubmitting ? "Đang lưu..." : "Xác nhận tặng"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </section>
  );
}

