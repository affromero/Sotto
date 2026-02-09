import '@testing-library/jest-dom';

// Set default environment variables for tests
process.env.STRIPE_PRICE_ID_PRO = process.env.STRIPE_PRICE_ID_PRO || 'price_pro_test_123';
process.env.STRIPE_PRICE_ID_CREATOR =
  process.env.STRIPE_PRICE_ID_CREATOR || 'price_creator_test_456';

// Mock DOM methods not available in jsdom
Element.prototype.scrollIntoView = () => {};
