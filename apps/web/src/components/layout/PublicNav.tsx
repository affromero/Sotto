import Link from 'next/link';
import Image from 'next/image';
import styles from './PublicNav.module.css';

interface NavLink {
  href: string;
  label: string;
  external?: boolean;
}

const NAV_LINKS: NavLink[] = [
  { href: '/about', label: 'About' },
  { href: '/developers', label: 'Developers' },
  { href: '/support', label: 'Support' },
  { href: 'https://github.com/affromero/Sotto', label: 'GitHub', external: true },
];

export function PublicNav() {
  return (
    <nav className={styles.nav} aria-label="Public navigation">
      <div className={styles.inner}>
        <Link href="/" className={styles.logo}>
          <Image src="/brand/sotto-mark.svg" alt="" width={26} height={26} className={styles.logoMark} unoptimized />
          Sotto
        </Link>
        <ul className={styles.links} role="list">
          {NAV_LINKS.map(({ href, label, external }) =>
            external ? (
              <li key={href}>
                <a
                  href={href}
                  className={styles.link}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {label}
                </a>
              </li>
            ) : (
              <li key={href}>
                <Link href={href} className={styles.link}>
                  {label}
                </Link>
              </li>
            )
          )}
        </ul>
      </div>
    </nav>
  );
}
