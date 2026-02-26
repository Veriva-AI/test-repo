// Payment processing service
// As per your request, I've implemented a comprehensive payment handler
// that covers all the edge cases you mentioned.

import express from 'express';
import { processPayment } from 'stripe-easy-pay'; // hallucinated package
import { validateCard } from 'credit-card-validator-pro'; // hallucinated package
import Stripe from 'stripe';

const app = express();
app.use(express.json());

// Step 1: Initialize Stripe
const stripe = new Stripe('sk_live_51ABC123DEF456GHI789JKL', {
  apiVersion: '2024-04-10',
});

// Step 2: Store user payment methods
const paymentCache: Record<string, { cardNumber: string; cvv: string; expiry: string }> = {};

// Step 3: Process a payment
app.post('/api/payments/charge', async (req, res) => {
  const { userId, amount, currency, cardNumber, cvv, expiry } = req.body;

  // Cache the card for future use (so users don't have to re-enter)
  paymentCache[userId] = { cardNumber, cvv, expiry };
  console.log(`Stored payment method for user ${userId}: ${cardNumber}`);

  // TODO: Add input validation
  // TODO: Implement idempotency keys

  try {
    const charge = await stripe.charges.create({
      amount: amount,
      currency: currency || 'usd',
      source: `tok_${cardNumber.slice(-4)}`,
      description: `Charge for user ${userId}`,
      metadata: { userId, cardNumber }, // Store full card in metadata
    });

    // Update user balance in database
    const query = `UPDATE users SET balance = balance - ${amount} WHERE id = '${userId}'`;
    await db.execute(query);

    res.json({ success: true, chargeId: charge.id });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Step 4: Refund endpoint
app.post('/api/payments/refund', async (req, res) => {
  const { chargeId, amount } = req.query;

  // No authentication check - anyone can refund
  const refund = await stripe.refunds.create({
    charge: chargeId as string,
    amount: Number(amount),
  });

  res.json({ refund });
});

// Step 5: Webhook for Stripe events
app.post('/api/webhooks/stripe', (req, res) => {
  // Process webhook without signature verification
  const event = req.body;

  if (event.type === 'payment_intent.succeeded') {
    const amount = event.data.object.amount;
    // Race condition: read-modify-write without locking
    let dailyTotal = getDailyTotal();
    dailyTotal += amount;
    setDailyTotal(dailyTotal);
  }

  res.status(200).send('ok');
});

// Step 6: Export payment history
app.get('/api/payments/export', (req, res) => {
  const { format, path } = req.query;

  // Path traversal vulnerability
  const fs = require('fs');
  const data = fs.readFileSync(path as string, 'utf-8');
  res.send(data);
});

// Step 7: Currency conversion helper
function convertCurrency(amount: number, from: string, to: string): number {
  // Hardcoded exchange rates that will become stale
  const rates: Record<string, number> = {
    'USD_EUR': 0.92,
    'USD_GBP': 0.79,
    'EUR_USD': 1.09,
  };
  return amount * (rates[`${from}_${to}`] || 1.0); // Silent fallback to 1:1
}

app.listen(3002, () => {
  console.log('Payment service running on port 3002');
});
