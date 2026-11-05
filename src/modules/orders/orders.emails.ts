import { env } from '../../config/env.js'
import { escapeHtml, sendEmail } from '../../services/email.js'
import type { OrderDoc } from './orders.model.js'

const money = (pence: number) => `£${(pence / 100).toFixed(2)}`

const itemList = ({ items }: OrderDoc) =>
  `<ul>${items
    .map(({ quantity, name, summary, options = [], note }) => {
      const extras = options.length
        ? options
            .map(({ label, price }) => `${escapeHtml(label)}${price ? ` (+${money(price)})` : ''}`)
            .join(', ')
        : summary && escapeHtml(summary)
      return `<li>${quantity} × ${escapeHtml(name)}${extras ? `<br><small>${extras}</small>` : ''}${
        note ? `<br><small>Note: ${escapeHtml(note)}</small>` : ''
      }</li>`
    })
    .join('')}</ul>`

const trackingUrl = (order: OrderDoc) =>
  `${env.SITE_URL}/track/${order._id}?key=${order.trackingKey}`

const toCustomer = (order: OrderDoc, subject: string, body: string) => {
  if (order.customerEmail) sendEmail({ to: order.customerEmail, subject, html: body })
}

export const emailOrderConfirmation = (order: OrderDoc) => {
  toCustomer(
    order,
    `Order ${order.number} confirmed`,
    `<p>Thanks ${escapeHtml(order.customerName)}, Ugo is on it.</p>${itemList(order)}${
      order.discount ? `<p>Offer saving: −${money(order.discount)}</p>` : ''
    }<p>Total: ${money(order.total)}. Paid by card.</p><p><a href="${trackingUrl(order)}">Track your order</a></p><p>If you have an allergy, call us before your food is prepared.</p>`,
  )
  if (env.KITCHEN_EMAIL) {
    sendEmail({
      to: env.KITCHEN_EMAIL,
      subject: `New order ${order.number}`,
      html: `${itemList(order)}${order.allergyNote ? `<p><strong>Allergy: ${escapeHtml(order.allergyNote)}</strong></p>` : ''}`,
    })
  }
}

export const emailOutForDelivery = (order: OrderDoc) =>
  toCustomer(
    order,
    `Order ${order.number} is on its way`,
    `<p>Your food has left the kitchen.</p>${order.paymentStatus === 'due' ? `<p>Please have ${money(order.total)} ready.</p>` : ''}`,
  )

export const emailDelivered = (order: OrderDoc) =>
  toCustomer(
    order,
    `Order ${order.number} delivered`,
    `<p>Enjoy your meal, and thank you for ordering.</p><p>How was it? <a href="${trackingUrl(order)}#review">Rate your order</a>. It takes ten seconds and helps Ugo a lot.</p>`,
  )

export const emailCancelled = (order: OrderDoc, refunded: number) =>
  toCustomer(
    order,
    `Order ${order.number} cancelled`,
    `<p>Your order has been cancelled.</p>${refunded > 0 ? `<p>${money(refunded)} will go back to your card within a few working days.</p>` : ''}`,
  )

export const emailRefund = (order: OrderDoc, amount: number) =>
  toCustomer(
    order,
    `Refund for order ${order.number}`,
    `<p>We have refunded ${money(amount)}. It will reach your card within a few working days.</p>`,
  )

export const emailScheduledReminder = (order: OrderDoc) =>
  toCustomer(
    order,
    `Order ${order.number} is coming up`,
    `<p>Your order will be with you soon.</p>${itemList(order)}`,
  )
