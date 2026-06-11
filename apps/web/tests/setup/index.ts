import '@testing-library/jest-dom';

// Set default environment variables for tests
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://selfhost.example.com';

// Mock DOM methods not available in jsdom (guard for node environment)
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}
