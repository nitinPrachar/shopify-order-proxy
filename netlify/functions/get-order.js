// Netlify Function — handles BOTH Shopify order lookup AND Delhivery tracking
// All API calls happen server-side — no CORS issues
// Secrets stored in Netlify Environment Variables

exports.handler = async function(event) {

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: cors(), body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: cors(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const params           = event.queryStringParameters || {};
  const orderNum         = params.order;
  const awbDirect        = params.awb;
  const SHOPIFY_DOMAIN   = process.env.SHOPIFY_DOMAIN;
  const SHOPIFY_TOKEN    = process.env.SHOPIFY_ADMIN_TOKEN;
  const DELHIVERY_TOKEN  = process.env.DELHIVERY_TOKEN;

  if (!DELHIVERY_TOKEN) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'Server misconfigured. Contact support.' }) };
  }

  try {
    let awb       = awbDirect || null;
    let orderData = null;

    // ── STEP 1: If order number provided, look up AWB from Shopify ──
    if (orderNum && !awbDirect) {
      if (!SHOPIFY_DOMAIN || !SHOPIFY_TOKEN) {
        return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'Shopify not configured.' }) };
      }

      const cleanOrder = orderNum.replace(/^#/, '');
      const shopifyUrl = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders.json?name=%23${cleanOrder}&status=any&fields=id,name,fulfillments,line_items`;

      const shopifyRes = await fetch(shopifyUrl, {
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_TOKEN,
          'Content-Type': 'application/json'
        }
      });

      if (!shopifyRes.ok) throw new Error(`Shopify API error: ${shopifyRes.status}`);

      const shopifyData = await shopifyRes.json();
      const orders = shopifyData.orders;

      if (!orders || orders.length === 0) {
        return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'Order not found. Please check your order number.' }) };
      }

      const order = orders[0];

      if (order.fulfillments && order.fulfillments.length > 0) {
        const tracking = order.fulfillments[0].tracking_numbers;
        if (tracking && tracking.length > 0) awb = tracking[0];
      }

      if (!awb) {
        return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'No tracking number found for this order yet. Please try again later.' }) };
      }

      orderData = {
        orderName: order.name,
        awb:       awb,
        items:     (order.line_items || []).slice(0, 3).map(item => ({
          title: item.title,
          qty:   item.quantity,
          image: item.image_url || null,
          price: item.price
        }))
      };
    }

    // ── STEP 2: Call Delhivery API server-side ──
    if (!awb) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'No AWB number provided.' }) };
    }

    const delhiveryUrl = `https://track.delhivery.com/api/v1/packages/json/?waybill=${encodeURIComponent(awb)}&token=${DELHIVERY_TOKEN}`;

    const delhiveryRes = await fetch(delhiveryUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (!delhiveryRes.ok) throw new Error(`Delhivery API error: ${delhiveryRes.status}`);

    const delhiveryData = await delhiveryRes.json();
    const shipments = delhiveryData && delhiveryData.ShipmentData;

    if (!shipments || shipments.length === 0) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'No shipment found for this tracking number.' }) };
    }

    // ── STEP 3: Return everything in one response ──
    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        shipment:  shipments[0].Shipment,
        orderData: orderData
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ error: err.message || 'Server error. Please try again.' })
    };
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Content-Type':                 'application/json'
  };
}
