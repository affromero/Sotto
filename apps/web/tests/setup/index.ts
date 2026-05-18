import '@testing-library/jest-dom';

// Set default environment variables for tests
process.env.STRIPE_PRICE_ID_STARTER = process.env.STRIPE_PRICE_ID_STARTER || 'price_starter_test';
process.env.STRIPE_PRICE_ID_PRO = process.env.STRIPE_PRICE_ID_PRO || 'price_pro_test';
process.env.STRIPE_PRICE_ID_STUDIO = process.env.STRIPE_PRICE_ID_STUDIO || 'price_studio_test';
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://selfhost.example.com';

// Mock DOM methods not available in jsdom (guard for node environment)
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}
