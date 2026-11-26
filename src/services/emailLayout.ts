import { env } from '../config/env.js'
import { escapeHtml } from './email.js'

/**
 * Building blocks for branded emails. Email apps ignore most modern CSS, so everything is
 * tables with inline styles, and the logo is a PNG because Gmail does not show SVG.
 */

const COLOURS = {
  jollof: '#C8401C',
  cocoa: '#1C0F0A',
  muted: '#6B5A50',
  shea: '#F6EDE0',
  // White, so the logo's white background blends into the card.
  paper: '#FFFFFF',
  line: '#E8DCCB',
  ewedu: '#1E5B3A',
}

const FONT = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif"

export const money = (pence: number) => `£${(pence / 100).toFixed(2)}`

export const paragraph = (html: string) =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:${COLOURS.cocoa}">${html}</p>`

export const button = (label: string, href: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px"><tr><td style="background:${COLOURS.jollof};border-radius:999px"><a href="${href}" style="display:inline-block;padding:13px 26px;${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none">${escapeHtml(label)}</a></td></tr></table>`

/** A boxed panel, used for the delivery address and order details. `alert` is for allergies. */
export const panel = (html: string, tone: 'normal' | 'alert' = 'normal') =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:${
    tone === 'alert' ? COLOURS.jollof : COLOURS.shea
  };border-radius:14px"><tr><td style="padding:16px 18px;${FONT};font-size:14px;line-height:21px;color:${
    tone === 'alert' ? '#ffffff' : COLOURS.cocoa
  }">${html}</td></tr></table>`

export const label = (text: string) =>
  `<div style="font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${COLOURS.jollof};margin-bottom:4px">${escapeHtml(text)}</div>`

/** Rows of name on the left and amount on the right, with an optional bold last row. */
export const priceRows = (
  rows: { name: string; detail?: string; amount: string; strong?: boolean }[],
) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;${FONT};font-size:14px;color:${COLOURS.cocoa}">${rows
    .map(
      ({ name, detail, amount, strong }) =>
        `<tr><td style="padding:7px 0;border-bottom:1px solid ${COLOURS.line};${strong ? 'font-size:17px;font-weight:800' : ''}">${name}${
          detail
            ? `<div style="font-size:12px;color:${COLOURS.muted};margin-top:2px">${detail}</div>`
            : ''
        }</td><td align="right" valign="top" style="padding:7px 0 7px 12px;border-bottom:1px solid ${COLOURS.line};white-space:nowrap;${strong ? 'font-size:17px;font-weight:800' : ''}">${amount}</td></tr>`,
    )
    .join('')}</table>`

interface LayoutOptions {
  /** The big line at the top, like "Ugo has your order!". */
  heading: string
  /** Hidden text some email apps show next to the subject. */
  preview: string
  body: string
}

export const layout = ({ heading, preview, body }: LayoutOptions) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${COLOURS.shea}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOURS.shea}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLOURS.paper};border-radius:20px;overflow:hidden">
<tr><td align="center" style="padding:22px 24px 6px"><a href="${env.SITE_URL}"><img src="${env.SITE_URL}/images/site/logo-email.png" width="96" height="96" alt="Cooked by Ugo" style="display:block;border:0"></a></td></tr>
<tr><td style="background:${COLOURS.jollof};padding:20px 28px"><h1 style="margin:0;${FONT};font-size:24px;line-height:30px;font-weight:800;color:#ffffff">${escapeHtml(heading)}</h1></td></tr>
<tr><td style="padding:24px 28px 10px;${FONT}">${body}</td></tr>
<tr><td style="padding:16px 28px 26px;${FONT};font-size:12px;line-height:18px;color:${COLOURS.muted};border-top:1px solid ${COLOURS.line}">Cooked by Ugo · Lagos flavour, Newcastle doorstep<br>Questions about your order? <a href="${env.SITE_URL}/contact" style="color:${COLOURS.jollof}">Get in touch</a>.</td></tr>
</table></td></tr></table></body></html>`
