import { BRAND } from '@sotto/shared';

interface WebSiteSchema {
  '@context': 'https://schema.org';
  '@type': 'WebSite';
  name: string;
  url: string;
  description: string;
}

interface OrganizationSchema {
  '@context': 'https://schema.org';
  '@type': 'Organization';
  name: string;
  url: string;
  logo: string;
  sameAs: string[];
  description: string;
}

const websiteSchema: WebSiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: BRAND.name,
  url: BRAND.url,
  description: BRAND.description,
};

const organizationSchema: OrganizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: BRAND.name,
  url: BRAND.url,
  logo: `${BRAND.url}/icon-512.png`,
  sameAs: ['https://twitter.com/SottoFM'],
  description: BRAND.elevatorPitch,
};

export function JsonLd() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
      />
    </>
  );
}
