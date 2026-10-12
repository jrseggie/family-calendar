// Shared, Outlook-safe email layout (tables + inline styles only - Outlook ignores flex, rounded divs, min-width).
// Mirrors tools/email_layout.py (the inbox "Calendar updated" email) - keep the two looking the same.
export const NAVY = "#1f3864", INK = "#212529", MUTED = "#868e96", LINE = "#e3e7ee";
export const FONT = "font-family:'Segoe UI',-apple-system,Roboto,Helvetica,Arial,sans-serif";
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// label = the small line above the title (the calendar's name, lib/settings.js brand().full)
export function page(title, subtitle, body, footer, site, label = "Family Calendar") {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f3f7" style="background:#f1f3f7">
<tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid ${LINE}">
<tr><td bgcolor="${NAVY}" style="background:${NAVY};padding:18px 24px;${FONT}">
  <div style="color:#aab8d6;font-size:12px;letter-spacing:1px;text-transform:uppercase">${esc(label)}</div>
  <div style="color:#ffffff;font-size:22px;font-weight:bold;padding-top:4px">${esc(title)}</div>
  <div style="color:#d0d9ec;font-size:14px;padding-top:2px">${esc(subtitle)}</div>
</td></tr>
<tr><td style="padding:18px 24px 6px;${FONT};font-size:15px;color:${INK}">${body}</td></tr>
<tr><td style="padding:6px 24px 22px;${FONT}">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="${NAVY}" style="background:${NAVY};padding:10px 20px"><a href="${site}" style="color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;${FONT}">Open the calendar</a></td>
  </tr></table>
</td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid ${LINE};${FONT};font-size:12px;color:${MUTED}">${esc(footer)}</td></tr>
</table></td></tr></table>`;
}

export function warnBox(title, lines) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px">
<tr><td bgcolor="#fff5f5" style="background:#fff5f5;border-left:4px solid #e03131;padding:10px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr><td style="padding-bottom:4px;${FONT};font-size:14px;font-weight:bold;color:#c92a2a">⚠ ${esc(title)}</td></tr>
  ${lines.map((l) => `<tr><td style="padding:3px 0;${FONT};font-size:14px;color:${INK}">${l}</td></tr>`).join("")}</table>
</td></tr></table>`;
}

export const tag = (name, color) =>
  // Outlook on the PC ignores padding on a span, so the side padding is non-breaking spaces
  `<span style="background:${color};color:#ffffff;font-size:12px;font-weight:bold;padding:2px 0;line-height:20px;white-space:nowrap;${FONT}">&nbsp;&nbsp;${esc(name)}&nbsp;&nbsp;</span>`;

// one day of the week: a shaded date band, then its rows (who tag | text)
export function dayBlock(label, weekend, rows) {
  const band = weekend ? "#f6ecd6" : "#e6ebf2";
  const body = rows.length ? rows.map((r) => `<tr${r.important ? ' bgcolor="#fff3bf" style="background:#fff3bf"' : ""}>
    <td width="130" valign="top" style="width:130px;padding:6px 8px 6px 10px;line-height:22px">${r.who || ""}</td>
    <td valign="top" style="padding:6px 10px 6px 0;${FONT};font-size:14px;color:${INK}">${r.text}</td></tr>`).join("")
    : `<tr><td colspan="2" style="padding:6px 10px;${FONT};font-size:14px;color:#adb5bd">Nothing planned</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;border:1px solid ${LINE}">
<tr><td colspan="2" bgcolor="${band}" style="background:${band};padding:6px 10px;${FONT};font-size:14px;font-weight:bold;color:${INK}">${esc(label)}</td></tr>
${body}</table>`;
}

export function section(title, rowsHtml, count = null) {
  const head = esc(title) + (count !== null ? ` <span style="color:${MUTED};font-weight:normal">(${count})</span>` : "");
  return `<div style="${FONT};font-size:13px;font-weight:bold;color:${NAVY};text-transform:uppercase;letter-spacing:.5px;padding:4px 0 6px;border-bottom:2px solid ${NAVY}">${head}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px">${rowsHtml}</table>`;
}

export function row(dateLabel, whoHtml, textHtml, important = false, firstOfDay = true) {
  const bg = important ? ' bgcolor="#fff3bf" style="background:#fff3bf"' : "";
  const top = firstOfDay ? `border-top:1px solid ${LINE};` : "";
  return `<tr${bg}>
  <td width="110" valign="top" style="width:110px;padding:7px 8px 7px 0;${top}${FONT};font-size:13px;font-weight:bold;color:#495057">${dateLabel}</td>
  <td width="1" valign="top" style="padding:7px 8px 7px 0;${top}white-space:nowrap">${whoHtml}</td>
  <td valign="top" style="padding:7px 0;${top}${FONT};font-size:14px;color:${INK}">${textHtml}</td>
</tr>`;
}
