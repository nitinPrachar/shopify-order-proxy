// Netlify Function — Shopify Order Lookup Proxy
// NO secrets in this file — all sensitive values are stored in
// Netlify Dashboard → Site → Environment Variables

exports.handler = async function(event) {

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const orderNum = event.queryStringParameters && event.queryStringParameters.order;
  if (!orderNum) {
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'Missing order parameter' }) };
  }

  // These come from Netlify Environment Variables — never hardcoded here
  const SHOPIFY_DOMAIN      = process.env.SHOPIFY_DOMAIN;
  const SHOPIFY_ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;

  if (!SHOPIFY_DOMAIN || !SHOPIFY_ADMIN_TOKEN) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'Server misconfigured. Contact support.' }) };
  }

  try {
    const url = `https://${SHOPIFY_DOMAIN}/admin/api/2024-01/orders.json?name=${encodeURIComponent(orderNum)}&status=any&fields=id,name,fulfillments,line_items`;

    const res = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);

    const data = await res.json();
    const orders = data.orders;

    if (!orders || orders.length === 0) {
      return { statusCode: 404, headers: cors(), body: JSON.stringify({ error: 'Order not found. Please check your order number.' }) };
    }

    const order = orders[0];

    let awb = null;
    if (order.fulfillments && order.fulfillments.length > 0) {
      const tracking = order.fulfillments[0].tracking_numbers;
      if (tracking && tracking.length > 0) awb = tracking[0];
    }

    const items = (order.line_items || []).slice(0, 3).map(item => ({
      title: item.title,
      qty:   item.quantity,
      image: item.image_url || null,
      price: item.price
    }));

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ orderName: order.name, awb, items })
    };

  } catch (err) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message || 'Server error' }) };
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type':                 'application/json'
  };
}
