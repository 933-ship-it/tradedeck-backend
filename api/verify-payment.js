// api/verify-payment.js

// Import necessary libraries for making HTTP requests (e.g., node-fetch)
// Vercel's Node.js runtime has 'fetch' built-in, so no need for explicit import
// if using Node.js 18+ runtime. For older runtimes, you might need 'node-fetch'.

export default async function (req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { orderID } = req.body;

    if (!orderID) {
        return res.status(400).json({ message: 'Missing required field: orderID' });
    }

    try {
        // 1. Get PayPal Access Token (required for most PayPal API calls)
        const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
        const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
        const PAYPAL_API_BASE = process.env.NODE_ENV === 'production'
            ? 'https://api-m.paypal.com' // Production API base URL
            : 'https://api-m.sandbox.paypal.com'; // Sandbox API base URL for testing

        if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
            console.error('PayPal API credentials are not set.');
            return res.status(500).json({ message: 'Server configuration error: Missing PayPal credentials.' });
        }

        const authString = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

        const tokenResponse = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${authString}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
        });

        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('Failed to get PayPal access token:', tokenResponse.status, errorText);
            return res.status(500).json({ message: 'Failed to authenticate with PayPal.' });
        }

        const { access_token } = await tokenResponse.json();

        // 2. Verify the Order Details using the PayPal Orders API
        const orderDetailsResponse = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!orderDetailsResponse.ok) {
            const errorText = await orderDetailsResponse.text();
            console.error('Failed to fetch PayPal order details:', orderDetailsResponse.status, errorText);
            return res.status(500).json({ message: 'Failed to verify payment with PayPal.' });
        }

        const orderDetails = await orderDetailsResponse.json();

        // 3. Implement your verification logic
        // Check the status, amount, currency, and any other relevant fields
        if (orderDetails.status !== 'COMPLETED' && orderDetails.status !== 'APPROVED') { // 'APPROVED' if you're capturing later
            console.warn(`Payment for orderID ${orderID} is not completed. Status: ${orderDetails.status}`);
            return res.status(402).json({
                message: 'Payment not completed or approved.',
                status: orderDetails.status,
                orderDetails: orderDetails // For debugging, remove in production if too much info
            });
        }

        // Example: Verify amount and currency (adjust as per your needs)
        // You'd typically get the expected amount from your database or product details
        const expectedAmount = '10.00'; // Replace with your actual expected amount
        const expectedCurrency = 'USD'; // Replace with your actual expected currency

        const purchaseUnit = orderDetails.purchase_units[0]; // Assuming one purchase unit
        const actualAmount = purchaseUnit?.payments?.captures?.[0]?.amount?.value || purchaseUnit?.amount?.value;
        const actualCurrency = purchaseUnit?.payments?.captures?.[0]?.amount?.currency_code || purchaseUnit?.amount?.currency_code;

        if (actualAmount !== expectedAmount || actualCurrency !== expectedCurrency) {
            console.warn(`Amount or currency mismatch for orderID ${orderID}. Expected: ${expectedAmount} ${expectedCurrency}, Got: ${actualAmount} ${actualCurrency}`);
            return res.status(400).json({
                message: 'Amount or currency mismatch.',
                expected: { amount: expectedAmount, currency: expectedCurrency },
                actual: { amount: actualAmount, currency: actualCurrency }
            });
        }

        // Extract buyer email from orderDetails for your `send-email` function
        const buyerEmail = orderDetails.payer?.email_address;
        const buyerName = orderDetails.payer?.name?.given_name;

        // If verification passes, you can return relevant data to the client
        // The client will then decide to proceed with sending the email
        res.status(200).json({
            message: 'Payment verified successfully!',
            paymentDetails: {
                orderID: orderDetails.id,
                status: orderDetails.status,
                amount: actualAmount,
                currency: actualCurrency,
                buyerEmail: buyerEmail,
                buyerName: buyerName,
                // Add any other relevant details you need to pass back
            }
        });

    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({ message: 'An internal server error occurred during payment verification.', error: error.message });
    }
}
