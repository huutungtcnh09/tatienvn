function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toCell(value, type) {
  if (value === null || value === undefined || value === "") {
    return '<Cell><Data ss:Type="String"></Data></Cell>';
  }

  if (type === "number") {
    const num = Number(value);
    if (!Number.isNaN(num)) {
      return `<Cell><Data ss:Type="Number">${num}</Data></Cell>`;
    }
  }

  return `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

export function downloadExcelXml({ fileName, sheetName, columns, rows }) {
  const headerRow = `<Row>${columns.map((col) => `<Cell><Data ss:Type="String">${escapeXml(col.header)}</Data></Cell>`).join("")}</Row>`;
  const dataRows = rows
    .map((row) => `<Row>${columns.map((col) => toCell(row[col.key], col.type)).join("")}</Row>`)
    .join("");

  const xml = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n  <Worksheet ss:Name="${escapeXml(sheetName || "Sheet1")}">\n    <Table>\n      ${headerRow}\n      ${dataRows}\n    </Table>\n  </Worksheet>\n</Workbook>`;

  const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${fileName || "report"}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
