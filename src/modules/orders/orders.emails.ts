import { env } from '../../config/env.js'
import { escapeHtml, sendEmail } from '../../services/email.js'
import {
  button,
  label,
  layout,
  money,
  panel,
  paragraph,
  priceRows,
} from '../../services/emailLayout.js'
import type { OrderDoc } from './orders.model.js'

/** Refunds reach the card in this many working days, said the same way everywhere. */
export const REFUND_TIMING = '3 to 5 working days'

const firstName = (name: string) => escapeHtml(name.trim().split(/\s+/)[0] ?? name)

const trackingUrl = (order: OrderDoc) =>
  `${env.SITE_URL}/track/${order._id}?key=${order.trackingKey}`

const itemRows = ({ items }: OrderDoc) =>
  items.map(({ quantity, name, unitPrice, summary, options = [], note }) => {
    const extras = options.length
      ? options
          .map(
            ({ label: choice, price }) =>
              `${escapeHtml(choice)}${price ? ` (+${money(price)})` : ''}`,
          )
          .join(', ')
      : summary
        ? escapeHtml(summary)
        : ''
    const detail = [extras, note ? `Note: ${escapeHtml(note)}` : ''].filter(Boolean).join('<br>')
    return {
      name: `${quantity} × ${escapeHtml(name)}`,
      detail: detail || undefined,
      amount: money(unitPrice * quantity),
    }
  })

/** The full receipt: every line, then subtotal, offer, delivery and total. */
const receipt = (order: OrderDoc) =>
  priceRows([
    ...itemRows(order),
    { name: 'Subtotal', amount: money(order.subtotal) },
    ...(order.discount ? [{ name: 'Offer saving', amount: `−${money(order.discount)}` }] : []),
    { name: 'Delivery', amount: order.deliveryFee ? money(order.deliveryFee) : 'Free' },
    { name: 'Total', amount: money(order.total), strong: true },
  ])

const paymentLine = (order: OrderDoc) =>
  order.paymentMethod === 'card'
    ? 'Paid by card.'
    : `Pay ${money(order.total)} when your food arrives.`

/** When the food arrives: the order time, or the scheduled start, plus preparation and delivery. */
export const arrivalTime = (order: Pick<OrderDoc, 'createdAt' | 'scheduledFor' | 'etaMinutes'>) =>
  new Date((order.scheduledFor ?? order.createdAt).getTime() + order.etaMinutes * 60_000)

const clock = (time: Date) =>
  time.toLocaleString('en-GB', {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  })

const whenLine = (order: OrderDoc) => `Arriving about ${clock(arrivalTime(order))}`

/** The kitchen also needs to know when to start a scheduled order. */
const kitchenWhen = (order: OrderDoc) =>
  order.scheduledFor
    ? `Start cooking ${clock(order.scheduledFor)}. ${whenLine(order)}`
    : whenLine(order)

/** Name, address and phone, like the top of a delivery note. */
const deliveryPanel = (order: OrderDoc) =>
  panel(
    `${label('Delivering to')}<strong>${escapeHtml(order.customerName)}</strong><br>${escapeHtml(
      order.address,
    )}<br>${escapeHtml(order.postcode)}<br>${escapeHtml(order.customerPhone)}${
      order.deliveryNote ? `<br><em>Note: ${escapeHtml(order.deliveryNote)}</em>` : ''
    }`,
  )

const toCustomer = (order: OrderDoc, subject: string, heading: string, body: string) => {
  if (!order.customerEmail) return
  sendEmail({
    to: order.customerEmail,
    subject,
    html: layout({ heading, preview: subject, body }),
  })
}

export const emailOrderConfirmation = (order: OrderDoc) => {
  toCustomer(
    order,
    `Order ${order.number} confirmed`,
    'Ugo has your order!',
    `${paragraph(`Great choice, ${firstName(order.customerName)}. Order <strong>${order.number}</strong> is in, and arriving about ${escapeHtml(clock(arrivalTime(order)))}.`)}
    ${deliveryPanel(order)}
    ${button('Track your order', trackingUrl(order))}
    ${receipt(order)}
    ${paragraph(paymentLine(order))}
    ${paragraph('If you have an allergy, please call us before your food is prepared.')}`,
  )

  if (env.KITCHEN_EMAIL) {
    sendEmail({
      to: env.KITCHEN_EMAIL,
      subject: `New order ${order.number} · ${money(order.total)}`,
      html: layout({
        heading: `New order ${order.number}`,
        preview: `${order.customerName}, ${money(order.total)}`,
        body: `${
          order.allergyNote
            ? panel(
                `<strong style="font-size:16px">⚠ Allergy: ${escapeHtml(order.allergyNote)}</strong>`,
                'alert',
              )
            : ''
        }
        ${paragraph(`<strong>${escapeHtml(kitchenWhen(order))}</strong>. ${paymentLine(order)}`)}
        ${panel(
          `${label('Customer')}<strong>${escapeHtml(order.customerName)}</strong><br>${escapeHtml(
            order.customerPhone,
          )}<br>${escapeHtml(order.customerEmail)}<br><br>${label('Address')}${escapeHtml(
            order.address,
          )}<br>${escapeHtml(order.postcode)}${
            order.distanceMiles != null ? ` (${order.distanceMiles.toFixed(1)} miles)` : ''
          }${order.deliveryNote ? `<br><em>Note: ${escapeHtml(order.deliveryNote)}</em>` : ''}`,
        )}
        ${receipt(order)}
        ${button('Open in the admin', `${env.ADMIN_URL}/orders/${order._id}`)}`,
      }),
    })
  }
}

export const emailOutForDelivery = (order: OrderDoc) =>
  toCustomer(
    order,
    `Order ${order.number} is on its way`,
    'Your food is on its way',
    `${paragraph(`Good news, ${firstName(order.customerName)}: order <strong>${order.number}</strong> has left the kitchen and is heading to you.`)}
    ${deliveryPanel(order)}
    ${order.paymentStatus === 'due' ? paragraph(`<strong>Please have ${money(order.total)} ready.</strong>`) : ''}
    ${button('Track your order', trackingUrl(order))}`,
  )

export const emailDelivered = (order: OrderDoc) =>
  toCustomer(
    order,
    `Order ${order.number} delivered`,
    'Enjoy your meal!',
    `${paragraph(`Order <strong>${order.number}</strong> has been delivered. Thank you for ordering, ${firstName(order.customerName)}.`)}
    ${paragraph('How was it? Your rating takes ten seconds and helps Ugo a lot.')}
    ${button('Rate your order', `${trackingUrl(order)}#review`)}
    ${receipt(order)}`,
  )

export const emailCancelled = (order: OrderDoc, refunded: number) =>
  toCustomer(
    order,
    `Order ${order.number} cancelled`,
    'Your order was cancelled',
    `${paragraph(`Sorry, ${firstName(order.customerName)}. Order <strong>${order.number}</strong> has been cancelled.`)}
    ${
      refunded > 0
        ? panel(
            `${label('Refund')}We have refunded <strong>${money(refunded)}</strong> to your card. It can take ${REFUND_TIMING} to show on your statement.`,
          )
        : ''
    }
    ${paragraph('If you have any questions, please get in touch and we will sort it out.')}`,
  )

export const emailRefund = (order: OrderDoc, amount: number) =>
  toCustomer(
    order,
    `Refund for order ${order.number}`,
    'We have sent you a refund',
    `${paragraph(`Hi ${firstName(order.customerName)}, we have refunded part of order <strong>${order.number}</strong>.`)}
    ${panel(`${label('Refund')}<strong>${money(amount)}</strong> back to your card. It can take ${REFUND_TIMING} to show on your statement.`)}
    ${button('View your order', trackingUrl(order))}`,
  )

export const emailScheduledReminder = (order: OrderDoc) =>
  toCustomer(
    order,
    `Order ${order.number} is coming up`,
    'Your order is coming up',
    `${paragraph(`Hi ${firstName(order.customerName)}, a quick reminder that order <strong>${order.number}</strong> is arriving about ${escapeHtml(clock(arrivalTime(order)))}.`)}
    ${deliveryPanel(order)}
    ${receipt(order)}
    ${button('Track your order', trackingUrl(order))}`,
  )

/** Sent when the kitchen cannot make something, so the customer can choose what happens next. */
export const emailChangesNeeded = (
  order: OrderDoc,
  unavailable: { quantity: number; name: string }[],
) => {
  const them = unavailable.length === 1 ? 'it' : 'them'
  toCustomer(
    order,
    `Order ${order.number} needs your attention`,
    'Something has run out',
    `${paragraph(`Hi ${firstName(order.customerName)}, sorry, we have run out of:`)}
    ${priceRows(unavailable.map(({ quantity, name }) => ({ name: `${quantity} × ${escapeHtml(name)}`, amount: '' })))}
    ${order.amendment?.message ? panel(escapeHtml(order.amendment.message)) : ''}
    ${paragraph(`You can remove ${them} and get that money back, swap ${them} for something else with no extra delivery fee, or cancel for a full refund. We will start cooking as soon as you choose.`)}
    ${button(`Update order ${order.number}`, `${trackingUrl(order)}#update`)}`,
  )
}

export const emailOrderUpdated = (order: OrderDoc, refunded: number) =>
  toCustomer(
    order,
    `Order ${order.number} updated`,
    'Your order is updated',
    `${paragraph(`Thanks, ${firstName(order.customerName)}. Order <strong>${order.number}</strong> is updated and Ugo is on it.`)}
    ${receipt(order)}
    ${
      refunded > 0
        ? panel(
            `${label('Refund')}We have refunded <strong>${money(refunded)}</strong> to your card. It can take ${REFUND_TIMING} to show on your statement.`,
          )
        : ''
    }
    ${button('Track your order', trackingUrl(order))}`,
  )

/** Everything a rider needs on the road: where, who, what to collect, and a map. */
export const emailRiderAssigned = (order: OrderDoc, rider: { name: string; email: string }) => {
  const destination = `${order.address}, ${order.postcode}`
  const mapUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
  sendEmail({
    to: rider.email,
    subject: `Delivery ${order.number} · ${order.postcode}`,
    html: layout({
      heading: `You're delivering ${order.number}`,
      preview: `${order.customerName}, ${destination}`,
      body: `${paragraph(`Hi ${firstName(rider.name)}, this order is yours. ${escapeHtml(whenLine(order))}.`)}
      ${order.allergyNote ? panel(`<strong style="font-size:16px">⚠ Allergy: ${escapeHtml(order.allergyNote)}</strong>`, 'alert') : ''}
      ${panel(
        `${label('Deliver to')}<strong>${escapeHtml(order.customerName)}</strong><br>${escapeHtml(
          order.address,
        )}<br>${escapeHtml(order.postcode)}${
          order.distanceMiles != null ? ` (${order.distanceMiles.toFixed(1)} miles)` : ''
        }<br><a href="tel:${escapeHtml(order.customerPhone.replace(/\s/g, ''))}" style="color:#C8401C">${escapeHtml(
          order.customerPhone,
        )}</a>${order.deliveryNote ? `<br><em>Note: ${escapeHtml(order.deliveryNote)}</em>` : ''}`,
      )}
      ${button('Open in Maps', mapUrl)}
      ${
        order.paymentStatus === 'due'
          ? panel(
              `${label('Collect payment')}<strong>${money(order.total)}</strong> in cash or by card on the doorstep.`,
              'alert',
            )
          : paragraph('Already paid by card. Nothing to collect.')
      }
      ${priceRows(itemRows(order).map(({ name, detail }) => ({ name, detail, amount: '' })))}
      ${button('My deliveries', `${env.ADMIN_URL}/deliveries`)}`,
    }),
  })
}
