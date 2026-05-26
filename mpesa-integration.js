// mpesa-integration.js
// Backend template for Daraja (M-Pesa) STK Push integration
// - Two support categories: GENERAL_SUPPORT and PROJECT_SPECIFIC
// - Each category contains two configurations: Paybill and BuyGoods (Till)
// - Exactly FOUR template payload builders are provided for you to fill in credentials
//
// Usage: import or require this module and call `processPayment(options)`
// Example:
// const mpesa = require('./mpesa-integration');
// await mpesa.processPayment({ category: 'GENERAL_SUPPORT', method: 'paybill', phone: '2547XXXXXXXX', amount: 100 });

const https = require('https');
const { URL } = require('url');

// -- CONFIG: Replace these placeholders with your live sandbox/production credentials --
// Consumer Key / Secret for OAuth
// const CONSUMER_KEY = process.env.MPESA_CONSUMER_KEY || 'YOUR_CONSUMER_KEY';
// const CONSUMER_SECRET = process.env.MPESA_CONSUMER_SECRET || 'YOUR_CONSUMER_SECRET';

// Note: For each template below, replace placeholders like YOUR_SHORTCODE, YOUR_TILL, YOUR_PASSKEY

// Daraja endpoints (sandbox shown). Swap to production URLs when ready.
const DAR_OAUTH_URL = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
const DAR_STK_PUSH_URL = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

// Helper: format timestamp yyyyMMddHHmmss
function getTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear().toString()
    + pad(d.getMonth() + 1)
    + pad(d.getDate())
    + pad(d.getHours())
    + pad(d.getMinutes())
    + pad(d.getSeconds());
}

// Helper: small HTTPS POST returning parsed JSON
function postJson(urlStr, headers, body) {
  const url = new URL(urlStr);
  const data = JSON.stringify(body);
  const opts = {
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw || '{}');
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
          return reject({ statusCode: res.statusCode, body: parsed });
        } catch (err) {
          return reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Standard Daraja OAuth token generation
// Provide your consumer key & secret (sandbox or production) when calling
async function getOAuthToken(consumerKey, consumerSecret) {
  if (!consumerKey || !consumerSecret) throw new Error('consumerKey and consumerSecret required for OAuth');
  const creds = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const url = DAR_OAUTH_URL;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Authorization: `Basic ${creds}` },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw || '{}');
          if (parsed.access_token) return resolve(parsed.access_token);
          return reject(parsed);
        } catch (err) {
          return reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Build the base STK Push password: base64(BusinessShortCode + Passkey + Timestamp)
function buildPassword(businessShortCode, passkey, timestamp) {
  return Buffer.from(`${businessShortCode}${passkey}${timestamp}`).toString('base64');
}

// --- Template builders for exactly FOUR configurations ---
// Each returns an object suitable for the STK Push processrequest body.

// 1A: GENERAL_SUPPORT - Configuration A (Paybill - CustomerPayBillOnline)
function buildGeneralPaybillPayload({ amount, phone, timestamp }) {
  const BusinessShortCode = 'YOUR_SHORTCODE'; // replace with your Paybill shortcode
  const Passkey = 'YOUR_PASSKEY';
  const password = buildPassword(BusinessShortCode, Passkey, timestamp);

  return {
    BusinessShortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: BusinessShortCode,
    PhoneNumber: phone,
    CallBackURL: 'https://your.domain.com/mpesa/callback',
    AccountReference: 'SUPPORT', // generic account number placeholder
    TransactionDesc: 'GENERAL SUPPORT - Paybill',
  };
}

// 1B: GENERAL_SUPPORT - Configuration B (Buy Goods / Till - CustomerBuyGoodsOnline)
function buildGeneralTillPayload({ amount, phone, timestamp }) {
  const BusinessShortCode = 'YOUR_TILL'; // replace with your Till number
  const Passkey = 'YOUR_PASSKEY';
  const password = buildPassword(BusinessShortCode, Passkey, timestamp);

  return {
    BusinessShortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerBuyGoodsOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: BusinessShortCode,
    PhoneNumber: phone,
    CallBackURL: 'https://your.domain.com/mpesa/callback',
    AccountReference: 'SUPPORT',
    TransactionDesc: 'GENERAL SUPPORT - Till',
  };
}

// 2C: PROJECT_SPECIFIC - Configuration C (Paybill) - AccountNumber dynamically captures project name
function buildProjectPaybillPayload({ amount, phone, timestamp, projectName }) {
  const BusinessShortCode = 'YOUR_PROJECT_SHORTCODE';
  const Passkey = 'YOUR_PASSKEY';
  const password = buildPassword(BusinessShortCode, Passkey, timestamp);

  return {
    BusinessShortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: BusinessShortCode,
    PhoneNumber: phone,
    CallBackURL: 'https://your.domain.com/mpesa/callback',
    AccountReference: projectName || 'PROJECT',
    AccountNumber: projectName || 'PROJECT', // dynamic capture of project name
    TransactionDesc: `PROJECT SUPPORT - ${projectName || 'PROJECT'}`,
  };
}

// 2D: PROJECT_SPECIFIC - Configuration D (Buy Goods / Till) - include project name in metadata
function buildProjectTillPayload({ amount, phone, timestamp, projectName }) {
  const BusinessShortCode = 'YOUR_PROJECT_TILL';
  const Passkey = 'YOUR_PASSKEY';
  const password = buildPassword(BusinessShortCode, Passkey, timestamp);

  // Include a metadata/tracking array for project allocation (template)
  const Metadata = [
    { Name: 'Project', Value: projectName || 'PROJECT' },
    { Name: 'AllocatedTo', Value: 'Ruiru Media House' },
  ];

  return {
    BusinessShortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerBuyGoodsOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: BusinessShortCode,
    PhoneNumber: phone,
    CallBackURL: 'https://your.domain.com/mpesa/callback',
    AccountReference: projectName || 'PROJECT',
    TransactionDesc: `PROJECT TILL - ${projectName || 'PROJECT'}`,
    Metadata,
  };
}

// Entry function: receives user's choice and routes to the correct template & STK Push
// options: { category: 'GENERAL_SUPPORT'|'PROJECT_SPECIFIC', method: 'paybill'|'till', projectName?, phone, amount, consumerKey, consumerSecret }
async function processPayment(options) {
  const { category, method, projectName, phone, amount, consumerKey, consumerSecret } = options || {};
  if (!category || !method) throw new Error('category and method are required');
  if (!phone || !amount) throw new Error('phone and amount are required');
  if (!consumerKey || !consumerSecret) throw new Error('consumerKey and consumerSecret are required to get OAuth token');

  const timestamp = getTimestamp();

  // Choose builder based on exact breakdown requested
  let payloadBuilder;
  if (category === 'GENERAL_SUPPORT' && method === 'paybill') payloadBuilder = buildGeneralPaybillPayload;
  else if (category === 'GENERAL_SUPPORT' && method === 'till') payloadBuilder = buildGeneralTillPayload;
  else if (category === 'PROJECT_SPECIFIC' && method === 'paybill') payloadBuilder = buildProjectPaybillPayload;
  else if (category === 'PROJECT_SPECIFIC' && method === 'till') payloadBuilder = buildProjectTillPayload;
  else throw new Error('Invalid category or method. Allowed combos: GENERAL_SUPPORT|PROJECT_SPECIFIC with paybill|till');

  const body = payloadBuilder({ amount, phone, timestamp, projectName });

  // Acquire OAuth token
  const token = await getOAuthToken(consumerKey, consumerSecret);

  // Send STK Push processrequest
  try {
    const resp = await postJson(DAR_STK_PUSH_URL, { Authorization: `Bearer ${token}` }, body);
    return resp; // return Daraja response for caller to handle
  } catch (err) {
    throw err;
  }
}

module.exports = {
  getOAuthToken,
  processPayment,
  // Export builders if you want to call them directly
  buildGeneralPaybillPayload,
  buildGeneralTillPayload,
  buildProjectPaybillPayload,
  buildProjectTillPayload,
};
