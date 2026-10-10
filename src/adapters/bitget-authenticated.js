import crypto from 'node:crypto';

/**
 * Official Bitget Unified Trading Account (UTA / v3) Authenticated Client
 * Implements HMAC-SHA256 request signing and error handling per official Bitget documentation.
 * Strictly executed server-side.
 */
export class BitgetAuthenticatedClient {
  constructor(credentials = {}) {
    this.apiKey = credentials.apiKey || process.env.BITGET_API_KEY || '';
    this.apiSecret = credentials.apiSecret || process.env.BITGET_API_SECRET || '';
    this.passphrase = credentials.passphrase || process.env.BITGET_API_PASSPHRASE || '';
    this.baseUrl = credentials.baseUrl || process.env.BITGET_API_BASE_URL || 'https://api.bitget.com';
    this.timeoutMs = credentials.timeoutMs || 5000;
  }

  /**
   * Validates presence of credentials without exposing secret values.
   * @returns {{ hasKey: boolean, hasSecret: boolean, hasPassphrase: boolean, isConfigured: boolean }}
   */
  getCredentialStatus() {
    return {
      hasKey: Boolean(this.apiKey && this.apiKey.length >= 8),
      hasSecret: Boolean(this.apiSecret && this.apiSecret.length >= 8),
      hasPassphrase: Boolean(this.passphrase && this.passphrase.length >= 4),
      isConfigured: Boolean(this.apiKey && this.apiSecret && this.passphrase),
    };
  }

  /**
   * Generates official Bitget HMAC-SHA256 signature.
   * Sign string: timestamp + method + requestPath + (body || '')
   * @param {string} timestamp
   * @param {string} method
   * @param {string} requestPath
   * @param {string} body
   * @returns {string} base64 encoded signature
   */
  generateSignature(timestamp, method, requestPath, body = '') {
    if (!this.apiSecret) {
      throw new Error('BITGET_AUTH_ERROR: API secret is not configured.');
    }
    const preHash = `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(preHash)
      .digest('base64');
  }

  /**
   * Dispatches authenticated request to Bitget API.
   * @param {string} method - 'GET' | 'POST'
   * @param {string} requestPath - e.g. '/api/v2/mix/account/accounts'
   * @param {Object} [params] - Query parameters or JSON body
   * @returns {Promise<Object>}
   */
  async request(method, requestPath, params = null) {
    const credStatus = this.getCredentialStatus();
    if (!credStatus.isConfigured) {
      throw new Error('BITGET_CREDENTIALS_MISSING: API key, secret, and passphrase are required.');
    }

    const timestamp = Date.now().toString();
    let url = `${this.baseUrl}${requestPath}`;
    let bodyString = '';

    if (method.toUpperCase() === 'GET' && params) {
      const query = new URLSearchParams(params).toString();
      if (query) {
        requestPath += `?${query}`;
        url += `?${query}`;
      }
    } else if (method.toUpperCase() === 'POST' && params) {
      bodyString = JSON.stringify(params);
    }

    const sign = this.generateSignature(timestamp, method, requestPath, bodyString);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'ACCESS-KEY': this.apiKey,
      'ACCESS-SIGN': sign,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': this.passphrase,
      'locale': 'en-US',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: method.toUpperCase(),
        headers,
        body: method.toUpperCase() === 'POST' ? bodyString : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const json = await response.json();

      if (!response.ok || json.code !== '00000') {
        const errorMsg = json.msg || `HTTP status ${response.status}`;
        const errorCode = json.code || 'UNKNOWN_EXCHANGE_ERROR';
        throw new Error(`Bitget Exchange Error [${errorCode}]: ${errorMsg}`);
      }

      return json.data;
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error(`Bitget API Request Timeout (${this.timeoutMs}ms) on ${requestPath}`);
      }
      throw err;
    }
  }

  /**
   * Retrieves account assets and available balances for USDT Futures.
   * Path: /api/v2/mix/account/accounts?productType=USDT-FUTURES
   */
  async getAccountAssets(productType = 'USDT-FUTURES') {
    return this.request('GET', '/api/v2/mix/account/accounts', { productType });
  }

  /**
   * Retrieves active positions for USDT Futures.
   * Path: /api/v2/mix/position/all-position?productType=USDT-FUTURES
   */
  async getPositions(productType = 'USDT-FUTURES') {
    return this.request('GET', '/api/v2/mix/position/all-position', { productType });
  }

  /**
   * Retrieves open pending orders for USDT Futures.
   * Path: /api/v2/mix/order/orders-pending?productType=USDT-FUTURES
   */
  async getOpenOrders(symbol = null, productType = 'USDT-FUTURES') {
    const params = { productType };
    if (symbol) params.symbol = symbol;
    return this.request('GET', '/api/v2/mix/order/orders-pending', params);
  }

  /**
   * Places an exchange order for USDT Futures.
   * Path: /api/v2/mix/order/place-order
   */
  async placeOrder(orderParams) {
    const payload = {
      productType: orderParams.productType || 'USDT-FUTURES',
      symbol: orderParams.symbol,
      marginMode: orderParams.marginMode || 'crossed',
      marginCoin: orderParams.marginCoin || 'USDT',
      size: String(orderParams.quantity),
      side: orderParams.side.toLowerCase() === 'long' ? 'buy' : 'sell',
      orderType: orderParams.orderType || 'market',
      price: orderParams.price ? String(orderParams.price) : undefined,
      clientOid: orderParams.clientOid || `vt2-${Date.now()}`,
    };
    return this.request('POST', '/api/v2/mix/order/place-order', payload);
  }

  /**
   * Cancels an existing exchange order.
   * Path: /api/v2/mix/order/cancel-order
   */
  async cancelOrder(symbol, orderId, productType = 'USDT-FUTURES') {
    return this.request('POST', '/api/v2/mix/order/cancel-order', {
      productType,
      symbol,
      orderId,
    });
  }
}
