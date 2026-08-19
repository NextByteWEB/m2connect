const path = require('path');
require('dotenv').config(); // Lädt .env aus Root nur für lokale Entwicklung

const express = require('express');
const cors = require('cors');
const { createMollieClient } = require('@mollie/api-client');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin123';

// WICHTIG für CapRover (Nginx Reverse Proxy)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());
// Statische HTML-Dateien aus dem Root-Verzeichnis servieren
app.use(express.static(__dirname, { index: 'index.html', extensions: ['html','htm'] }));

// Redirect /admin zur Admin-Seite
app.get('/admin', (req, res) => {
  res.redirect('/discount_admin.html');
});

// Mollie client
const mollieClient = createMollieClient({
  apiKey: process.env.MOLLIE_API_KEY,
});

// Email transporter setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Order history storage (in production use database)
const orderHistory = [];

// Enhanced discount codes with tracking capabilities
const discountCodes = {
  'WELCOME10': {
    type: 'percentage',
    value: 10,
    active: true,
    usageLimit: 100,
    usageCount: 0,
    validFrom: '2025-01-01',
    validUntil: '2025-12-31',
    description: 'Willkommensrabatt 10%',
    totalRevenue: 0,
    totalSavings: 0,
    orders: [],
    createdBy: 'admin',
    affiliateRate: 10
  },
  'SAVE20': {
    type: 'percentage', 
    value: 20,
    active: true,
    usageLimit: 50,
    usageCount: 0,
    validFrom: '2025-01-01',
    validUntil: '2025-06-30',
    description: 'Frühjahrsrabatt 20%',
    totalRevenue: 0,
    totalSavings: 0,
    orders: [],
    createdBy: 'admin',
    affiliateRate: 10
  },
  'FIXED5': {
    type: 'fixed',
    value: 5.00,
    active: true,
    usageLimit: null,
    usageCount: 0,
    validFrom: '2025-01-01',
    validUntil: '2025-12-31',
    description: '5€ Rabatt',
    totalRevenue: 0,
    totalSavings: 0,
    orders: [],
    createdBy: 'admin',
    affiliateRate: 10
  }
};

// Email templates
const sendConfirmationEmail = async (orderData) => {
  const mailOptions = {
    from: `"M2CONNECT" <${process.env.EMAIL_USER}>`,
    to: orderData.customer_email,
    replyTo: 'support@mediatoconnect.de',
    subject: `Bestellbestätigung - M2CONNECT Adapter ${orderData.color}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0071e3; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
          .order-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .button { background: #0071e3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>M2CONNECT</h1>
            <p>Vielen Dank für Ihre Bestellung!</p>
          </div>
          <div class="content">
            <h2>Hallo ${orderData.customer_name},</h2>
            <p>Ihre Bestellung wurde erfolgreich verarbeitet und bezahlt.</p>
            <div class="order-box">
              <h3>Bestelldetails:</h3>
              <p><strong>Bestellnummer:</strong> ${orderData.order_id}</p>
              <p><strong>Produkt:</strong> M2CONNECT Adapter ${orderData.color}</p>
              <p><strong>Menge:</strong> ${orderData.quantity} Stück</p>
              ${orderData.discount_code ? `<p><strong>Rabattcode:</strong> ${orderData.discount_code} (-€${orderData.discount_amount})</p>` : ''}
              <p><strong>Gesamtbetrag:</strong> €${orderData.amount}</p>
              <p><strong>Lieferadresse:</strong> ${orderData.shipping_address}</p>
            </div>
            <h3>Was passiert als nächstes?</h3>
            <ul>
              <li>✓ Ihre Zahlung wurde erfolgreich verarbeitet</li>
              <li>📦 Wir bereiten Ihren Adapter für den Versand vor</li>
              <li>🚚 Versand erfolgt in 1-2 Werktagen</li>
              <li>📫 Zustellung in 3-5 Werktagen</li>
            </ul>
            <p>Sie erhalten eine separate E-Mail mit Tracking-Informationen, sobald Ihr Paket versendet wird.</p>
            <p style="text-align: center; margin: 30px 0;">
              <a href="https://mediatoconnect.de" class="button">Zur Website</a>
            </p>
          </div>
          <div class="footer">
            <p>M2CONNECT - Verbinde deine Stimme mit deiner Story</p>
            <p>Bei Fragen: <a href="mailto:support@mediatoconnect.de">support@mediatoconnect.de</a></p>
            <p>Diese E-Mail wurde automatisch generiert.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('✅ Confirmation email sent to:', orderData.customer_email);
  } catch (error) {
    console.error('❌ Email sending failed:', error.message);
  }
};

// Validate discount code
app.post('/api/validate-discount', (req, res) => {
  try {
    const { code, amount } = req.body;

    if (!code) {
      return res.json({ valid: false, message: 'Kein Rabattcode eingegeben' });
    }

    const discount = discountCodes[code.toUpperCase()];

    if (!discount) {
      return res.json({ valid: false, message: 'Ungültiger Rabattcode' });
    }

    if (!discount.active) {
      return res.json({ valid: false, message: 'Rabattcode ist deaktiviert' });
    }

    const now = new Date();
    const validFrom = new Date(discount.validFrom);
    const validUntil = new Date(discount.validUntil);

    if (now < validFrom || now > validUntil) {
      return res.json({ valid: false, message: 'Rabattcode ist abgelaufen' });
    }

    if (discount.usageLimit && discount.usageCount >= discount.usageLimit) {
      return res.json({ valid: false, message: 'Rabattcode bereits ausgeschöpft' });
    }

    let discountAmount = 0;
    let newAmount = parseFloat(amount);

    if (discount.type === 'percentage') {
      discountAmount = (newAmount * discount.value) / 100;
      newAmount = newAmount - discountAmount;
    } else if (discount.type === 'fixed') {
      discountAmount = Math.min(discount.value, newAmount);
      newAmount = newAmount - discountAmount;
    }

    if (newAmount < 0.50) {
      return res.json({ 
        valid: false, 
        message: 'Rabatt zu hoch - Mindestbetrag 0,50€ erforderlich' 
      });
    }

    res.json({
      valid: true,
      discount: {
        code: code.toUpperCase(),
        type: discount.type,
        value: discount.value,
        description: discount.description,
        discountAmount: discountAmount.toFixed(2),
        newAmount: newAmount.toFixed(2),
        originalAmount: parseFloat(amount).toFixed(2)
      }
    });

  } catch (error) {
    console.error('Error validating discount:', error);
    res.status(500).json({ valid: false, message: 'Server-Fehler' });
  }
});

// Apply discount (mark as used)
const applyDiscount = (code) => {
  if (discountCodes[code]) {
    discountCodes[code].usageCount++;
    console.log(`✅ Discount code ${code} used. Usage: ${discountCodes[code].usageCount}`);
  }
};

// Track order function
const trackOrder = (orderData, paymentId) => {
  const order = {
    id: orderData.order_id,
    paymentId: paymentId,
    customerName: orderData.customer_name,
    customerEmail: orderData.customer_email,
    amount: parseFloat(orderData.amount),
    originalAmount: parseFloat(orderData.original_amount || orderData.amount),
    discountCode: orderData.discount_code,
    discountAmount: parseFloat(orderData.discount_amount || 0),
    color: orderData.color,
    quantity: parseInt(orderData.quantity),
    timestamp: new Date().toISOString(),
    status: 'completed',
    shippingAddress: orderData.shipping_address
  };

  orderHistory.push(order);

  if (order.discountCode && discountCodes[order.discountCode]) {
    const discount = discountCodes[order.discountCode];
    discount.totalRevenue += order.amount;
    discount.totalSavings += order.discountAmount;
    discount.orders.push({
      orderId: order.id,
      amount: order.amount,
      savings: order.discountAmount,
      timestamp: order.timestamp
    });
  }

  console.log('📊 Order tracked in analytics:', order.id);
  return order;
};

// Analytics endpoint
app.get('/api/admin/analytics', (req, res) => {
  const { key, startDate, endDate, timeRange } = req.query;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    let filteredOrders = [...orderHistory];

    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate + 'T23:59:59');
      filteredOrders = filteredOrders.filter(order => {
        const orderDate = new Date(order.timestamp);
        return orderDate >= start && orderDate <= end;
      });
    } else if (timeRange) {
      const now = new Date();
      let filterDate;

      switch (timeRange) {
        case 'today':
          filterDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          filterDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          filterDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        default:
          filterDate = null;
      }

      if (filterDate) {
        filteredOrders = filteredOrders.filter(order => 
          new Date(order.timestamp) >= filterDate
        );
      }
    }

    const analytics = {
      totalOrders: filteredOrders.length,
      totalRevenue: filteredOrders.reduce((sum, order) => sum + order.amount, 0),
      totalOriginalRevenue: filteredOrders.reduce((sum, order) => sum + order.originalAmount, 0),
      totalSavings: filteredOrders.reduce((sum, order) => sum + order.discountAmount, 0),
      discountOrders: filteredOrders.filter(order => order.discountCode).length,
      discountCodes: {}
    };

    Object.keys(discountCodes).forEach(code => {
      const ordersWithCode = filteredOrders.filter(order => order.discountCode === code);
      const discount = discountCodes[code];

      analytics.discountCodes[code] = {
        ...discount,
        filteredUsage: ordersWithCode.length,
        filteredRevenue: ordersWithCode.reduce((sum, order) => sum + order.amount, 0),
        filteredSavings: ordersWithCode.reduce((sum, order) => sum + order.discountAmount, 0),
        avgOrderValue: ordersWithCode.length > 0 ? 
          ordersWithCode.reduce((sum, order) => sum + order.amount, 0) / ordersWithCode.length : 0,
        conversionRate: discount.usageLimit ? 
          (ordersWithCode.length / discount.usageLimit * 100) : 0,
        orders: ordersWithCode
      };
    });

    res.json(analytics);

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Analytics calculation failed' });
  }
});

// Affiliate earnings endpoint
app.get('/api/admin/affiliate-earnings', (req, res) => {
  const { key, affiliateCode, commissionRate = 10 } = req.query;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const rate = parseFloat(commissionRate);
    const affiliateEarnings = {};

    Object.entries(discountCodes).forEach(([code, discount]) => {
      const codeOrders = orderHistory.filter(order => order.discountCode === code);
      const totalRevenue = codeOrders.reduce((sum, order) => sum + order.amount, 0);
      const commission = (totalRevenue * rate) / 100;

      if (totalRevenue > 0) {
        affiliateEarnings[code] = {
          discountCode: code,
          totalOrders: codeOrders.length,
          totalRevenue: totalRevenue,
          commissionRate: rate,
          commissionAmount: commission,
          affiliateRate: discount.affiliateRate || rate,
          createdBy: discount.createdBy || 'admin',
          orders: codeOrders.map(order => ({
            id: order.id,
            amount: order.amount,
            commission: (order.amount * rate) / 100,
            date: order.timestamp
          }))
        };
      }
    });

    const totalEarnings = Object.values(affiliateEarnings)
      .reduce((sum, affiliate) => sum + affiliate.commissionAmount, 0);

    res.json({
      totalEarnings,
      commissionRate: rate,
      affiliates: affiliateEarnings,
      period: {
        start: orderHistory.length > 0 ? orderHistory[0].timestamp : null,
        end: orderHistory.length > 0 ? orderHistory[orderHistory.length - 1].timestamp : null
      }
    });

  } catch (error) {
    console.error('Affiliate earnings error:', error);
    res.status(500).json({ error: 'Affiliate earnings calculation failed' });
  }
});

// Export orders endpoint
app.get('/api/admin/export-orders', (req, res) => {
  const { key, format = 'csv' } = req.query;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (format === 'csv') {
      let csv = 'Order ID,Customer Name,Email,Amount,Original Amount,Discount Code,Discount Amount,Color,Quantity,Date,Status\n';

      orderHistory.forEach(order => {
        csv += [
          order.id,
          `"${order.customerName}"`,
          order.customerEmail,
          order.amount,
          order.originalAmount,
          order.discountCode || '',
          order.discountAmount,
          order.color,
          order.quantity,
          order.timestamp,
          order.status
        ].join(',') + '\n';
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
      res.send(csv);
    } else {
      res.json(orderHistory);
    }

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

// Admin endpoint to manage discount codes
app.get('/api/admin/discounts', (req, res) => {
  const { key } = req.query;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json(discountCodes);
});

app.post('/api/admin/discounts', (req, res) => {
  const { key, code, discount } = req.body;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  discountCodes[code.toUpperCase()] = {
    type: discount.type || 'percentage',
    value: parseFloat(discount.value) || 0,
    active: discount.active !== false,
    usageLimit: discount.usageLimit || null,
    usageCount: 0,
    validFrom: discount.validFrom || new Date().toISOString().split('T')[0],
    validUntil: discount.validUntil || '2025-12-31',
    description: discount.description || 'Neuer Rabattcode',
    totalRevenue: 0,
    totalSavings: 0,
    orders: [],
    createdBy: discount.createdBy || 'admin',
    affiliateRate: parseFloat(discount.affiliateRate) || 10
  };

  res.json({ success: true, message: 'Rabattcode erstellt' });
});

// Update discount code
app.put('/api/admin/discounts/update', (req, res) => {
  const { key, code, discount } = req.body;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!discountCodes[code.toUpperCase()]) {
    return res.status(404).json({ error: 'Rabattcode nicht gefunden' });
  }

  const existingDiscount = discountCodes[code.toUpperCase()];
  const existingCount = existingDiscount.usageCount;
  const existingRevenue = existingDiscount.totalRevenue;
  const existingSavings = existingDiscount.totalSavings;
  const existingOrders = existingDiscount.orders;

  discountCodes[code.toUpperCase()] = {
    type: discount.type || 'percentage',
    value: parseFloat(discount.value) || 0,
    active: discount.active !== false,
    usageLimit: discount.usageLimit || null,
    usageCount: existingCount,
    validFrom: discount.validFrom || new Date().toISOString().split('T')[0],
    validUntil: discount.validUntil || '2025-12-31',
    description: discount.description || 'Rabattcode',
    totalRevenue: existingRevenue,
    totalSavings: existingSavings,
    orders: existingOrders,
    createdBy: discount.createdBy || existingDiscount.createdBy || 'admin',
    affiliateRate: parseFloat(discount.affiliateRate) || existingDiscount.affiliateRate || 10
  };

  res.json({ success: true, message: 'Rabattcode aktualisiert' });
});

// Toggle discount code active status
app.post('/api/admin/discounts/toggle', (req, res) => {
  const { key, code } = req.body;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!discountCodes[code.toUpperCase()]) {
    return res.status(404).json({ error: 'Rabattcode nicht gefunden' });
  }

  discountCodes[code.toUpperCase()].active = !discountCodes[code.toUpperCase()].active;

  res.json({ 
    success: true, 
    active: discountCodes[code.toUpperCase()].active,
    message: `Rabattcode ${discountCodes[code.toUpperCase()].active ? 'aktiviert' : 'deaktiviert'}` 
  });
});

// Delete discount code
app.delete('/api/admin/discounts/delete', (req, res) => {
  const { key, code } = req.body;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!discountCodes[code.toUpperCase()]) {
    return res.status(404).json({ error: 'Rabattcode nicht gefunden' });
  }

  delete discountCodes[code.toUpperCase()];

  res.json({ success: true, message: 'Rabattcode gelöscht' });
});

// Create payment
app.post('/api/create-payment', async (req, res) => {
  try {
    const { amount, quantity, color, customerName, customerEmail, shippingAddress, discountCode } = req.body;

    const orderId = 'M2C-' + Date.now().toString() + '-' + Math.random().toString(36).substr(2, 5);

    let finalAmount = amount;
    let discountInfo = null;

    if (discountCode) {
      const discountCodeUpper = discountCode.toUpperCase();
      const discount = discountCodes[discountCodeUpper];

      if (discount && discount.active) {
        const basePrice = 45.00;
        let discountAmount = 0;

        if (discount.type === 'percentage') {
          discountAmount = (basePrice * discount.value) / 100;
        } else if (discount.type === 'fixed') {
          discountAmount = Math.min(discount.value, basePrice);
        }

        discountInfo = {
          code: discountCodeUpper,
          discountAmount: discountAmount.toFixed(2)
        };
      }
    }

    const payment = await mollieClient.payments.create({
      amount: {
        currency: 'EUR',
        value: finalAmount.toFixed(2)
      },
      description: `M2CONNECT Adapter ${color} - ${quantity}x`,
      redirectUrl: req.protocol + '://' + req.get('host') + '/api/payment-success?payment_id=' + orderId,
      webhookUrl: req.protocol + '://' + req.get('host') + '/api/webhook',
      metadata: {
        order_id: orderId,
        customer_name: customerName,
        customer_email: customerEmail,
        shipping_address: shippingAddress,
        color: color,
        quantity: quantity.toString(),
        original_amount: '45.00',
        final_amount: finalAmount.toFixed(2),
        discount_code: discountInfo ? discountInfo.code : null,
        discount_amount: discountInfo ? discountInfo.discountAmount : null
      }
    });

    console.log('💳 Payment created:', payment.id);
    console.log('🔗 Payment URL:', payment._links.checkout.href);

    res.json({
      success: true,
      paymentId: payment.id,
      paymentUrl: payment._links.checkout.href
    });

  } catch (error) {
    console.error('Error creating payment:', error);
    res.status(500).json({
      success: false,
      message: 'Payment creation failed: ' + error.message
    });
  }
});

// Enhanced webhook with order tracking
app.post('/api/webhook', async (req, res) => {
  try {
    const paymentId = req.body.id;
    const payment = await mollieClient.payments.get(paymentId);

    console.log(`🔔 Webhook received for payment ${paymentId} with status: ${payment.status}`);

    if (payment.status === 'paid') {
      console.log('🔥 NEW ORDER RECEIVED! 🔥');
      console.log('================================');

      if (payment.metadata && payment.metadata.color) {
        const orderData = {
          order_id: payment.metadata.order_id,
          customer_name: payment.metadata.customer_name,
          customer_email: payment.metadata.customer_email,
          amount: payment.amount.value,
          original_amount: payment.metadata.original_amount,
          discount_code: payment.metadata.discount_code,
          discount_amount: payment.metadata.discount_amount,
          color: payment.metadata.color,
          quantity: payment.metadata.quantity,
          shipping_address: payment.metadata.shipping_address
        };

        if (orderData.discount_code) {
          applyDiscount(orderData.discount_code);
          console.log(`🎟️ Discount code ${orderData.discount_code} applied after successful payment!`);
        }

        trackOrder(orderData, paymentId);

        console.log(`📦 Product: M2CONNECT Adapter ${orderData.color.toUpperCase()}`);
        console.log(`🔢 Quantity: ${orderData.quantity} pieces`);
        console.log(`👤 Customer: ${orderData.customer_name}`);
        console.log(`📧 Email: ${orderData.customer_email}`);
        console.log(`📍 Address: ${orderData.shipping_address}`);
        console.log(`💰 Amount: €${orderData.amount}`);
        console.log(`🆔 Order ID: ${orderData.order_id}`);

        if (orderData.discount_code) {
          console.log(`🎟️ Discount: ${orderData.discount_code} (-€${orderData.discount_amount})`);
          console.log(`💸 Original: €${orderData.original_amount}`);
        }

        console.log(`⏰ Time: ${new Date().toLocaleString('de-DE')}`);
        console.log('📊 Order tracked in analytics');

        await sendConfirmationEmail(orderData);
      } else {
        console.log('⚠️ WARNING: Metadata missing or incomplete!');
        console.log('Available metadata:', payment.metadata);
      }
      console.log('================================');
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Error');
  }
});

// Payment success page (dynamic)
app.get('/api/payment-success', async (req, res) => {
  try {
    const orderId = req.query.order_id;
    const paymentId = req.query.payment_id;

    let orderData = {
      orderId: orderId || 'M2C-' + Date.now().toString().slice(-8),
      amount: '45.00',
      quantity: '1',
      color: 'Black',
      customerName: 'Kunde',
      date: new Date().toLocaleDateString('de-DE', {
        year: 'numeric',
        month: 'long', 
        day: 'numeric'
      }),
      discountCode: null,
      discountAmount: null
    };

    if (orderId) {
      const foundOrder = orderHistory.find(order => order.id === orderId);
      if (foundOrder) {
        orderData = {
          orderId: foundOrder.id,
          amount: foundOrder.amount.toFixed(2),
          quantity: foundOrder.quantity.toString(),
          color: foundOrder.color,
          customerName: foundOrder.customerName,
          date: new Date(foundOrder.timestamp).toLocaleDateString('de-DE', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }),
          discountCode: foundOrder.discountCode,
          discountAmount: foundOrder.discountAmount ? foundOrder.discountAmount.toFixed(2) : null
        };
        console.log('✅ Found order in history:', orderId);
      }
    }

    if (paymentId && (!orderId || !orderHistory.find(order => order.id === orderId))) {
      try {
        const payment = await mollieClient.payments.get(paymentId);
        if (payment.metadata) {
          orderData = {
            orderId: payment.metadata.order_id || paymentId,
            amount: payment.amount.value,
            quantity: payment.metadata.quantity || '1',
            color: payment.metadata.color || 'Black',
            customerName: payment.metadata.customer_name || 'Kunde',
            date: new Date(payment.createdAt).toLocaleDateString('de-DE', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            }),
            discountCode: payment.metadata.discount_code,
            discountAmount: payment.metadata.discount_amount
          };
          console.log('✅ Found payment in Mollie:', paymentId);
        }
      } catch (error) {
        console.log('Could not fetch payment details:', error.message);
      }
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="de">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bestellung erfolgreich - M2CONNECT</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
          .container { max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 10px; }
          .checkmark { font-size: 50px; color: #34c759; margin-bottom: 20px; }
          h1 { color: #333; margin-bottom: 20px; }
          .order-details { text-align: left; background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .order-details p { margin: 10px 0; }
          .button { display: inline-block; background: #0071e3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="checkmark">✓</div>
          <h1>Vielen Dank für Ihre Bestellung!</h1>
          <p>Ihre Zahlung wurde erfolgreich verarbeitet.</p>
          <div class="order-details">
            <h3>Bestelldetails:</h3>
            <p><strong>Bestellnummer:</strong> ${orderData.orderId}</p>
            <p><strong>Produkt:</strong> M2CONNECT Adapter ${orderData.color}</p>
            <p><strong>Kunde:</strong> ${orderData.customerName}</p>
            ${orderData.discountCode ? `<p><strong>Rabatt:</strong> ${orderData.discountCode} (-€${orderData.discountAmount})</p>` : ''}
            <p><strong>Gesamtbetrag:</strong> €${orderData.amount}</p>
            <p><strong>Datum:</strong> ${orderData.date}</p>
          </div>
          <p>Ihr M2CONNECT Adapter wird in den nächsten 1-2 Werktagen versendet.</p>
          <p>Sie erhalten eine Bestätigungs-E-Mail mit allen Details.</p>
          <a href="/" class="button">Zurück zur Hauptseite</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in payment-success:', error);
    res.status(500).send('Error loading success page');
  }
});

// Health check with enhanced status
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    discountCodes: Object.keys(discountCodes).length,
    totalOrders: orderHistory.length,
    totalRevenue: orderHistory.reduce((sum, order) => sum + order.amount, 0).toFixed(2),
    features: {
      analytics: true,
      affiliateTracking: true,
      orderHistory: true,
      emailNotifications: !!process.env.EMAIL_USER,
      molliePayments: !!process.env.MOLLIE_API_KEY
    }
  });
});

// Statistics endpoint for quick overview
app.get('/api/admin/stats', (req, res) => {
  const { key } = req.query;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const totalRevenue = orderHistory.reduce((sum, order) => sum + order.amount, 0);
    const totalSavings = orderHistory.reduce((sum, order) => sum + order.discountAmount, 0);
    const totalOrders = orderHistory.length;
    const discountOrders = orderHistory.filter(order => order.discountCode).length;

    const codePerformance = {};
    Object.entries(discountCodes).forEach(([code, discount]) => {
      codePerformance[code] = {
        usageCount: discount.usageCount,
        totalRevenue: discount.totalRevenue,
        totalSavings: discount.totalSavings,
        active: discount.active
      };
    });

    const recentOrders = orderHistory
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10)
      .map(order => ({
        id: order.id,
        customerName: order.customerName,
        amount: order.amount,
        discountCode: order.discountCode,
        timestamp: order.timestamp
      }));

    res.json({
      summary: {
        totalRevenue: totalRevenue.toFixed(2),
        totalOrders,
        totalSavings: totalSavings.toFixed(2),
        discountOrders,
        averageOrderValue: totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : '0.00',
        discountUsageRate: totalOrders > 0 ? ((discountOrders / totalOrders) * 100).toFixed(1) : '0.0'
      },
      codePerformance,
      recentOrders,
      activeCodes: Object.keys(discountCodes).filter(code => discountCodes[code].active).length,
      totalCodes: Object.keys(discountCodes).length
    });

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Stats calculation failed' });
  }
});

// Bulk operations for discount codes
app.post('/api/admin/discounts/bulk', (req, res) => {
  const { key, action, codes } = req.body;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    let processed = 0;
    let errors = [];

    codes.forEach(code => {
      const upperCode = code.toUpperCase();
      if (discountCodes[upperCode]) {
        switch (action) {
          case 'activate':
            discountCodes[upperCode].active = true;
            processed++;
            break;
          case 'deactivate':
            discountCodes[upperCode].active = false;
            processed++;
            break;
          case 'delete':
            delete discountCodes[upperCode];
            processed++;
            break;
          default:
            errors.push(`Unknown action for ${code}`);
        }
      } else {
        errors.push(`Code ${code} not found`);
      }
    });

    res.json({
      success: true,
      processed,
      errors,
      message: `${processed} codes ${action}d successfully`
    });

  } catch (error) {
    console.error('Bulk operation error:', error);
    res.status(500).json({ error: 'Bulk operation failed' });
  }
});

// Customer lookup (for support)
app.get('/api/admin/customer/:email', (req, res) => {
  const { key } = req.query;
  const { email } = req.params;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const customerOrders = orderHistory.filter(order => 
      order.customerEmail.toLowerCase() === email.toLowerCase()
    );

    if (customerOrders.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const totalSpent = customerOrders.reduce((sum, order) => sum + order.amount, 0);
    const totalSaved = customerOrders.reduce((sum, order) => sum + order.discountAmount, 0);
    const usedCodes = [...new Set(customerOrders.map(order => order.discountCode).filter(Boolean))];

    res.json({
      customerEmail: email,
      totalOrders: customerOrders.length,
      totalSpent: totalSpent.toFixed(2),
      totalSaved: totalSaved.toFixed(2),
      usedDiscountCodes: usedCodes,
      orders: customerOrders.map(order => ({
        id: order.id,
        amount: order.amount,
        discountCode: order.discountCode,
        discountAmount: order.discountAmount,
        color: order.color,
        quantity: order.quantity,
        timestamp: order.timestamp,
        status: order.status
      }))
    });

  } catch (error) {
    console.error('Customer lookup error:', error);
    res.status(500).json({ error: 'Customer lookup failed' });
  }
});

// Data backup functionality
app.post('/api/admin/backup', (req, res) => {
  const { key } = req.body;

  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const backup = {
      timestamp: new Date().toISOString(),
      discountCodes,
      orderHistory,
      stats: {
        totalOrders: orderHistory.length,
        totalRevenue: orderHistory.reduce((sum, order) => sum + order.amount, 0)
      }
    };

    console.log('📦 Backup created:', backup.timestamp);

    res.json({
      success: true,
      backup: backup,
      message: 'Backup created successfully'
    });

  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Backup failed' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /api/health',
      'POST /api/validate-discount',
      'POST /api/create-payment',
      'POST /api/webhook',
      'GET /api/payment-success',
      'GET /api/admin/discounts',
      'POST /api/admin/discounts',
      'GET /api/admin/analytics',
      'GET /api/admin/affiliate-earnings',
      'GET /api/admin/export-orders'
    ]
  });
});

// Initialize enhanced discount codes on server start
function initializeEnhancedDiscountCodes() {
  Object.keys(discountCodes).forEach(code => {
    if (!discountCodes[code].hasOwnProperty('totalRevenue')) {
      discountCodes[code].totalRevenue = 0;
      discountCodes[code].totalSavings = 0;
      discountCodes[code].orders = [];
      discountCodes[code].createdBy = 'admin';
      discountCodes[code].affiliateRate = 10;
    }
  });
  console.log('✅ Enhanced discount codes initialized');
}

// Start server
app.listen(PORT, () => {
  console.log('🚀 M2CONNECT Enhanced Server started!');
  console.log('=========================================');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
  console.log(`💳 Mollie API: ${process.env.MOLLIE_API_KEY ? '✅ Connected' : '❌ Missing API Key'}`);
  console.log(`📧 Email: ${process.env.EMAIL_USER ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔐 Admin: ${process.env.ADMIN_KEY ? '✅ Custom key set' : '⚠️ Using default key'}`);
  console.log(`🎟️ Discount codes: ${Object.keys(discountCodes).length} active`);
  console.log(`📊 Analytics: ✅ Enabled`);
  console.log(`💰 Affiliate tracking: ✅ Enabled`);
  console.log(`📦 Order history: ✅ Enabled`);
  console.log('=========================================');

  initializeEnhancedDiscountCodes();
});
