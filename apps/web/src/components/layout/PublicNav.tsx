import Link from 'next/link';
import Image from 'next/image';
import styles from './PublicNav.module.css';

const NAV_LINKS = [
  { href: '/create', label: 'Create' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/developers', label: 'Developers' },
  { href: '/support', label: 'Support' },
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
          {NAV_LINKS.map(({ href, label }) => (
            <li key={href}>
              <Link href={href} className={styles.link}>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
