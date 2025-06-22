// api/verify-payment.js

// Import necessary libraries for making HTTP requests (e.g., node-fetch)
// Vercel's Node.js runtime has 'fetch' built-in, so no need for explicit import
// if using Node.js 18+ runtime. For older runtimes, you might need 'node-fetch'.

// --- Placeholder for your Database Integration ---
// You will need to replace these with your actual database queries.
// Example: If using Firestore, you'd import Firestore functions here.

// Function to fetch order details from your database
// This should return { orderId, userId, productId, expectedAmount, expectedCurrency, status }
async function fetchOrderDetailsFromDB(orderID) {
    // Implement your database query here to find the order based on PayPal orderID.
    // Example (pseudo-code):
    // const orderRef = db.collection('orders').where('paypalOrderId', '==', orderID).get();
    // if (orderRef.empty) return null;
    // const orderData = orderRef.docs[0].data();
    // return {
    //     id: orderRef.docs[0].id,
    //     paypalOrderId: orderData.paypalOrderId,
    //     userId: orderData.userId,
    //     expectedAmount: orderData.expectedAmount,
    //     expectedCurrency: orderData.expectedCurrency,
    //     status: orderData.status // e.g., 'pending', 'completed', 'failed'
    // };
    console.log(`[DB Placeholder] Fetching order details for orderID: ${orderID}`);
    // *** IMPORTANT: REPLACE WITH REAL DATABASE LOGIC ***
    // For demonstration, simulating a 'pending' order for $10.00 USD
    if (orderID === 'YOUR_EXAMPLE_ORDER_ID_FROM_DB') { // Replace with actual ID
        return {
            id: 'yourInternalOrderId123',
            paypalOrderId: orderID,
            userId: 'someUser123',
            expectedAmount: '10.00',
            expectedCurrency: 'USD',
            status: 'pending' // Initial status before payment verification
        };
    }
    return null; // Order not found
}

// Function to update the order status in your database
async function updateOrderStatusInDB(internalOrderID, newStatus, transactionDetails = {}) {
    // Implement your database update query here.
    // Example (pseudo-code):
    // const orderRef = db.collection('orders').doc(internalOrderID);
    // await orderRef.update({ status: newStatus, ...transactionDetails });
    console.log(`[DB Placeholder] Updating order ${internalOrderID} to status: ${newStatus}`);
    console.log('Transaction Details:', transactionDetails);
    // *** IMPORTANT: REPLACE WITH REAL DATABASE LOGIC ***
    return true; // Simulate success
}

export default async function (req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { orderID, userId } = req.body; // Assuming you might pass userId from client or session

    if (!orderID) {
        return res.status(400).json({ message: 'Missing required field: orderID.' });
    }

    // --- 1. Internal Order Validation and Data Retrieval ---
    // This is crucial to link the PayPal order to your system's pending order
    // and fetch the dynamic expected amount/currency.
    let internalOrder;
    try {
        internalOrder = await fetchOrderDetailsFromDB(orderID);

        if (!internalOrder) {
            console.warn(`Attempt to verify non-existent or unrecorded orderID: ${orderID}`);
            return res.status(404).json({ message: 'Order not found or not initiated in our system.' });
        }

        // Optional: Verify that the order belongs to the requesting user (if userId is available)
        // if (userId && internalOrder.userId !== userId) {
        //     console.warn(`Unauthorized attempt to verify order ${orderID} by user ${userId}.`);
        //     return res.status(403).json({ message: 'Unauthorized access to order verification.' });
        // }

        // Prevent replay attacks: Ensure the order hasn't already been processed
        if (internalOrder.status === 'completed' || internalOrder.status === 'processed') {
            console.warn(`Attempt to re-verify already completed orderID: ${orderID}. Status: ${internalOrder.status}`);
            return res.status(409).json({ message: 'This order has already been processed.' });
        }

        // Now we have the dynamically expected amount and currency
        const expectedAmount = internalOrder.expectedAmount;
        const expectedCurrency = internalOrder.expectedCurrency;

        // Store these for later use in case of an early exit
        res.locals = { expectedAmount, expectedCurrency, internalOrder };

    } catch (dbError) {
        console.error('Database error during initial order lookup:', dbError);
        return res.status(500).json({ message: 'Internal server error during order lookup.' });
    }

    try {
        const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
        const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
        const PAYPAL_API_BASE = process.env.NODE_ENV === 'production'
            ? 'https://api-m.paypal.com' // Production API base URL
            : 'https://api-m.sandbox.paypal.com'; // Sandbox API base URL for testing

        if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
            console.error('Server configuration error: PayPal API credentials are not set.');
            return res.status(500).json({ message: 'Server configuration error: Missing PayPal credentials.' });
        }

        const authString = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

        // 2. Get PayPal Access Token
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
            // Don't expose PayPal's internal error messages directly to the client
            return res.status(500).json({ message: 'Failed to authenticate with payment gateway.' });
        }

        const { access_token } = await tokenResponse.json();

        // 3. Verify the Order Details using the PayPal Orders API
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
            // Don't expose PayPal's internal error messages directly to the client
            return res.status(500).json({ message: 'Failed to verify payment details with gateway.' });
        }

        const paypalOrderDetails = await orderDetailsResponse.json();

        // 4. Implement your robust verification logic
        const expectedAmount = res.locals.expectedAmount; // Retrieve from locals set during DB lookup
        const expectedCurrency = res.locals.expectedCurrency;

        // Check the status
        if (paypalOrderDetails.status !== 'COMPLETED' && paypalOrderDetails.status !== 'APPROVED') {
            console.warn(`Payment for orderID ${orderID} is not completed or approved. Status: ${paypalOrderDetails.status}`);
            await updateOrderStatusInDB(internalOrder.id, 'failed_paypal_status', { paypalStatus: paypalOrderDetails.status });
            return res.status(402).json({
                message: 'Payment not completed or approved by the payment gateway. Current status: ' + paypalOrderDetails.status
            });
        }

        // Verify amount and currency (using dynamically fetched expected values)
        const purchaseUnit = paypalOrderDetails.purchase_units[0]; // Assuming one purchase unit
        const actualAmount = purchaseUnit?.payments?.captures?.[0]?.amount?.value || purchaseUnit?.amount?.value;
        const actualCurrency = purchaseUnit?.payments?.captures?.[0]?.amount?.currency_code || purchaseUnit?.amount?.currency_code;

        if (actualAmount !== expectedAmount || actualCurrency !== expectedCurrency) {
            console.warn(`Amount or currency mismatch for orderID ${orderID}. Expected: ${expectedAmount} ${expectedCurrency}, Got: ${actualAmount} ${actualCurrency}`);
            await updateOrderStatusInDB(internalOrder.id, 'failed_amount_mismatch', {
                expected: `${expectedAmount} ${expectedCurrency}`,
                actual: `${actualAmount} ${actualCurrency}`
            });
            return res.status(400).json({
                message: 'Payment amount or currency does not match the product price.'
            });
        }

        // Extract buyer email from orderDetails for your `send-email` function
        const buyerEmail = paypalOrderDetails.payer?.email_address;
        const buyerName = paypalOrderDetails.payer?.name?.given_name || paypalOrderDetails.payer?.name?.full_name;

        // If verification passes, update your internal order status to 'completed'
        await updateOrderStatusInDB(internalOrder.id, 'completed', {
            paypalOrderId: paypalOrderDetails.id,
            paypalStatus: paypalOrderDetails.status,
            amountPaid: actualAmount,
            currencyPaid: actualCurrency,
            buyerEmail: buyerEmail,
            buyerName: buyerName
        });

        // The client can now be safely instructed to proceed (e.g., enable download button)
        res.status(200).json({
            message: 'Payment verified successfully!',
            paymentDetails: {
                orderID: paypalOrderDetails.id,
                status: paypalOrderDetails.status,
                amount: actualAmount,
                currency: actualCurrency,
                buyerEmail: buyerEmail,
                buyerName: buyerName,
                internalOrderId: internalOrder.id // Return your internal order ID
            }
        });

    } catch (error) {
        console.error('Unhandled error during payment verification:', error);
        // Ensure you update order status to 'failed' in DB if an unhandled error occurs
        if (internalOrder && internalOrder.id) {
            await updateOrderStatusInDB(internalOrder.id, 'failed_internal_error', { errorMessage: error.message });
        }
        res.status(500).json({ message: 'An internal server error occurred during payment verification.' });
    }
}
