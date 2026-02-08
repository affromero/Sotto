import styles from './page.module.css';

export const metadata = { title: 'Sign In' };

export default function LoginPage() {
  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>Welcome Back</h1>
        <p className={styles.subtitle}>Sign in to continue creating and listening</p>
        <div className={styles.providers}>
          <button className={styles.providerBtn}>Continue with Google</button>
          <button className={styles.providerBtn}>Continue with GitHub</button>
        </div>
        <p className={styles.footer}>
          Don&apos;t have an account? <a href="/auth/signup">Sign up</a>
        </p>
      </div>
    </main>
  );
}
