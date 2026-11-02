import { env } from '../config/env.js'

interface Email {
  to: string
  subject: string
  html: string
}

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email'

/** Without a Brevo key, emails are logged, so local work never sends real mail. */
const send = async ({ to, subject, html }: Email) => {
  if (!env.BREVO_API_KEY) {
    if (env.NODE_ENV === 'development') console.log(`[email] to ${to}: ${subject}`)
    return
  }

  const response = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Cooked by Ugo', email: env.EMAIL_FROM },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  })
  if (!response.ok) throw new Error(`Brevo responded ${response.status}`)
}

/** A failed email must never fail the order or action that triggered it. */
export const sendEmail = (email: Email) => {
  send(email).catch((error) => console.error('Email failed', error))
}

export const escapeHtml = (value = '') =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  )
