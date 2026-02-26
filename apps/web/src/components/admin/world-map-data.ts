/**
 * World map country centroid data for dot/bubble heatmap visualization.
 *
 * Positions are geographic centroids mapped to an equirectangular projection
 * with viewBox "0 0 1010 665":
 *   x = (longitude + 180) * (1010 / 360)
 *   y = (90 - latitude) * (665 / 180)
 *
 * Source reference: Natural Earth centroids / CIA World Factbook coordinates.
 */

export interface CountryPosition {
  /** ISO 3166-1 alpha-2 country code */
  id: string;
  /** Human-readable country name */
  name: string;
  /** Center X on the 1010x665 map */
  cx: number;
  /** Center Y on the 1010x665 map */
  cy: number;
}

/**
 * Convert latitude/longitude to x/y in the 1010x665 equirectangular projection.
 */
function toXY(lat: number, lng: number): { cx: number; cy: number } {
  return {
    cx: Math.round((lng + 180) * (1010 / 360) * 10) / 10,
    cy: Math.round((90 - lat) * (665 / 180) * 10) / 10,
  };
}

// Raw centroid data: [id, name, latitude, longitude]
const RAW_CENTROIDS: [string, string, number, number][] = [
  // ── North America ──────────────────────────────────────────
  ['US', 'United States', 39.8, -98.5],
  ['CA', 'Canada', 56.1, -106.3],
  ['MX', 'Mexico', 23.6, -102.6],
  ['GT', 'Guatemala', 15.5, -90.3],
  ['BZ', 'Belize', 17.2, -88.5],
  ['HN', 'Honduras', 15.2, -86.2],
  ['SV', 'El Salvador', 13.8, -88.9],
  ['NI', 'Nicaragua', 12.9, -85.2],
  ['CR', 'Costa Rica', 10.0, -84.0],
  ['PA', 'Panama', 8.5, -80.8],

  // ── Caribbean ──────────────────────────────────────────────
  ['CU', 'Cuba', 21.5, -79.0],
  ['JM', 'Jamaica', 18.1, -77.3],
  ['HT', 'Haiti', 19.1, -72.3],
  ['DO', 'Dominican Republic', 18.7, -70.2],
  ['PR', 'Puerto Rico', 18.2, -66.6],
  ['TT', 'Trinidad and Tobago', 10.4, -61.2],
  ['BS', 'Bahamas', 25.0, -77.4],
  ['BB', 'Barbados', 13.2, -59.5],
  ['LC', 'Saint Lucia', 13.9, -61.0],
  ['GD', 'Grenada', 12.1, -61.7],
  ['AG', 'Antigua and Barbuda', 17.1, -61.8],
  ['DM', 'Dominica', 15.4, -61.4],
  ['KN', 'Saint Kitts and Nevis', 17.3, -62.7],
  ['VC', 'Saint Vincent and the Grenadines', 13.3, -61.2],

  // ── South America ─────────────────────────────────────────
  ['BR', 'Brazil', -14.2, -51.9],
  ['AR', 'Argentina', -38.4, -63.6],
  ['CO', 'Colombia', 4.6, -74.3],
  ['CL', 'Chile', -35.7, -71.5],
  ['PE', 'Peru', -9.2, -75.0],
  ['VE', 'Venezuela', 6.4, -66.6],
  ['EC', 'Ecuador', -1.8, -78.2],
  ['BO', 'Bolivia', -16.3, -63.6],
  ['PY', 'Paraguay', -23.4, -58.4],
  ['UY', 'Uruguay', -32.5, -55.8],
  ['GY', 'Guyana', 5.0, -59.0],
  ['SR', 'Suriname', 3.9, -56.0],
  ['GF', 'French Guiana', 3.9, -53.1],

  // ── Western Europe ────────────────────────────────────────
  ['GB', 'United Kingdom', 55.4, -3.4],
  ['IE', 'Ireland', 53.1, -8.2],
  ['FR', 'France', 46.6, 1.9],
  ['DE', 'Germany', 51.2, 10.5],
  ['NL', 'Netherlands', 52.1, 5.3],
  ['BE', 'Belgium', 50.5, 4.5],
  ['LU', 'Luxembourg', 49.8, 6.1],
  ['CH', 'Switzerland', 46.8, 8.2],
  ['AT', 'Austria', 47.5, 14.6],
  ['LI', 'Liechtenstein', 47.2, 9.6],
  ['MC', 'Monaco', 43.7, 7.4],
  ['AD', 'Andorra', 42.5, 1.5],

  // ── Southern Europe ───────────────────────────────────────
  ['ES', 'Spain', 40.5, -3.7],
  ['PT', 'Portugal', 39.4, -8.2],
  ['IT', 'Italy', 41.9, 12.6],
  ['GR', 'Greece', 39.1, 21.8],
  ['MT', 'Malta', 35.9, 14.4],
  ['SM', 'San Marino', 43.9, 12.5],
  ['VA', 'Vatican City', 41.9, 12.5],
  ['CY', 'Cyprus', 35.1, 33.4],

  // ── Northern Europe ───────────────────────────────────────
  ['SE', 'Sweden', 60.1, 18.6],
  ['NO', 'Norway', 60.5, 8.5],
  ['FI', 'Finland', 61.9, 25.7],
  ['DK', 'Denmark', 56.3, 9.5],
  ['IS', 'Iceland', 64.9, -19.0],

  // ── Eastern Europe ────────────────────────────────────────
  ['PL', 'Poland', 51.9, 19.1],
  ['CZ', 'Czech Republic', 49.8, 15.5],
  ['SK', 'Slovakia', 48.7, 19.7],
  ['HU', 'Hungary', 47.2, 19.5],
  ['RO', 'Romania', 45.9, 25.0],
  ['BG', 'Bulgaria', 42.7, 25.5],
  ['HR', 'Croatia', 45.1, 15.2],
  ['SI', 'Slovenia', 46.2, 15.0],
  ['RS', 'Serbia', 44.0, 21.0],
  ['BA', 'Bosnia and Herzegovina', 43.9, 17.7],
  ['ME', 'Montenegro', 42.7, 19.4],
  ['MK', 'North Macedonia', 41.5, 21.7],
  ['AL', 'Albania', 41.2, 20.2],
  ['XK', 'Kosovo', 42.6, 20.9],

  // ── Baltic States ─────────────────────────────────────────
  ['EE', 'Estonia', 58.6, 25.0],
  ['LV', 'Latvia', 56.9, 24.1],
  ['LT', 'Lithuania', 55.2, 23.9],

  // ── Eastern Europe / CIS ──────────────────────────────────
  ['UA', 'Ukraine', 48.4, 31.2],
  ['BY', 'Belarus', 53.7, 27.9],
  ['MD', 'Moldova', 47.4, 28.4],
  ['RU', 'Russia', 61.5, 105.3],

  // ── Caucasus ──────────────────────────────────────────────
  ['GE', 'Georgia', 42.3, 43.4],
  ['AM', 'Armenia', 40.1, 45.0],
  ['AZ', 'Azerbaijan', 40.1, 47.6],

  // ── Turkey & Middle East ──────────────────────────────────
  ['TR', 'Turkey', 39.0, 35.2],
  ['IL', 'Israel', 31.0, 34.9],
  ['PS', 'Palestine', 31.9, 35.2],
  ['JO', 'Jordan', 30.6, 36.2],
  ['LB', 'Lebanon', 33.9, 35.9],
  ['SY', 'Syria', 35.0, 38.0],
  ['IQ', 'Iraq', 33.2, 43.7],
  ['IR', 'Iran', 32.4, 53.7],
  ['SA', 'Saudi Arabia', 23.9, 45.1],
  ['AE', 'United Arab Emirates', 23.4, 53.8],
  ['QA', 'Qatar', 25.4, 51.2],
  ['KW', 'Kuwait', 29.3, 47.5],
  ['BH', 'Bahrain', 26.0, 50.6],
  ['OM', 'Oman', 21.5, 55.9],
  ['YE', 'Yemen', 15.6, 48.5],

  // ── Central Asia ──────────────────────────────────────────
  ['KZ', 'Kazakhstan', 48.0, 68.0],
  ['UZ', 'Uzbekistan', 41.4, 64.6],
  ['TM', 'Turkmenistan', 39.0, 59.6],
  ['KG', 'Kyrgyzstan', 41.2, 74.8],
  ['TJ', 'Tajikistan', 38.9, 71.3],
  ['AF', 'Afghanistan', 33.9, 67.7],

  // ── South Asia ────────────────────────────────────────────
  ['IN', 'India', 20.6, 79.0],
  ['PK', 'Pakistan', 30.4, 69.3],
  ['BD', 'Bangladesh', 23.7, 90.4],
  ['LK', 'Sri Lanka', 7.9, 80.8],
  ['NP', 'Nepal', 28.4, 84.1],
  ['BT', 'Bhutan', 27.5, 90.4],
  ['MV', 'Maldives', 3.2, 73.2],

  // ── East Asia ─────────────────────────────────────────────
  ['CN', 'China', 35.9, 104.2],
  ['JP', 'Japan', 36.2, 138.3],
  ['KR', 'South Korea', 35.9, 127.8],
  ['KP', 'North Korea', 40.3, 127.5],
  ['MN', 'Mongolia', 46.9, 103.8],
  ['TW', 'Taiwan', 23.7, 121.0],
  ['HK', 'Hong Kong', 22.4, 114.1],
  ['MO', 'Macau', 22.2, 113.5],

  // ── Southeast Asia ────────────────────────────────────────
  ['ID', 'Indonesia', -0.8, 113.9],
  ['TH', 'Thailand', 15.9, 100.9],
  ['VN', 'Vietnam', 14.1, 108.3],
  ['PH', 'Philippines', 12.9, 121.8],
  ['MY', 'Malaysia', 4.2, 101.9],
  ['SG', 'Singapore', 1.4, 103.8],
  ['MM', 'Myanmar', 21.9, 96.0],
  ['KH', 'Cambodia', 12.6, 105.0],
  ['LA', 'Laos', 19.9, 102.5],
  ['BN', 'Brunei', 4.9, 114.7],
  ['TL', 'Timor-Leste', -8.9, 126.0],

  // ── Oceania ───────────────────────────────────────────────
  ['AU', 'Australia', -25.3, 133.8],
  ['NZ', 'New Zealand', -40.9, 174.9],
  ['PG', 'Papua New Guinea', -6.3, 143.9],
  ['FJ', 'Fiji', -17.7, 178.1],
  ['SB', 'Solomon Islands', -9.6, 160.2],
  ['VU', 'Vanuatu', -15.4, 166.9],
  ['WS', 'Samoa', -13.8, -172.1],
  ['TO', 'Tonga', -21.2, -175.2],
  ['FM', 'Micronesia', 7.4, 150.6],
  ['KI', 'Kiribati', 1.9, -157.4],
  ['MH', 'Marshall Islands', 7.1, 171.2],
  ['PW', 'Palau', 7.5, 134.6],
  ['NR', 'Nauru', -0.5, 166.9],
  ['TV', 'Tuvalu', -7.1, 177.6],
  ['NC', 'New Caledonia', -20.9, 165.6],
  ['PF', 'French Polynesia', -17.7, -149.4],

  // ── North Africa ──────────────────────────────────────────
  ['EG', 'Egypt', 26.8, 30.8],
  ['LY', 'Libya', 26.3, 17.2],
  ['TN', 'Tunisia', 33.9, 9.5],
  ['DZ', 'Algeria', 28.0, 1.7],
  ['MA', 'Morocco', 31.8, -7.1],
  ['SD', 'Sudan', 12.9, 30.2],
  ['SS', 'South Sudan', 6.9, 31.3],

  // ── West Africa ───────────────────────────────────────────
  ['NG', 'Nigeria', 9.1, 8.7],
  ['GH', 'Ghana', 7.9, -1.0],
  ['CI', 'Ivory Coast', 7.5, -5.5],
  ['SN', 'Senegal', 14.5, -14.5],
  ['ML', 'Mali', 17.6, -4.0],
  ['BF', 'Burkina Faso', 12.4, -1.6],
  ['NE', 'Niger', 17.6, 8.1],
  ['GN', 'Guinea', 9.9, -11.4],
  ['BJ', 'Benin', 9.3, 2.3],
  ['TG', 'Togo', 8.6, 1.2],
  ['SL', 'Sierra Leone', 8.5, -11.8],
  ['LR', 'Liberia', 6.4, -9.4],
  ['MR', 'Mauritania', 21.0, -10.9],
  ['GM', 'Gambia', 13.4, -15.3],
  ['GW', 'Guinea-Bissau', 12.0, -15.2],
  ['CV', 'Cape Verde', 16.0, -24.0],

  // ── Central Africa ────────────────────────────────────────
  ['CD', 'Democratic Republic of the Congo', -4.0, 21.8],
  ['CG', 'Republic of the Congo', -0.2, 15.8],
  ['CM', 'Cameroon', 7.4, 12.4],
  ['GA', 'Gabon', -0.8, 11.6],
  ['GQ', 'Equatorial Guinea', 1.7, 10.3],
  ['CF', 'Central African Republic', 6.6, 20.9],
  ['TD', 'Chad', 15.5, 18.7],
  ['ST', 'Sao Tome and Principe', 0.2, 6.6],

  // ── East Africa ───────────────────────────────────────────
  ['KE', 'Kenya', -0.0, 38.0],
  ['ET', 'Ethiopia', 9.1, 40.5],
  ['TZ', 'Tanzania', -6.4, 34.9],
  ['UG', 'Uganda', 1.4, 32.3],
  ['RW', 'Rwanda', -1.9, 29.9],
  ['BI', 'Burundi', -3.4, 29.9],
  ['SO', 'Somalia', 5.2, 46.2],
  ['DJ', 'Djibouti', 11.6, 43.1],
  ['ER', 'Eritrea', 15.2, 39.8],

  // ── Southern Africa ───────────────────────────────────────
  ['ZA', 'South Africa', -30.6, 22.9],
  ['NA', 'Namibia', -22.6, 17.1],
  ['BW', 'Botswana', -22.3, 24.7],
  ['ZW', 'Zimbabwe', -19.0, 29.2],
  ['MZ', 'Mozambique', -18.7, 35.5],
  ['ZM', 'Zambia', -13.1, 27.8],
  ['MW', 'Malawi', -13.3, 34.3],
  ['AO', 'Angola', -11.2, 17.9],
  ['MG', 'Madagascar', -18.8, 46.9],
  ['MU', 'Mauritius', -20.3, 57.6],
  ['SC', 'Seychelles', -4.7, 55.5],
  ['KM', 'Comoros', -11.9, 43.9],
  ['SZ', 'Eswatini', -26.5, 31.5],
  ['LS', 'Lesotho', -29.6, 28.2],

  // ── Greenland & territories ───────────────────────────────
  ['GL', 'Greenland', 71.7, -42.6],
];

/**
 * All country positions mapped to the 1010x665 equirectangular projection.
 */
export const COUNTRY_POSITIONS: CountryPosition[] = RAW_CENTROIDS.map(
  ([id, name, lat, lng]) => ({
    id,
    name,
    ...toXY(lat, lng),
  })
);

/**
 * Lookup map for O(1) access by country code.
 */
export const COUNTRY_POSITION_MAP: Record<string, CountryPosition> =
  Object.fromEntries(COUNTRY_POSITIONS.map((c) => [c.id, c]));

/**
 * ViewBox dimensions for the equirectangular world map SVG.
 */
export const VIEWBOX = '0 0 1010 665';

/**
 * Map dimensions as numbers for programmatic use.
 */
export const MAP_WIDTH = 1010;
export const MAP_HEIGHT = 665;
