import { useState } from "react";
import { formatCurrency } from "../utils/currency";
import { formatDateTimeVN } from "../utils/datetime";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(value) {
  const num = Number(value || 0);
  return num.toLocaleString("vi-VN");
}

function readThreeDigitsVietnamese(value, hasHigherGroup = false) {
  const num = Math.max(0, Math.min(value, 999));
  if (num === 0) return "";

  const hundreds = Math.floor(num / 100);
  const remainder = num % 100;

  const words = [];
  if (hundreds > 0) {
    words.push(["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"][hundreds]);
    words.push("trăm");
  }

  if (remainder > 0) {
    if (remainder < 10) {
      if (remainder > 0 && hundreds > 0) {
        words.push("lẻ");
      }
      words.push(["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"][remainder]);
    } else if (remainder === 10) {
      if (hundreds === 0 && !hasHigherGroup) {
        words.push("mười");
      } else {
        words.push("mười");
      }
    } else {
      const tens = Math.floor(remainder / 10);
      const ones = remainder % 10;
      if (hundreds === 0 && !hasHigherGroup) {
        words.push(["", "mười", "hai mươi", "ba mươi", "bốn mươi", "năm mươi", "sáu mươi", "bảy mươi", "tám mươi", "chín mươi"][tens]);
      } else {
        words.push(["", "mười", "hai mươi", "ba mươi", "bốn mươi", "năm mươi", "sáu mươi", "bảy mươi", "tám mươi", "chín mươi"][tens]);
      }
      if (ones > 0) {
        words.push(["", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"][ones]);
      }
    }
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
  // In phiếu: luôn lấy tổng chưa trừ chiết khấu dòng
  return Math.max(qty * unitPrice, 0);
}

function resolvePrintFinalUnitPrice(item) {
  // In phiếu: luôn lấy giá gốc
  return Number(item?.unitPrice || 0);
}

function resolvePrintUnitLabel(item) {
  return String(item?.unit || item?.product?.unit || "-").trim() || "-";
}

function resolvePrintQuantityLabel(item) {
  const qty = Number(item?.quantity || 0);
  const saleUnit = String(item?.unit || item?.product?.unit || "cái").trim();
  const qtyText = Number.isFinite(qty) ? (Number.isInteger(qty) ? String(qty) : String(qty)) : "0";
  return `${qtyText} (${saleUnit})`;
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
    @page { size: 80mm auto; margin: 2mm 2mm 5mm; }
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
        <th style="width: 38px">STT</th>
        <th>Mã hàng</th>
        <th>Tên hàng hóa, dịch vụ</th>
        <th style="width: 60px">Số lượng</th>
        <th style="width: 60px">ĐVT</th>
        <th style="width: 92px">Đơn giá</th>
        <th style="width: 92px">Thành tiền</th>
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
    @page { size: A5; margin: 10mm; }
    body { font-family: "Times New Roman", serif; color: #111; font-size: 14px; }
    .company { text-align: center; font-size: 24px; font-weight: 700; margin: 0 0 4px; }
    .title { text-align: center; font-size: 24px; font-weight: 700; margin: 0 0 8px; }
    .subtitle { text-align: center; margin: 0 0 16px; }
    .meta { margin-bottom: 12px; }
    .meta-row { display: flex; margin-bottom: 6px; }
    .label { width: 140px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #111; padding: 6px; }
    th { text-align: center; }
    .center { text-align: center; }
    .right { text-align: right; white-space: nowrap; }
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
  const subtotal = Array.isArray(order?.items)
    ? order.items.reduce((sum, item) => sum + Number(item?.unitPrice || 0) * Number(item?.quantity || 0), 0)
    : 0;
  const discount = Number(order?.discountAmount || 0);
  const total = Number(order?.totalAmount || 0);
  const totalAmountInWords = toVietnameseMoneyWords(total);
  const note = order?.note || "";

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
  <div class="amount-words">Số tiền bằng chữ: <b>${escapeHtml(toVietnameseMoneyWords(total))}</b></div>
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
      <p style="height: 60px;"></p>
    </div>
    <div class="sign-box">
      <p class="sign-role"><strong>Thủ kho</strong></p>
      <p class="sign-note">(Ký, ghi rõ họ tên)</p>
      <p style="height: 60px;"></p>
    </div>
    <div class="sign-box">
      <p class="sign-role"><strong>Khách hàng</strong></p>
      <p class="sign-note">(Ký, ghi rõ họ tên)</p>
      <p style="height: 60px;"></p>
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

export default function PrintOrder({ order, onClose }) {
  const [selectedTemplate, setSelectedTemplate] = useState("pos");

  const handlePrint = () => {
    try {
      printOrderByTemplate(order, selectedTemplate);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể mở cửa sổ in";
      alert(message);
    }
  };

  return (
    <div className="dialog-overlay pos-print-template-overlay" onClick={onClose}>
      <div className="dialog-panel pos-print-template-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Chọn mẫu in</h2>
          <button className="close-btn close-btn--emphasis" type="button" onClick={onClose} aria-label="Đóng">x</button>
        </div>

        <div className="dialog-body">
          <p className="pos-print-template-note">Đơn hàng #{order.orderNo || order.id.slice(0, 8)} - Chọn mẫu in:</p>
          <div className="pos-print-template-list">
            <label className={`pos-print-template-item ${selectedTemplate === "pos" ? "active" : ""}`}>
              <input
                type="radio"
                name="print-template"
                value="pos"
                checked={selectedTemplate === "pos"}
                onChange={(e) => setSelectedTemplate(e.target.value)}
              />
              <div>
                <strong>Mẫu POS (mặc định)</strong>
                <p>Khổ 80mm, phù hợp máy in hóa đơn tại quầy.</p>
              </div>
            </label>

            <label className={`pos-print-template-item ${selectedTemplate === "a5_delivery" ? "active" : ""}`}>
              <input
                type="radio"
                name="print-template"
                value="a5_delivery"
                checked={selectedTemplate === "a5_delivery"}
                onChange={(e) => setSelectedTemplate(e.target.value)}
              />
              <div>
                <strong>Mẫu A5: Phiếu giao hàng</strong>
                <p>Thông tin giao nhận và danh sách hàng hóa để ký nhận.</p>
              </div>
            </label>

            <label className={`pos-print-template-item ${selectedTemplate === "a4_notice" ? "active" : ""}`}>
              <input
                type="radio"
                name="print-template"
                value="a4_notice"
                checked={selectedTemplate === "a4_notice"}
                onChange={(e) => setSelectedTemplate(e.target.value)}
              />
              <div>
                <strong>Mẫu A4: Phiếu báo tiền</strong>
                <p>Tổng hợp chi phí, đã thu và công nợ còn lại.</p>
              </div>
            </label>

            <label className={`pos-print-template-item ${selectedTemplate === "a4_invoice" ? "active" : ""}`}>
              <input
                type="radio"
                name="print-template"
                value="a4_invoice"
                checked={selectedTemplate === "a4_invoice"}
                onChange={(e) => setSelectedTemplate(e.target.value)}
              />
              <div>
                <strong>Mẫu A4: Hóa đơn bán hàng</strong>
                <p>Hóa đơn chính thức với các chữ ký từ bên bán, thủ kho và khách hàng.</p>
              </div>
            </label>
          </div>
        </div>

        <div className="dialog-footer">
          <button type="button" className="btn-cancel" onClick={onClose}>
            Đóng
          </button>
          <button type="button" className="btn-primary" onClick={handlePrint}>
            In theo mẫu đã chọn
          </button>
        </div>
      </div>
    </div>
  );
}



